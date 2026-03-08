import { execFile } from 'child_process'
import { promisify } from 'util'
import { readdirSync, statSync } from 'fs'
import path from 'path'
import NodeID3 from 'node-id3'
import { MUSIC_DIR, FFMPEG_DIR } from '../config.js'

const execFileAsync = promisify(execFile)

const ffmpegPath = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffmpeg').replace(/\\/g, '/') : 'ffmpeg'
const ffprobePath = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffprobe').replace(/\\/g, '/') : 'ffprobe'

// Canonical artist name mappings — keys are lowercase variants
const ARTIST_ALIASES: Record<string, string> = {
  'jason isbell and the 400 unit': 'Jason Isbell and the 400 Unit',
  'jason isbell & the 400 unit': 'Jason Isbell and the 400 Unit',
  'justin towes earle': 'Justin Townes Earle',
}

// Multi-artist normalization: sort collaborator names so "A, B, C" and "B, A, C" become the same
function normalizeArtist(artist: string): string {
  // Check alias map first
  const alias = ARTIST_ALIASES[artist.toLowerCase()]
  if (alias) return alias

  // For multi-artist comma-separated names, sort them consistently
  if (artist.includes(',') && !artist.includes(' and ') && !artist.includes(' & ')) {
    const parts = artist.split(',').map(s => s.trim()).sort()
    const normalized = parts.join(', ')
    // Check alias for the normalized form too
    return ARTIST_ALIASES[normalized.toLowerCase()] || normalized
  }

  return artist
}

// Parse metadata from folder/file path when tags are missing
// Handles patterns like:
//   Artist - Album (Year) [Info]/01 - Title.flac
//   Artist-Discography/Artist - Year - Album/01 - Title.flac
//   Artist-Discography/Year - Album/01.- Title.flac
//   Artist - Discography/Year - Album/01.- Title.flac
//   Artist/Album (Year)/01. Title.mp3
//   Flat: Artist - Album/01 Title.flac
function parsePathMetadata(filePath: string): { artist: string; album: string; title: string; trackNumber: number } | null {
  const rel = path.relative(MUSIC_DIR, filePath).replace(/\\/g, '/')
  const parts = rel.split('/')
  const fileName = parts[parts.length - 1]

  // Parse track number and title from filename
  // Patterns: "01 - Title.ext", "01.- Title.ext", "01. Title.ext", "01 Title.ext",
  //           "01-artist-title.ext" (scene format)
  const ext = path.extname(fileName)
  const base = path.basename(fileName, ext)

  let trackNumber = 0
  let title = base

  // "01 - Title" or "01.- Title" or "01. Title"
  const trackMatch = base.match(/^(\d{1,3})[\s.\-]+(.+)$/)
  if (trackMatch) {
    trackNumber = parseInt(trackMatch[1])
    title = trackMatch[2].replace(/^[\s.\-]+/, '').trim()
  }

  // Scene format: "01-kanye_west-title_here"
  const sceneMatch = base.match(/^(\d{2})-\w+-(.+)$/)
  if (sceneMatch) {
    trackNumber = parseInt(sceneMatch[1])
    title = sceneMatch[2]
      .replace(/_/g, ' ')
      .replace(/\(feat[^)]*\)/gi, (m) => m) // keep feat
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }

  // Try to get artist and album from folder structure
  let artist = ''
  let album = ''

  if (parts.length >= 3) {
    // 3+ levels: topFolder / albumFolder / file
    const topFolder = parts[0]
    const albumFolder = parts[parts.length - 2]

    // Top folder patterns:
    // "Artist - Album (Year) [Info]" — single album flat
    // "Artist - Discography ..." — discography container
    // "Artist" — clean artist name
    // "ArtistName-Studio Discography-FLAC" — hyphenated

    // Check if top folder is a discography container
    const isDiscography = /discography|studio\s*discography/i.test(topFolder)

    if (isDiscography) {
      // Extract artist from discography folder name
      // "Kendrick Lamar - Discography (2009 - 2022) [FLAC] vtwin88cube"
      // "Kanye West-Studio Discography-FLAC"
      // "Tyler, The Creator - Discography (2009-2021) [FLAC] vtwin88cube"
      const discMatch = topFolder.match(/^(.+?)[\s-]+(?:Studio\s*)?Discography/i)
      if (discMatch) {
        artist = discMatch[1].replace(/_/g, ' ').trim()
      }

      // Album from sub-folder: "2017 - Damn", "Kanye West - 2007 - Graduation", "2019 - Igor"
      const albumMatch1 = albumFolder.match(/^\d{4}\s*-\s*(.+)$/)
      const albumMatch2 = albumFolder.match(/^.+?\s*-\s*\d{4}\s*-\s*(.+)$/)
      if (albumMatch2) {
        album = albumMatch2[1].replace(/\s*\[.*$/, '').trim()
        // Also extract artist from "Kanye West - 2007 - Graduation"
        const artistFromAlbum = albumFolder.match(/^(.+?)\s*-\s*\d{4}/)
        if (artistFromAlbum && !artist) artist = artistFromAlbum[1].replace(/_/g, ' ').trim()
      } else if (albumMatch1) {
        album = albumMatch1[1].replace(/\s*\[.*$/, '').trim()
      } else {
        // Scene format: "Kanye_West-College_Dropout-FLAC-2004-iND"
        const sceneAlbumMatch = albumFolder.match(/^.+?-(.+?)-FLAC/i)
        if (sceneAlbumMatch) {
          album = sceneAlbumMatch[1].replace(/_/g, ' ').trim()
          const sceneArtist = albumFolder.match(/^(.+?)-/)?.[1]
          if (sceneArtist && !artist) artist = sceneArtist.replace(/_/g, ' ').trim()
        } else {
          album = albumFolder
        }
      }
    } else {
      // Not a discography — top folder might be "Artist" or "Artist - Album"
      const artistAlbumMatch = topFolder.match(/^(.+?)\s*-\s*(.+?)(?:\s*\(|\s*\[|$)/)
      if (artistAlbumMatch && parts.length === 3) {
        // "Artist - Something" at top, then album subfolder
        artist = artistAlbumMatch[1].trim()
        album = albumFolder.replace(/\s*\(\d{4}\).*$/, '').replace(/\s*\[.*$/, '').trim()
      } else {
        artist = topFolder
        album = albumFolder.replace(/\s*\(\d{4}\).*$/, '').replace(/\s*\[.*$/, '').trim()
      }
    }
  } else if (parts.length === 2) {
    // 2 levels: folder/file — folder is "Artist - Album (Year) [Info]"
    const folder = parts[0]
    const match = folder.match(/^(.+?)\s*-\s*(.+?)(?:\s*\(|\s*\[|$)/)
    if (match) {
      artist = match[1].trim()
      album = match[2].replace(/\s*\(.*$/, '').replace(/\s*\[.*$/, '').trim()
    } else {
      artist = folder
      album = ''
    }
  }

  if (!artist) return null

  // Clean up title — remove "Artist - " prefix if present (Tyler Igor format: "Tyler, The Creator - Igor.m3u")
  title = title.replace(/^\d+\.\s*-?\s*/, '')

  return { artist: normalizeArtist(artist), album, title, trackNumber }
}

// Read existing tags from a FLAC file using ffprobe
async function readFlacTags(filePath: string): Promise<{ artist?: string; album?: string; title?: string; track?: string }> {
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', filePath
    ], { timeout: 10000 })
    const info = JSON.parse(stdout)
    const tags = info.format?.tags || {}
    return {
      artist: tags.ARTIST || tags.artist,
      album: tags.ALBUM || tags.album,
      title: tags.TITLE || tags.title,
      track: tags.TRACK || tags.track,
    }
  } catch {
    return {}
  }
}

// Write tags to a FLAC file using ffmpeg (copies audio, replaces metadata)
async function writeFlacTags(filePath: string, tags: { artist: string; album: string; title: string; trackNumber: number }): Promise<void> {
  const tmpPath = filePath + '.tmp.' + Date.now() + path.extname(filePath)
  const args = [
    '-y', '-i', filePath,
    '-map', '0', '-c', 'copy',
    '-metadata', `ARTIST=${tags.artist}`,
    '-metadata', `ALBUM=${tags.album}`,
    '-metadata', `TITLE=${tags.title}`,
  ]
  if (tags.trackNumber > 0) {
    args.push('-metadata', `TRACKNUMBER=${tags.trackNumber}`)
  }
  args.push(tmpPath)

  await execFileAsync(ffmpegPath, args, { timeout: 30000 })

  // Replace original with tagged version
  const fs = await import('fs')
  fs.renameSync(tmpPath, filePath)
}

// Write tags to an MP3 file and normalize artist name
function writeMp3Tags(filePath: string, updates: { artist?: string }): void {
  if (updates.artist) {
    NodeID3.update({ artist: updates.artist }, filePath)
  }
}

export interface NormalizeResult {
  scanned: number
  fixed: number
  errors: string[]
}

// Normalize a single file — returns true if it was modified
export async function normalizeFile(filePath: string): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase()
  const isFlac = ext === '.flac'
  const isMp3 = ext === '.mp3'
  if (!isFlac && !isMp3) return false

  if (isFlac) {
    const existing = await readFlacTags(filePath)
    const needsFullTag = !existing.artist || existing.artist === 'Unknown'
    const needsNormalize = existing.artist && ARTIST_ALIASES[existing.artist.toLowerCase()]

    if (needsFullTag) {
      // No tags — parse from path and write
      const parsed = parsePathMetadata(filePath)
      if (!parsed) return false
      await writeFlacTags(filePath, parsed)
      return true
    } else if (needsNormalize) {
      // Has tags but artist name needs normalization
      const canonical = normalizeArtist(existing.artist!)
      if (canonical !== existing.artist) {
        await writeFlacTags(filePath, {
          artist: canonical,
          album: existing.album || '',
          title: existing.title || '',
          trackNumber: parseInt(existing.track || '0') || 0,
        })
        return true
      }
    }
  } else if (isMp3) {
    const tags = NodeID3.read(filePath)
    const artist = tags.artist || ''

    if (!artist || artist === 'Unknown') {
      // No artist — parse from path
      const parsed = parsePathMetadata(filePath)
      if (!parsed) return false
      NodeID3.update({
        title: parsed.title,
        artist: parsed.artist,
        album: parsed.album,
        trackNumber: parsed.trackNumber > 0 ? String(parsed.trackNumber) : undefined,
      }, filePath)
      return true
    }

    // Check if artist name needs normalization
    const normalized = normalizeArtist(artist)
    if (normalized !== artist) {
      writeMp3Tags(filePath, { artist: normalized })
      return true
    }

    // Check multi-artist sorting
    if (artist.includes(',') && !artist.includes(' and ') && !artist.includes(' & ')) {
      const sorted = artist.split(',').map(s => s.trim()).sort().join(', ')
      if (sorted !== artist) {
        writeMp3Tags(filePath, { artist: sorted })
        return true
      }
    }
  }

  return false
}

// Scan and normalize the entire library
export async function normalizeLibrary(): Promise<NormalizeResult> {
  const result: NormalizeResult = { scanned: 0, fixed: 0, errors: [] }

  function walk(dir: string): string[] {
    const files: string[] = []
    try {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry)
        try {
          if (statSync(full).isDirectory()) {
            files.push(...walk(full))
          } else if (full.endsWith('.mp3') || full.endsWith('.flac')) {
            files.push(full)
          }
        } catch {}
      }
    } catch {}
    return files
  }

  const files = walk(MUSIC_DIR)

  for (const filePath of files) {
    result.scanned++
    try {
      const fixed = await normalizeFile(filePath)
      if (fixed) result.fixed++
    } catch (err) {
      result.errors.push(`${path.relative(MUSIC_DIR, filePath)}: ${(err as Error).message}`)
    }
  }

  return result
}
