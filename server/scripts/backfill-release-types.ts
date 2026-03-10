/**
 * Backfill MusicBrainz release type (Album, Single, EP) into MP3/FLAC tags.
 * Navidrome reads TXXX:MusicBrainz Album Type (MP3) or RELEASETYPE (FLAC).
 *
 * Usage: cd server && npx tsx scripts/backfill-release-types.ts
 */
import fs from 'fs'
import path from 'path'
import NodeID3 from 'node-id3'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { MUSIC_DIR, FFMPEG_DIR } from '../src/config.js'

const execFileAsync = promisify(execFile)
const ffmpegPath = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffmpeg').replace(/\\/g, '/') : 'ffmpeg'
const ffprobePath = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffprobe').replace(/\\/g, '/') : 'ffprobe'

const USER_AGENT = 'MusicLibraryReleaseType/1.0 (local)'
const musicDir = process.argv[2] || MUSIC_DIR

// Cache: "artist|||album" -> release type
const typeCache = new Map<string, string>()

async function mbFetch<T>(url: string, retries = 3): Promise<T> {
  await new Promise(r => setTimeout(r, 1500))
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  })
  if (res.status === 503 && retries > 0) {
    console.log(`    (rate limited, waiting 3s...)`)
    await new Promise(r => setTimeout(r, 3000))
    return mbFetch<T>(url, retries - 1)
  }
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}`)
  return res.json() as Promise<T>
}

async function lookupReleaseType(artist: string, album: string): Promise<string | null> {
  const key = `${artist.toLowerCase()}|||${album.toLowerCase()}`
  if (typeCache.has(key)) return typeCache.get(key)!

  const cleanAlbum = album
    .replace(/\s*\(Deluxe.*?\)/i, '')
    .replace(/\s*\(Remaster.*?\)/i, '')
    .replace(/\s*\[.*?\]/g, '')
    .replace(/\s*\(Special.*?\)/i, '')
    .replace(/\s*\(Super.*?\)/i, '')
    .trim()

  const cleanArtist = artist
    .replace(/;.*$/, '') // take first artist from semicolon-separated
    .replace(/\s*(&|and|with)\s+.+$/i, '')
    .trim()

  try {
    const query = `release:"${cleanAlbum}" AND artist:"${cleanArtist}"`
    const data = await mbFetch<{
      releases: {
        id: string
        title: string
        'release-group': { id: string; 'primary-type'?: string }
      }[]
    }>(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&limit=5&fmt=json`)

    if (!data.releases?.length) {
      typeCache.set(key, '')
      return null
    }

    // Find best match
    const exact = data.releases.find(r =>
      r.title.toLowerCase() === cleanAlbum.toLowerCase()
    )
    const release = exact || data.releases[0]
    const primaryType = release['release-group']?.['primary-type']

    if (!primaryType) {
      typeCache.set(key, '')
      return null
    }

    // Normalize: MusicBrainz uses "Album", "Single", "EP", etc.
    const normalized = primaryType.toLowerCase()
    typeCache.set(key, normalized)
    return normalized
  } catch {
    typeCache.set(key, '')
    return null
  }
}

async function readCurrentReleaseType(filePath: string, ext: string): Promise<string | null> {
  if (ext === '.mp3') {
    const tags = NodeID3.read(filePath)
    const udt = tags.userDefinedText
    if (udt) {
      const items = Array.isArray(udt) ? udt : [udt]
      const match = items.find(t => t.description === 'MusicBrainz Album Type')
      if (match) return match.value
    }
    return null
  } else if (ext === '.flac') {
    try {
      const { stdout } = await execFileAsync(ffprobePath, [
        '-v', 'quiet', '-print_format', 'json', '-show_format', filePath
      ], { timeout: 10000 })
      const info = JSON.parse(stdout)
      const tags = info.format?.tags || {}
      return tags.RELEASETYPE || tags.releasetype || tags.MUSICBRAINZ_ALBUMTYPE || tags.musicbrainz_albumtype || null
    } catch {
      return null
    }
  }
  return null
}

async function writeReleaseType(filePath: string, ext: string, releaseType: string): Promise<void> {
  if (ext === '.mp3') {
    NodeID3.update({
      userDefinedText: [{
        description: 'MusicBrainz Album Type',
        value: releaseType,
      }],
    }, filePath)
  } else if (ext === '.flac') {
    // Read existing tags, add RELEASETYPE, rewrite
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', filePath
    ], { timeout: 10000 })
    const info = JSON.parse(stdout)
    const existingTags = info.format?.tags || {}

    const tmpPath = filePath + '.tmp.' + Date.now() + '.flac'
    const args = ['-y', '-i', filePath, '-map', '0', '-map_metadata', '-1', '-c', 'copy']

    // Preserve all existing tags
    for (const [k, v] of Object.entries(existingTags)) {
      if (k.toLowerCase() !== 'releasetype' && k.toLowerCase() !== 'musicbrainz_albumtype') {
        args.push('-metadata', `${k}=${v}`)
      }
    }
    // Add release type
    args.push('-metadata', `RELEASETYPE=${releaseType}`)
    args.push(tmpPath)

    await execFileAsync(ffmpegPath, args, { timeout: 30000 })
    fs.renameSync(tmpPath, filePath)
  }
}

async function main() {
  console.log(`Backfilling release types from MusicBrainz...\n`)
  console.log(`Library: ${musicDir}\n`)

  // Collect all albums: group files by artist/album folder
  const albums: { artist: string; album: string; files: { path: string; ext: string }[] }[] = []

  const topLevel = fs.readdirSync(musicDir, { withFileTypes: true })
  for (const artistEntry of topLevel) {
    if (!artistEntry.isDirectory() || artistEntry.name === 'Playlists') continue
    const artistDir = path.join(musicDir, artistEntry.name)
    let albumEntries: fs.Dirent[]
    try { albumEntries = fs.readdirSync(artistDir, { withFileTypes: true }) } catch { continue }
    for (const albumEntry of albumEntries) {
      if (!albumEntry.isDirectory()) continue
      const albumDir = path.join(artistDir, albumEntry.name)
      let files: string[]
      try { files = fs.readdirSync(albumDir) } catch { continue }
      const audioFiles = files
        .filter(f => /\.(mp3|flac)$/i.test(f))
        .map(f => ({ path: path.join(albumDir, f), ext: path.extname(f).toLowerCase() }))
      if (audioFiles.length > 0) {
        albums.push({ artist: artistEntry.name, album: albumEntry.name, files: audioFiles })
      }
    }
  }

  console.log(`Found ${albums.length} albums\n`)

  let updated = 0
  let skipped = 0
  let failed = 0
  let alreadyTagged = 0

  for (const album of albums) {
    // Check first file to see if already tagged
    const firstFile = album.files[0]
    const existing = await readCurrentReleaseType(firstFile.path, firstFile.ext)
    if (existing) {
      alreadyTagged++
      continue
    }

    // Look up release type
    const releaseType = await lookupReleaseType(album.artist, album.album)
    if (!releaseType) {
      process.stdout.write(`  ${album.artist} / ${album.album} — not found\n`)
      failed++
      continue
    }

    process.stdout.write(`  ${album.artist} / ${album.album} — ${releaseType}`)

    // Write to all files in album
    let albumUpdated = 0
    for (const file of album.files) {
      try {
        await writeReleaseType(file.path, file.ext, releaseType)
        albumUpdated++
      } catch (err) {
        // Skip individual file errors
      }
    }
    console.log(` (${albumUpdated} files)`)
    updated++
  }

  console.log(`\nDone: ${updated} albums tagged, ${alreadyTagged} already had types, ${failed} not found on MusicBrainz, ${skipped} skipped`)
}

main().catch(err => { console.error(err); process.exit(1) })
