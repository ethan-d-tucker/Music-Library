/**
 * Import Bandcamp purchases into the music library.
 *
 * Prerequisites:
 *   1. Download Bandsnatch from https://github.com/Ovyerus/bandsnatch/releases
 *   2. Place bandsnatch.exe somewhere in PATH or specify with --bandsnatch-path
 *   3. Export your Bandcamp cookies (use a browser extension like "cookies.txt")
 *
 * Usage:
 *   # Step 1: Download from Bandcamp to staging folder
 *   cd server && npx tsx scripts/import-bandcamp.ts --download --user <username> --cookies ~/cookies.txt
 *
 *   # Step 2: Import downloaded files into library (can also run standalone on any folder)
 *   cd server && npx tsx scripts/import-bandcamp.ts --import [folder]
 *
 *   # Both steps at once
 *   cd server && npx tsx scripts/import-bandcamp.ts --download --import --user <username> --cookies ~/cookies.txt
 *
 *   # Dry run (preview only)
 *   cd server && npx tsx scripts/import-bandcamp.ts --import --dry-run [folder]
 */
import path from 'path'
import { existsSync, readdirSync, statSync, renameSync, mkdirSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { MUSIC_DIR, FFMPEG_DIR } from '../src/config.js'
import { readFlacTags } from '../src/services/normalizer.js'
import { getTrackPath, getAbsolutePath, ensureDirectories } from '../src/services/organizer.js'
import { insertTrack, updateTrackStatus, type TrackRow } from '../src/db/index.js'
import NodeID3 from 'node-id3'

const execFileAsync = promisify(execFile)

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const doDownload = args.includes('--download')
const doImport = args.includes('--import')
const cookiesIdx = args.indexOf('--cookies')
const cookiesPath = cookiesIdx !== -1 ? args[cookiesIdx + 1] : ''
const bandsnatchPathIdx = args.indexOf('--bandsnatch-path')
const bandsnatchPath = bandsnatchPathIdx !== -1 ? args[bandsnatchPathIdx + 1] : 'bandsnatch'
const userIdx = args.indexOf('--user')
const bandcampUser = userIdx !== -1 ? args[userIdx + 1] : ''

const STAGING_DIR = path.join(MUSIC_DIR, '_bandcamp-staging')

// Find a custom import folder (non-flag argument)
const customFolder = args.find(a => !a.startsWith('--') && a !== cookiesPath && a !== (bandsnatchPathIdx !== -1 ? args[bandsnatchPathIdx + 1] : ''))

if (!doDownload && !doImport) {
  console.log('Specify --download, --import, or both. Run with no args for help.')
  process.exit(1)
}

async function downloadFromBandcamp(): Promise<void> {
  if (!cookiesPath) {
    console.error('Error: --cookies path required for download')
    process.exit(1)
  }
  if (!bandcampUser) {
    console.error('Error: --user <username> required for download')
    process.exit(1)
  }

  mkdirSync(STAGING_DIR, { recursive: true })

  console.log(`Downloading Bandcamp collection to ${STAGING_DIR}...`)
  console.log(`Using cookies from ${cookiesPath}`)
  console.log(`Bandcamp user: ${bandcampUser}`)

  try {
    // bandsnatch v0.5+ uses: bandsnatch run [OPTIONS] --format <FORMAT> <USER>
    const bsArgs = [
      'run',
      '--cookies', cookiesPath,
      '--format', 'flac',
      '--output-folder', STAGING_DIR,
      bandcampUser,
    ]
    const { stdout, stderr } = await execFileAsync(bandsnatchPath, bsArgs, {
      timeout: 3600_000, // 1 hour timeout
    })

    if (stdout) console.log(stdout)
    if (stderr) console.error(stderr)
    console.log('Bandcamp download complete!')
  } catch (err) {
    console.error(`Bandsnatch failed: ${(err as Error).message}`)
    console.error('Make sure bandsnatch is installed: https://github.com/Ovyerus/bandsnatch/releases')
    process.exit(1)
  }
}

interface AudioFile {
  path: string
  artist: string
  album: string
  title: string
  trackNumber: number
  format: 'flac' | 'mp3'
}

async function readMp3Tags(filePath: string): Promise<{ artist?: string; album?: string; title?: string; track?: string }> {
  const tags = NodeID3.read(filePath)
  return {
    artist: tags.artist,
    album: tags.album,
    title: tags.title,
    track: tags.trackNumber,
  }
}

function walkDir(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkDir(full))
    } else {
      const ext = path.extname(entry.name).toLowerCase()
      if (ext === '.flac' || ext === '.mp3') {
        files.push(full)
      }
    }
  }
  return files
}

function parsePathFallback(filePath: string, baseDir: string): { artist: string; album: string; title: string; trackNumber: number } {
  const rel = path.relative(baseDir, filePath)
  const parts = rel.split(path.sep)

  let artist = 'Unknown'
  let album = 'Unknown'
  let title = path.basename(filePath, path.extname(filePath))
  let trackNumber = 0

  if (parts.length >= 3) {
    artist = parts[0]
    album = parts[1]
    title = parts[2].replace(path.extname(parts[2]), '')
  } else if (parts.length >= 2) {
    artist = parts[0]
    title = parts[1].replace(path.extname(parts[1]), '')
  }

  // Strip leading track number
  const numMatch = title.match(/^(\d+)[\s._-]+(.+)$/)
  if (numMatch) {
    trackNumber = parseInt(numMatch[1])
    title = numMatch[2]
  }

  return { artist, album, title, trackNumber }
}

async function importFiles(sourceDir: string): Promise<void> {
  if (!existsSync(sourceDir)) {
    console.error(`Error: Directory not found: ${sourceDir}`)
    process.exit(1)
  }

  console.log(`\nScanning ${sourceDir} for audio files...`)
  const files = walkDir(sourceDir)
  console.log(`Found ${files.length} audio files\n`)

  let imported = 0
  let skipped = 0
  let errors = 0

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase()
    const format = ext === '.flac' ? 'flac' as const : 'mp3' as const

    // Read tags
    let tags: { artist?: string; album?: string; title?: string; track?: string }
    if (format === 'flac') {
      tags = await readFlacTags(filePath)
    } else {
      tags = await readMp3Tags(filePath)
    }

    // Fall back to path-based metadata if tags missing
    const fallback = parsePathFallback(filePath, sourceDir)
    const artist = tags.artist || fallback.artist
    const album = tags.album || fallback.album
    const title = tags.title || fallback.title
    const trackNumber = parseInt(tags.track || '0') || fallback.trackNumber

    if (artist === 'Unknown' && title === 'Unknown') {
      console.log(`  ✗ Skipping (no metadata): ${path.basename(filePath)}`)
      skipped++
      continue
    }

    // Compute destination path
    const relativePath = getTrackPath(artist, album, trackNumber, title, undefined, format)
    const absolutePath = getAbsolutePath(relativePath)

    if (dryRun) {
      console.log(`  [dry-run] ${artist} — ${album} / ${title} → ${relativePath}`)
      imported++
      continue
    }

    try {
      // Insert into DB
      const trackId = insertTrack({
        title,
        artist,
        album,
        track_number: trackNumber,
      })

      // Move file to library
      ensureDirectories(relativePath)
      renameSync(filePath, absolutePath)

      // Update DB
      updateTrackStatus(trackId, 'complete', {
        file_path: relativePath,
        format,
      })

      console.log(`  ✓ ${artist} — ${title} (${format.toUpperCase()})`)
      imported++
    } catch (err) {
      console.log(`  ✗ Error: ${artist} — ${title}: ${(err as Error).message}`)
      errors++
    }
  }

  console.log(`\n=== Import Summary ===`)
  console.log(`Imported: ${imported}, Skipped: ${skipped}, Errors: ${errors}`)

  // Trigger Navidrome scan
  if (!dryRun && imported > 0) {
    try {
      const { triggerNavidromeScan } = await import('../src/services/navidrome.js')
      await triggerNavidromeScan()
      console.log('Navidrome scan triggered')
    } catch {}
  }
}

async function main() {
  if (doDownload) {
    await downloadFromBandcamp()
  }

  if (doImport) {
    const importDir = customFolder || STAGING_DIR
    await importFiles(importDir)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
