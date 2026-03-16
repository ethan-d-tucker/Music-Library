/**
 * Fix non-square album art in the music library.
 *
 * For each album folder with a cover image:
 *   1. Check dimensions with ffprobe
 *   2. If not square, try to find correct square art from Cover Art Archive
 *   3. If replacement is square, use it; otherwise crop the current image to square (center crop)
 *
 * Usage:
 *   cd server && npx tsx scripts/fix-album-art-aspect.ts              # dry run
 *   cd server && npx tsx scripts/fix-album-art-aspect.ts --execute     # apply changes
 *   cd server && npx tsx scripts/fix-album-art-aspect.ts --crop-only   # skip web search, just crop
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { MUSIC_DIR, FFMPEG_DIR } from '../src/config.js'

const args = process.argv.slice(2)
const executeMode = args.includes('--execute')
const cropOnly = args.includes('--crop-only')
const musicDir = args.find(a => !a.startsWith('-')) || MUSIC_DIR

const ffprobe = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffprobe').replace(/\\/g, '/') : 'ffprobe'
const ffmpeg = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffmpeg').replace(/\\/g, '/') : 'ffmpeg'

const USER_AGENT = 'MusicLibraryArtFix/1.0 (local)'
const ART_PATTERNS = /^(cover|folder|album|front|artwork)\.(jpg|jpeg|png|webp)$/i

interface ImageInfo {
  width: number
  height: number
  path: string
}

function getImageDimensions(imgPath: string): ImageInfo | null {
  try {
    const cmd = `"${ffprobe}" -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "${imgPath.replace(/\\/g, '/')}"`
    const output = execSync(cmd, { encoding: 'utf8', timeout: 10000 }).trim()
    const [w, h] = output.split('x').map(Number)
    if (w > 0 && h > 0) return { width: w, height: h, path: imgPath }
    return null
  } catch {
    return null
  }
}

function cropToSquare(imgPath: string): boolean {
  const tmpPath = imgPath + '.tmp' + path.extname(imgPath)
  try {
    // Center crop to the smaller dimension
    const cmd = `"${ffmpeg}" -y -i "${imgPath.replace(/\\/g, '/')}" -vf "crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2" -q:v 2 "${tmpPath.replace(/\\/g, '/')}"`
    execSync(cmd, { encoding: 'utf8', timeout: 30000, stdio: 'pipe' })
    // Verify the output is valid and square
    const dims = getImageDimensions(tmpPath)
    if (dims && dims.width === dims.height && dims.width > 0) {
      fs.renameSync(tmpPath, imgPath)
      return true
    }
    try { fs.unlinkSync(tmpPath) } catch {}
    return false
  } catch (err) {
    try { fs.unlinkSync(tmpPath) } catch {}
    return false
  }
}

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
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as T
}

async function fetchSquareArt(artistName: string, albumName: string): Promise<Buffer | null> {
  // Clean album name
  const cleanAlbum = albumName
    .replace(/\s*\(Deluxe.*?\)/i, '')
    .replace(/\s*\(Super Deluxe.*?\)/i, '')
    .replace(/\s*\(\d+th Anniversary.*?\)/i, '')
    .replace(/\s*\(\d{4}\s*Remaster.*?\)/i, '')
    .replace(/\s*\(Remaster.*?\)/i, '')
    .replace(/\s*\(Special.*?\)/i, '')
    .replace(/\s*\(Original Motion Picture.*?\)/i, '')
    .replace(/\s*\(\d{4}\).*$/, '')
    .replace(/\s*\[.*?\]/g, '')
    .trim()

  const cleanArtist = artistName
    .split(';')[0]
    .split('/')[0]
    .replace(/\s*(&|and|with)\s+.+$/i, '')
    .trim()

  try {
    const query = `release:"${cleanAlbum}" AND artist:"${cleanArtist}"`
    const data = await mbFetch<{
      releases: { id: string; title: string; 'release-group': { id: string } }[]
    }>(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&limit=5&fmt=json`)

    if (!data.releases?.length) return null

    const exact = data.releases.find(r => r.title.toLowerCase() === cleanAlbum.toLowerCase())
    const release = exact || data.releases[0]
    const rgId = release['release-group']?.id
    if (!rgId) return null

    // Try Cover Art Archive (release group first, then specific release)
    for (const url of [
      `https://coverartarchive.org/release-group/${rgId}/front`,
      `https://coverartarchive.org/release/${release.id}/front`,
    ]) {
      try {
        const artRes = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) })
        if (artRes.ok) {
          const buffer = Buffer.from(await artRes.arrayBuffer())
          if (buffer.length > 1000) return buffer
        }
      } catch {}
    }
    return null
  } catch {
    return null
  }
}

function isSquareBuffer(buffer: Buffer): boolean {
  // Write to temp, check with ffprobe
  const tmp = path.join(musicDir, '_tmp_art_check.jpg')
  try {
    fs.writeFileSync(tmp, buffer)
    const dims = getImageDimensions(tmp)
    return dims !== null && dims.width === dims.height
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }
}

async function main() {
  console.log(`Scanning for non-square album art in: ${musicDir}`)
  console.log(`Mode: ${executeMode ? 'EXECUTE' : 'DRY RUN'}${cropOnly ? ' (crop only, no web search)' : ''}\n`)

  const nonSquare: { artistFolder: string; albumFolder: string; albumDir: string; artFile: string; width: number; height: number }[] = []

  // Scan all album folders
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

      // Find cover art file
      const artFile = files.find(f => ART_PATTERNS.test(f))
      if (!artFile) continue

      const artPath = path.join(albumDir, artFile)
      const dims = getImageDimensions(artPath)
      if (!dims) continue

      if (dims.width !== dims.height) {
        nonSquare.push({
          artistFolder: artistEntry.name,
          albumFolder: albumEntry.name,
          albumDir,
          artFile,
          width: dims.width,
          height: dims.height,
        })
      }
    }
  }

  console.log(`Found ${nonSquare.length} albums with non-square art\n`)

  if (nonSquare.length === 0) return

  // Show all non-square art
  for (const item of nonSquare) {
    const ratio = (item.width / item.height).toFixed(2)
    console.log(`  ${item.artistFolder} / ${item.albumFolder} — ${item.width}x${item.height} (ratio ${ratio})`)
  }
  console.log()

  if (!executeMode) {
    console.log('Run with --execute to fix these. Use --crop-only to skip web search and just crop.')
    return
  }

  let replaced = 0
  let cropped = 0
  let failed = 0

  for (const item of nonSquare) {
    const artPath = path.join(item.albumDir, item.artFile)
    process.stdout.write(`  ${item.artistFolder} / ${item.albumFolder} (${item.width}x${item.height})... `)

    // Step 1: Try to find square art from Cover Art Archive (unless --crop-only)
    if (!cropOnly) {
      try {
        const buffer = await fetchSquareArt(item.artistFolder, item.albumFolder)
        if (buffer && isSquareBuffer(buffer)) {
          // Determine extension
          const isPng = buffer[0] === 0x89 && buffer[1] === 0x50
          const ext = isPng ? 'png' : 'jpg'
          const newArtPath = path.join(item.albumDir, `cover.${ext}`)

          fs.writeFileSync(newArtPath, buffer)
          // Remove old file if different name
          if (newArtPath !== artPath && fs.existsSync(artPath)) {
            fs.unlinkSync(artPath)
          }
          const dims = getImageDimensions(newArtPath)
          console.log(`replaced with Cover Art Archive (${dims?.width}x${dims?.height}, ${(buffer.length / 1024).toFixed(0)}KB)`)
          replaced++
          continue
        }
      } catch {}
    }

    // Step 2: Crop existing image to square
    if (cropToSquare(artPath)) {
      const newDims = getImageDimensions(artPath)
      console.log(`cropped to ${newDims?.width}x${newDims?.height}`)
      cropped++
    } else {
      console.log('FAILED to crop')
      failed++
    }
  }

  console.log(`\nDone: ${replaced} replaced from web, ${cropped} cropped, ${failed} failed`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})