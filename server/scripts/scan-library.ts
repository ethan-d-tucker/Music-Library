/**
 * Scan the music library for issues:
 * - Mangled/concatenated artist or album names (missing separators)
 * - Inconsistent folder naming (year tags, format tags, etc.)
 * - Missing album art
 * - Leftover temp files
 * - Duplicate artist folders (same artist, different naming)
 * - Empty folders
 *
 * Usage: cd server && npx tsx scripts/scan-library.ts
 */

import fs from 'fs'
import path from 'path'
import { MUSIC_DIR } from '../src/config.js'
import db from '../src/db/index.js'

interface Issue {
  type: string
  path: string
  detail: string
}

const issues: Issue[] = []

function addIssue(type: string, p: string, detail: string) {
  issues.push({ type, path: p, detail })
}

// --- Filesystem scan ---

function scanFolders() {
  console.log('Scanning folders...\n')

  const topLevel = fs.readdirSync(MUSIC_DIR, { withFileTypes: true })

  // Check for temp files and non-music files at root
  for (const entry of topLevel) {
    const full = path.join(MUSIC_DIR, entry.name)

    if (entry.isFile()) {
      if (entry.name.endsWith('.tmp') || entry.name.includes('.mjs.tmp.')) {
        addIssue('TEMP_FILE', full, 'Leftover temp file at library root')
      } else if (!entry.name.endsWith('.db') && !entry.name.endsWith('.db-shm') && !entry.name.endsWith('.db-wal')) {
        addIssue('STRAY_FILE', full, 'Non-database file at library root')
      }
      continue
    }

    if (!entry.isDirectory()) continue
    if (entry.name === 'Playlists') continue

    const artistDir = full
    const artistName = entry.name

    // Check for format/year tags in folder names
    if (/\[\d{2,3}[-\s]?\d{2,3}\s*(FLAC|flac)\]/.test(artistName) ||
        /\(?\d{4}\)?/.test(artistName) ||
        /vtwin88cube/.test(artistName) ||
        /\[EAC-FLAC\]/.test(artistName) ||
        /\(oan\)/.test(artistName) ||
        /Discography/i.test(artistName)) {
      addIssue('MESSY_ARTIST_FOLDER', artistDir, `Folder name has format/year tags: "${artistName}"`)
    }

    // Check for concatenated names (camelCase-like joins: lowercase followed by uppercase)
    if (/[a-z][A-Z]/.test(artistName) && !artistName.includes('Mt.') && !artistName.includes('McE')) {
      // Check if it looks like missing separator (e.g., "Merle HaggardThe Strangers")
      const parts = artistName.split(/(?<=[a-z])(?=[A-Z])/)
      if (parts.length > 1 && parts.some(p => p.length > 3)) {
        addIssue('CONCATENATED_NAME', artistDir, `Possible missing separator: "${artistName}" -> "${parts.join(' / ')}"`)
      }
    }

    // Scan album subdirectories
    if (!fs.existsSync(artistDir)) continue
    let albumDirs: fs.Dirent[]
    try {
      albumDirs = fs.readdirSync(artistDir, { withFileTypes: true })
    } catch {
      continue
    }

    const albumNames = albumDirs.filter(d => d.isDirectory()).map(d => d.name)

    if (albumDirs.length === 0) {
      addIssue('EMPTY_FOLDER', artistDir, 'Empty artist folder')
      continue
    }

    for (const albumEntry of albumDirs) {
      if (!albumEntry.isDirectory()) continue
      const albumDir = path.join(artistDir, albumEntry.name)
      const albumName = albumEntry.name

      // Check for format tags in album names
      if (/\[\d{2,3}[-\s]?\d{2,3}\s*(FLAC|flac|kHz)\]/.test(albumName) ||
          /vtwin88cube/.test(albumName) ||
          /\[EAC-FLAC\]/.test(albumName) ||
          /\(oan\)/.test(albumName)) {
        addIssue('MESSY_ALBUM_FOLDER', albumDir, `Album folder has format tags: "${albumName}"`)
      }

      // Check for album art
      const files = fs.readdirSync(albumDir)
      const hasArt = files.some(f =>
        /^(cover|folder|album|front|artwork)\.(jpg|jpeg|png|webp)$/i.test(f)
      )
      const hasMp3 = files.some(f => /\.(mp3|flac|m4a|ogg|opus)$/i.test(f))

      if (hasMp3 && !hasArt) {
        addIssue('MISSING_ART', albumDir, `No cover art found (${files.filter(f => /\.(mp3|flac|m4a|ogg|opus)$/i.test(f)).length} tracks)`)
      }

      if (files.length === 0) {
        addIssue('EMPTY_FOLDER', albumDir, 'Empty album folder')
      }

      // Check for concatenated album names
      if (/[a-z][A-Z]/.test(albumName)) {
        const parts = albumName.split(/(?<=[a-z])(?=[A-Z])/)
        if (parts.length > 1 && parts.some(p => p.length > 3)) {
          addIssue('CONCATENATED_NAME', albumDir, `Possible bad album name: "${albumName}"`)
        }
      }
    }
  }

  // Check for duplicate artist folders (similar names)
  const artistFolders = topLevel
    .filter(e => e.isDirectory() && e.name !== 'Playlists')
    .map(e => e.name)

  const normalized = new Map<string, string[]>()
  for (const name of artistFolders) {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!normalized.has(key)) normalized.set(key, [])
    normalized.get(key)!.push(name)
  }
  for (const [, names] of normalized) {
    if (names.length > 1) {
      addIssue('DUPLICATE_ARTIST', MUSIC_DIR, `Possible duplicate artist folders: ${names.map(n => `"${n}"`).join(', ')}`)
    }
  }
}

// --- Database scan ---

function scanDatabase() {
  console.log('Scanning database...\n')

  // Check for concatenated artist names in DB
  const artists = db.prepare('SELECT DISTINCT artist FROM tracks UNION SELECT DISTINCT album_artist FROM tracks').all() as { artist: string }[]
  for (const { artist } of artists) {
    if (!artist) continue
    // Look for camelCase joins that aren't normal (e.g., "McCartney" is ok, "HaggardThe" is not)
    const suspicious = /[a-z][A-Z][a-z]/.test(artist) &&
      !['McDonald', 'McCartney', 'McMurtry', 'MacIsaac', 'DeVille', 'McGraw', 'McEntire', 'McBride'].some(ok => artist.includes(ok))
    if (suspicious) {
      addIssue('DB_CONCATENATED_NAME', '', `Concatenated artist name in DB: "${artist}"`)
    }
  }

  // Check for tracks with no album art URL
  const noArt = db.prepare("SELECT COUNT(*) as c FROM tracks WHERE (album_art_url IS NULL OR album_art_url = '') AND download_status != 'pending'").get() as { c: number }
  if (noArt.c > 0) {
    addIssue('DB_MISSING_ART', '', `${noArt.c} downloaded tracks have no album art URL in database`)
  }

  // Check for very short or suspicious titles
  const badTitles = db.prepare("SELECT title, artist, album FROM tracks WHERE LENGTH(title) < 2 OR title LIKE '%/%' OR title LIKE '%\\%'").all() as { title: string; artist: string; album: string }[]
  for (const t of badTitles) {
    addIssue('DB_BAD_TITLE', '', `Suspicious track title: "${t.title}" by ${t.artist} on ${t.album}`)
  }
}

// --- Main ---

function main() {
  console.log(`Music Library Scanner`)
  console.log(`Library: ${MUSIC_DIR}\n`)

  scanFolders()
  scanDatabase()

  // Print results grouped by type
  const grouped = new Map<string, Issue[]>()
  for (const issue of issues) {
    if (!grouped.has(issue.type)) grouped.set(issue.type, [])
    grouped.get(issue.type)!.push(issue)
  }

  if (issues.length === 0) {
    console.log('No issues found!')
    return
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Found ${issues.length} issues:\n`)

  for (const [type, items] of grouped) {
    console.log(`--- ${type} (${items.length}) ---`)
    for (const item of items) {
      const rel = item.path ? path.relative(MUSIC_DIR, item.path) : '(database)'
      console.log(`  ${rel}`)
      console.log(`    ${item.detail}`)
    }
    console.log()
  }
}

main()
