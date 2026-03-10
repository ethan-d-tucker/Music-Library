/**
 * Fix Navidrome artist splitting & tag cleanup.
 * Corrects semicolon-separated artists, corrupted tags, missing tags,
 * and inconsistent formatting so Navidrome shows each artist on their own page.
 *
 * Usage:
 *   cd server && npx tsx scripts/fix-artist-tags.ts              # dry run
 *   cd server && npx tsx scripts/fix-artist-tags.ts --execute     # apply changes
 */

import fs from 'fs'
import path from 'path'
import NodeID3 from 'node-id3'
import { MUSIC_DIR, FFMPEG_DIR } from '../src/config.js'
import db from '../src/db/index.js'
import { readFlacTags } from '../src/services/normalizer.js'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const ffmpegPath = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffmpeg').replace(/\\/g, '/') : 'ffmpeg'

const args = process.argv.slice(2)
const executeMode = args.includes('--execute')

// Navidrome DB for finding file paths
const Database = (await import('better-sqlite3')).default
const navidromeDb = new Database('C:/Navidrome/data/navidrome.db', { readonly: true })

// Music library DB for updating records
const libraryDb = db

// -------------------------------------------------------------------
// Correction definitions
// -------------------------------------------------------------------

interface Correction {
  /** Human label for logging */
  label: string
  /** SQL LIKE pattern to match artist in Navidrome DB */
  matchPatterns: string[]
  /** Optional album filter */
  albumFilter?: string
  /** New display artist (ARTIST tag) */
  newArtist: string
  /** Individual artists for ARTISTS multi-value tag (null = don't split) */
  splitArtists: string[] | null
  /** New album artist */
  newAlbumArtist: string
  /** Individual album artists for ALBUMARTISTS multi-value tag (null = don't split) */
  splitAlbumArtists: string[] | null
  /** New album name (if renaming) */
  newAlbum?: string
}

const CORRECTIONS: Correction[] = [
  // 1. [Unknown Artist] — JTE bootleg
  {
    label: '[Unknown Artist] → Justin Townes Earle',
    matchPatterns: ['[Unknown Artist]'],
    newArtist: 'Justin Townes Earle',
    splitArtists: null,
    newAlbumArtist: 'Justin Townes Earle',
    splitAlbumArtists: null,
    newAlbum: 'Live 2012-05-07',
  },

  // 2. O Brother soundtrack — fix album_artist to Various Artists
  // These have correct track artists but wrong album_artist
  // We handle them by matching album + ensuring album_artist is set
  ...[
    'Alison Krauss, Emmylou Harris, Gillian Welch',
    'Alison Krauss, Gillian Welch',
    'The Clinch Mountain Boys, The Stanley Brothers',
    'Dan Tyminski, The Soggy Bottom Boys',
    'The Soggy Bottom Boys, Tim Blake Nelson',
    'The Cox Family',
  ].map(artist => ({
    label: `O Brother: ${artist} → album_artist=Various Artists`,
    matchPatterns: [artist],
    albumFilter: 'O Brother%',
    newArtist: artist, // keep track artist
    splitArtists: artist.includes(',') ? artist.split(',').map(s => s.trim()) : null,
    newAlbumArtist: 'Various Artists',
    splitAlbumArtists: null,
  })),
  {
    label: 'O Brother: Emmylou Harris;Alison Krauss;Gillian Welch → fix separators',
    matchPatterns: ['Emmylou Harris;Alison Krauss;Gillian Welch'],
    albumFilter: 'O Brother%',
    newArtist: 'Emmylou Harris, Alison Krauss, Gillian Welch',
    splitArtists: ['Emmylou Harris', 'Alison Krauss', 'Gillian Welch'],
    newAlbumArtist: 'Various Artists',
    splitAlbumArtists: null,
  },

  // 3. Bob Dylan;The Band
  {
    label: 'Bob Dylan;The Band → Bob Dylan, The Band',
    matchPatterns: ['Bob Dylan;The Band'],
    newArtist: 'Bob Dylan, The Band',
    splitArtists: ['Bob Dylan', 'The Band'],
    newAlbumArtist: 'Bob Dylan, The Band',
    splitAlbumArtists: ['Bob Dylan', 'The Band'],
  },

  // 4. Colter Wall;Belle Plaine
  {
    label: 'Colter Wall;Belle Plaine → Colter Wall, Belle Plaine',
    matchPatterns: ['Colter Wall;Belle Plaine'],
    newArtist: 'Colter Wall, Belle Plaine',
    splitArtists: ['Colter Wall', 'Belle Plaine'],
    newAlbumArtist: 'Colter Wall',
    splitAlbumArtists: null,
  },

  // 5. Danny Thompson, Darrell Scott, Kenny Malone
  {
    label: 'Danny Thompson, Darrell Scott, Kenny Malone → album_artist=Darrell Scott',
    matchPatterns: ['Danny Thompson, Darrell Scott, Kenny Malone', 'Kenny Malone, Danny Thompson, Darrell Scott'],
    newArtist: 'Darrell Scott, Danny Thompson, Kenny Malone',
    splitArtists: ['Darrell Scott', 'Danny Thompson', 'Kenny Malone'],
    newAlbumArtist: 'Darrell Scott',
    splitAlbumArtists: null,
  },

  // 6. Jason Isbell and Amanda Shires
  {
    label: 'Jason Isbell and Amanda Shires → Jason Isbell, Amanda Shires',
    matchPatterns: ['Jason Isbell and Amanda Shires'],
    newArtist: 'Jason Isbell, Amanda Shires',
    splitArtists: ['Jason Isbell', 'Amanda Shires'],
    newAlbumArtist: 'Jason Isbell, Amanda Shires',
    splitAlbumArtists: ['Jason Isbell', 'Amanda Shires'],
  },

  // 7. Jason Isbell and Friends
  {
    label: 'Jason Isbell and Friends → Jason Isbell',
    matchPatterns: ['Jason Isbell and Friends'],
    newArtist: 'Jason Isbell',
    splitArtists: null,
    newAlbumArtist: 'Jason Isbell',
    splitAlbumArtists: null,
  },

  // 8. Keith Whitley & Ricky Skaggs variants
  {
    label: 'Keith Whitley & Ricky Skaggs → Keith Whitley, Ricky Skaggs',
    matchPatterns: ['Keith Whitley & Ricky Skaggs', 'Keith Whitley And Ricky Skaggs'],
    newArtist: 'Keith Whitley, Ricky Skaggs',
    splitArtists: ['Keith Whitley', 'Ricky Skaggs'],
    newAlbumArtist: 'Keith Whitley, Ricky Skaggs',
    splitAlbumArtists: ['Keith Whitley', 'Ricky Skaggs'],
  },

  // 9. Ken Pomeroy;John Moreland
  {
    label: 'Ken Pomeroy;John Moreland → Ken Pomeroy, John Moreland',
    matchPatterns: ['Ken Pomeroy;John Moreland'],
    newArtist: 'Ken Pomeroy, John Moreland',
    splitArtists: ['Ken Pomeroy', 'John Moreland'],
    newAlbumArtist: 'Ken Pomeroy',
    splitAlbumArtists: null,
  },

  // 10. Kurt Vile;John Prine
  {
    label: 'Kurt Vile;John Prine → Kurt Vile, John Prine',
    matchPatterns: ['Kurt Vile;John Prine'],
    newArtist: 'Kurt Vile, John Prine',
    splitArtists: ['Kurt Vile', 'John Prine'],
    newAlbumArtist: 'Kurt Vile',
    splitAlbumArtists: null,
  },

  // 11. Lady Gaga;Bruno Mars
  {
    label: 'Lady Gaga;Bruno Mars → Lady Gaga, Bruno Mars',
    matchPatterns: ['Lady Gaga;Bruno Mars'],
    newArtist: 'Lady Gaga, Bruno Mars',
    splitArtists: ['Lady Gaga', 'Bruno Mars'],
    newAlbumArtist: 'Lady Gaga',
    splitAlbumArtists: null,
  },

  // 12. Merle Haggard + The Strangers (standardize — single entity, NOT split)
  ...[
    'Merle Haggard & The Strangers',
    'Merle Haggard And The Strangers',
    'Merle Haggard and the Strangers',
    'Merle HaggardThe Strangers',
    'Merle HaggardMerle HaggardThe Strangers',
  ].map(pattern => ({
    label: `${pattern} → Merle Haggard and The Strangers`,
    matchPatterns: [pattern],
    newArtist: 'Merle Haggard and The Strangers',
    splitArtists: null,
    newAlbumArtist: 'Merle Haggard and The Strangers',
    splitAlbumArtists: null,
  })),

  // 13. Merle Haggard & George Jones (+ corrupted variant)
  {
    label: 'Merle Haggard & George Jones → Merle Haggard, George Jones',
    matchPatterns: ['Merle Haggard & George Jones', 'Merle HaggardGeorge Jones'],
    newArtist: 'Merle Haggard, George Jones',
    splitArtists: ['Merle Haggard', 'George Jones'],
    newAlbumArtist: 'Merle Haggard, George Jones',
    splitAlbumArtists: ['Merle Haggard', 'George Jones'],
  },

  // 14. Bonnie Owens and Merle Haggard with The Strangers
  {
    label: 'Bonnie Owens and Merle Haggard with The Strangers → Bonnie Owens, Merle Haggard',
    matchPatterns: ['Bonnie Owens and Merle Haggard with The Strangers'],
    newArtist: 'Bonnie Owens, Merle Haggard',
    splitArtists: ['Bonnie Owens', 'Merle Haggard'],
    newAlbumArtist: 'Bonnie Owens, Merle Haggard',
    splitAlbumArtists: ['Bonnie Owens', 'Merle Haggard'],
  },

  // 15. Mike Cooley;Patterson Hood;Jason Isbell
  {
    label: 'Mike Cooley;Patterson Hood;Jason Isbell → comma separated',
    matchPatterns: ['Mike Cooley;Patterson Hood;Jason Isbell'],
    newArtist: 'Mike Cooley, Patterson Hood, Jason Isbell',
    splitArtists: ['Mike Cooley', 'Patterson Hood', 'Jason Isbell'],
    newAlbumArtist: 'Mike Cooley, Patterson Hood, Jason Isbell',
    splitAlbumArtists: ['Mike Cooley', 'Patterson Hood', 'Jason Isbell'],
  },

  // 16. Neil Young;Crazy Horse (single entity — artist + band)
  {
    label: 'Neil Young;Crazy Horse → Neil Young & Crazy Horse',
    matchPatterns: ['Neil Young;Crazy Horse'],
    newArtist: 'Neil Young & Crazy Horse',
    splitArtists: null,
    newAlbumArtist: 'Neil Young & Crazy Horse',
    splitAlbumArtists: null,
  },

  // 17. Taylor Swift;Post Malone
  {
    label: 'Taylor Swift;Post Malone → Taylor Swift, Post Malone',
    matchPatterns: ['Taylor Swift;Post Malone'],
    newArtist: 'Taylor Swift, Post Malone',
    splitArtists: ['Taylor Swift', 'Post Malone'],
    newAlbumArtist: 'Taylor Swift',
    splitAlbumArtists: null,
  },

  // 18. Willie Nelson;Lukas Nelson
  {
    label: 'Willie Nelson;Lukas Nelson → Willie Nelson, Lukas Nelson',
    matchPatterns: ['Willie Nelson;Lukas Nelson'],
    newArtist: 'Willie Nelson, Lukas Nelson',
    splitArtists: ['Willie Nelson', 'Lukas Nelson'],
    newAlbumArtist: 'Willie Nelson',
    splitAlbumArtists: null,
  },

  // 19. Zach Bryan;Charles Wesley Godwin
  {
    label: 'Zach Bryan;Charles Wesley Godwin → Zach Bryan, Charles Wesley Godwin',
    matchPatterns: ['Zach Bryan;Charles Wesley Godwin'],
    newArtist: 'Zach Bryan, Charles Wesley Godwin',
    splitArtists: ['Zach Bryan', 'Charles Wesley Godwin'],
    newAlbumArtist: 'Zach Bryan',
    splitAlbumArtists: null,
  },
]

// -------------------------------------------------------------------
// File discovery — find actual files on disk via Navidrome DB
// -------------------------------------------------------------------

interface FileToFix {
  navidromePath: string // relative path in Navidrome DB
  fullPath: string      // absolute path on disk
  suffix: string        // mp3 or flac
  currentArtist: string
  currentAlbumArtist: string
  currentAlbum: string
  currentTitle: string
  correction: Correction
}

function findFilesToFix(): FileToFix[] {
  const files: FileToFix[] = []
  const globalSeen = new Set<string>()

  for (const correction of CORRECTIONS) {
    for (const pattern of correction.matchPatterns) {
      let query = `SELECT path, suffix, artist, album_artist, album, title FROM media_file WHERE artist = ?`
      const params: string[] = [pattern]

      if (correction.albumFilter) {
        query += ` AND album LIKE ?`
        params.push(correction.albumFilter)
      }

      const rows = navidromeDb.prepare(query).all(...params) as {
        path: string; suffix: string; artist: string; album_artist: string; album: string; title: string
      }[]

      // Also check album_artist matches for cases where artist is already correct
      // but album_artist is wrong (O Brother soundtrack, corrupted tags)
      let extraRows: typeof rows = []
      if (correction.albumFilter) {
        extraRows = navidromeDb.prepare(
          `SELECT path, suffix, artist, album_artist, album, title FROM media_file WHERE album_artist = ? AND album LIKE ?`
        ).all(pattern, correction.albumFilter) as typeof rows
      } else {
        // Also match by album_artist (catches files where artist was fixed but album_artist wasn't)
        extraRows = navidromeDb.prepare(
          `SELECT path, suffix, artist, album_artist, album, title FROM media_file WHERE album_artist = ?`
        ).all(pattern) as typeof rows
      }

      const allRows = [...rows, ...extraRows]

      for (const row of allRows) {
        if (globalSeen.has(row.path)) continue
        globalSeen.add(row.path)

        const fullPath = path.join(MUSIC_DIR, row.path).replace(/\\/g, '/')
        files.push({
          navidromePath: row.path,
          fullPath,
          suffix: row.suffix,
          currentArtist: row.artist,
          currentAlbumArtist: row.album_artist,
          currentAlbum: row.album,
          currentTitle: row.title,
          correction,
        })
      }
    }
  }

  return files
}

// -------------------------------------------------------------------
// Tag writing
// -------------------------------------------------------------------

async function writeFlacTagsWithMultiArtist(
  filePath: string,
  tags: {
    artist: string
    album: string
    title: string
    trackNumber: number
    albumArtist?: string
    splitArtists?: string[]
    splitAlbumArtists?: string[]
  }
): Promise<void> {
  const tmpPath = filePath + '.tmp.' + Date.now() + '.flac'
  const ffmpegArgs = [
    '-y', '-i', filePath,
    '-map', '0', '-map_metadata', '-1', '-c', 'copy',
    '-metadata', `ARTIST=${tags.artist}`,
    '-metadata', `ALBUM=${tags.album}`,
    '-metadata', `TITLE=${tags.title}`,
  ]

  if (tags.albumArtist) {
    ffmpegArgs.push('-metadata', `ALBUMARTIST=${tags.albumArtist}`)
  }
  if (tags.trackNumber > 0) {
    ffmpegArgs.push('-metadata', `TRACKNUMBER=${tags.trackNumber}`)
  }

  // Write multi-value ARTISTS tags
  // ffmpeg supports multiple -metadata flags with the same key for Vorbis comments
  if (tags.splitArtists) {
    for (const a of tags.splitArtists) {
      ffmpegArgs.push('-metadata', `ARTISTS=${a}`)
    }
  }
  if (tags.splitAlbumArtists) {
    for (const a of tags.splitAlbumArtists) {
      ffmpegArgs.push('-metadata', `ALBUMARTISTS=${a}`)
    }
  }

  ffmpegArgs.push(tmpPath)

  await execFileAsync(ffmpegPath, ffmpegArgs, { timeout: 30000 })
  fs.renameSync(tmpPath, filePath)
}

function writeMp3TagsWithMultiArtist(
  filePath: string,
  tags: {
    artist: string
    albumArtist?: string
    splitArtists?: string[]
    splitAlbumArtists?: string[]
    album?: string
    title?: string
  }
): void {
  // For MP3, Navidrome splits on " / " separator
  const displayArtist = tags.splitArtists
    ? tags.splitArtists.join(' / ')
    : tags.artist
  const displayAlbumArtist = tags.splitAlbumArtists
    ? tags.splitAlbumArtists.join(' / ')
    : tags.albumArtist

  const id3Updates: Record<string, any> = {
    artist: displayArtist,
  }
  if (displayAlbumArtist) {
    id3Updates.performerInfo = displayAlbumArtist
  }
  if (tags.album) {
    id3Updates.album = tags.album
  }

  NodeID3.update(id3Updates, filePath)
}

// -------------------------------------------------------------------
// Folder renaming
// -------------------------------------------------------------------

function computeNewPath(file: FileToFix): string | null {
  const relPath = file.navidromePath.replace(/\\/g, '/')
  const parts = relPath.split('/')

  if (parts.length < 2) return null

  const artistFolder = parts[0]
  const correction = file.correction
  const newAlbumArtist = correction.newAlbumArtist
  const expectedFolder = newAlbumArtist
  const newAlbum = correction.newAlbum

  let changed = false
  const newParts = [...parts]

  if (artistFolder !== expectedFolder) {
    newParts[0] = expectedFolder
    changed = true
  }

  if (parts.length === 2 && newAlbum) {
    // File is directly in artist folder (no album subfolder) — add album folder
    const fileName = newParts[1]
    newParts[1] = newAlbum
    newParts.push(fileName)
    changed = true
  } else if (parts.length >= 3 && newAlbum && parts[1] !== newAlbum) {
    newParts[1] = newAlbum
    changed = true
  }

  if (!changed) return null

  return newParts.join('/')
}

// -------------------------------------------------------------------
// Album art search
// -------------------------------------------------------------------

async function searchAlbumArt(artist: string, album: string): Promise<string | null> {
  // 1. Try MusicBrainz / Cover Art Archive
  try {
    const mbQuery = encodeURIComponent(`${album} AND artist:${artist}`)
    const mbRes = await fetch(`https://musicbrainz.org/ws/2/release-group/?query=${mbQuery}&limit=3&fmt=json`, {
      headers: { 'User-Agent': 'MusicLibrary/1.0 (github.com)' },
      signal: AbortSignal.timeout(10000),
    })
    if (mbRes.ok) {
      const data = await mbRes.json() as any
      const rgs = data['release-groups'] || []
      for (const rg of rgs) {
        try {
          const artRes = await fetch(`https://coverartarchive.org/release-group/${rg.id}/front`, {
            redirect: 'follow',
            signal: AbortSignal.timeout(10000),
          })
          if (artRes.ok) {
            return artRes.url
          }
        } catch {}
      }
    }
  } catch {}

  // 2. Try Deezer
  try {
    const deezerQuery = encodeURIComponent(`${artist} ${album}`)
    const deezerRes = await fetch(`https://api.deezer.com/search/album?q=${deezerQuery}&limit=3`, {
      signal: AbortSignal.timeout(10000),
    })
    if (deezerRes.ok) {
      const data = await deezerRes.json() as any
      const albums = data.data || []
      if (albums.length > 0 && albums[0].cover_xl) {
        return albums[0].cover_xl
      }
    }
  } catch {}

  // 3. Try iTunes
  try {
    const itunesQuery = encodeURIComponent(`${artist} ${album}`)
    const itunesRes = await fetch(`https://itunes.apple.com/search?term=${itunesQuery}&entity=album&limit=3`, {
      signal: AbortSignal.timeout(10000),
    })
    if (itunesRes.ok) {
      const data = await itunesRes.json() as any
      const results = data.results || []
      if (results.length > 0 && results[0].artworkUrl100) {
        // Get high-res version
        return results[0].artworkUrl100.replace('100x100bb', '1200x1200bb')
      }
    }
  } catch {}

  return null
}

async function downloadArt(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'follow' })
    if (!res.ok) return false
    const buffer = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(destPath, buffer)
    return true
  } catch {
    return false
  }
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

async function main() {
  console.log(`Mode: ${executeMode ? 'EXECUTE' : 'DRY RUN'}\n`)

  const files = findFilesToFix()
  console.log(`Found ${files.length} files to fix\n`)

  // Group by correction for display
  const byCorrection = new Map<string, FileToFix[]>()
  for (const f of files) {
    const key = f.correction.label
    if (!byCorrection.has(key)) byCorrection.set(key, [])
    byCorrection.get(key)!.push(f)
  }

  for (const [label, groupFiles] of byCorrection) {
    console.log(`\n=== ${label} (${groupFiles.length} files) ===`)
    for (const f of groupFiles.slice(0, 3)) {
      const newPath = computeNewPath(f)
      console.log(`  ${f.navidromePath}`)
      console.log(`    artist: "${f.currentArtist}" → "${f.correction.newArtist}"`)
      console.log(`    album_artist: "${f.currentAlbumArtist}" → "${f.correction.newAlbumArtist}"`)
      if (f.correction.splitArtists) {
        console.log(`    ARTISTS split: [${f.correction.splitArtists.join(', ')}]`)
      }
      if (f.correction.newAlbum) {
        console.log(`    album: "${f.currentAlbum}" → "${f.correction.newAlbum}"`)
      }
      if (newPath) {
        console.log(`    move: → ${newPath}`)
      }
    }
    if (groupFiles.length > 3) {
      console.log(`  ... and ${groupFiles.length - 3} more files`)
    }
  }

  if (!executeMode) {
    console.log('\n\nDry run complete. Run with --execute to apply changes.')
    navidromeDb.close()
    process.exit(0)
  }

  // --- Execute changes ---
  console.log('\n\nApplying changes...\n')

  let tagFixed = 0
  let moved = 0
  let errors = 0

  // Track folder renames to avoid duplicating
  const renamedFolders = new Set<string>()

  for (const file of files) {
    const { correction, fullPath, suffix } = file

    // Check file exists
    if (!fs.existsSync(fullPath)) {
      console.log(`  SKIP (not found): ${fullPath}`)
      errors++
      continue
    }

    try {
      // 1. Write tags
      if (suffix === 'flac') {
        const existing = await readFlacTags(fullPath)
        await writeFlacTagsWithMultiArtist(fullPath, {
          artist: correction.newArtist,
          album: correction.newAlbum || file.currentAlbum,
          title: existing.title || file.currentTitle,
          trackNumber: parseInt(existing.track || '0') || 0,
          albumArtist: correction.newAlbumArtist,
          splitArtists: correction.splitArtists || undefined,
          splitAlbumArtists: correction.splitAlbumArtists || undefined,
        })
      } else {
        writeMp3TagsWithMultiArtist(fullPath, {
          artist: correction.newArtist,
          albumArtist: correction.newAlbumArtist,
          splitArtists: correction.splitArtists || undefined,
          splitAlbumArtists: correction.splitAlbumArtists || undefined,
          album: correction.newAlbum,
        })
      }

      tagFixed++
      process.stdout.write('.')

      // 2. Move file if folder needs renaming
      const newRelPath = computeNewPath(file)
      if (newRelPath) {
        const newFullPath = path.join(MUSIC_DIR, newRelPath).replace(/\\/g, '/')
        const newDir = path.dirname(newFullPath)

        if (!fs.existsSync(newDir)) {
          fs.mkdirSync(newDir, { recursive: true })
        }

        // Move the file
        const currentPath = fullPath
        if (currentPath !== newFullPath) {
          fs.renameSync(currentPath, newFullPath)
          moved++
        }
      }
    } catch (err) {
      console.log(`\n  ERROR: ${file.navidromePath}: ${(err as Error).message}`)
      errors++
    }
  }

  console.log(`\n\nTags fixed: ${tagFixed}, Files moved: ${moved}, Errors: ${errors}`)

  // 3. Clean up empty folders
  console.log('\nCleaning up empty folders...')
  cleanEmptyFolders(MUSIC_DIR)

  // 4. Update library DB
  console.log('\nUpdating library DB...')
  updateLibraryDb(files)

  // 5. Search for album art
  console.log('\nSearching for album art...')
  await fetchArtForAffectedAlbums(files)

  // 6. Trigger Navidrome scan
  console.log('\nTriggering Navidrome scan...')
  try {
    const scanRes = await fetch(
      'http://localhost:4533/rest/startScan.view?u=admin&p=ADMIN&c=music-library&v=1.16.1&f=json',
      { signal: AbortSignal.timeout(10000) }
    )
    console.log(`  Scan triggered: ${scanRes.ok ? 'OK' : 'FAILED'}`)
  } catch (err) {
    console.log(`  Scan trigger failed: ${(err as Error).message}`)
  }

  navidromeDb.close()
  console.log('\nDone!')
}

function cleanEmptyFolders(dir: string) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'Playlists') continue
      const subDir = path.join(dir, entry.name)
      cleanEmptyFolders(subDir)
      // Check if now empty
      const remaining = fs.readdirSync(subDir)
      if (remaining.length === 0) {
        fs.rmdirSync(subDir)
        console.log(`  Removed empty folder: ${path.relative(MUSIC_DIR, subDir)}`)
      }
    }
  } catch {}
}

function updateLibraryDb(files: FileToFix[]) {
  const updateStmt = libraryDb.prepare(
    `UPDATE tracks SET artist = ?, album_artist = ?, album = COALESCE(?, album) WHERE file_path LIKE ?`
  )

  let updated = 0
  for (const file of files) {
    const correction = file.correction
    const newRelPath = computeNewPath(file)
    const searchPath = newRelPath
      ? `%${path.basename(file.navidromePath)}` // search by filename if moved
      : `%${file.navidromePath}`

    try {
      const result = updateStmt.run(
        correction.newArtist,
        correction.newAlbumArtist,
        correction.newAlbum || null,
        searchPath
      )
      if (result.changes > 0) updated++
    } catch {}
  }

  console.log(`  Updated ${updated} library DB records`)
}

async function fetchArtForAffectedAlbums(files: FileToFix[]) {
  // Collect unique album directories
  const albumDirs = new Map<string, { artist: string; album: string }>()
  for (const file of files) {
    const relPath = computeNewPath(file) || file.navidromePath
    const parts = relPath.replace(/\\/g, '/').split('/')
    if (parts.length >= 3) {
      const albumDir = path.join(MUSIC_DIR, parts[0], parts[1]).replace(/\\/g, '/')
      if (!albumDirs.has(albumDir)) {
        albumDirs.set(albumDir, {
          artist: file.correction.newAlbumArtist,
          album: file.correction.newAlbum || file.currentAlbum,
        })
      }
    }
  }

  let fetched = 0
  let skipped = 0

  for (const [albumDir, { artist, album }] of albumDirs) {
    // Check if cover already exists
    if (!fs.existsSync(albumDir)) continue
    const existingFiles = fs.readdirSync(albumDir)
    const hasCover = existingFiles.some(f => /^(cover|folder|album|front|artwork)\.(jpg|jpeg|png|webp)$/i.test(f))
    if (hasCover) {
      skipped++
      continue
    }

    console.log(`  Searching art for: ${artist} — ${album}`)
    const artUrl = await searchAlbumArt(artist, album)
    if (artUrl) {
      const destPath = path.join(albumDir, 'cover.jpg')
      const ok = await downloadArt(artUrl, destPath)
      if (ok) {
        console.log(`    ✓ Downloaded cover art`)
        fetched++
      } else {
        console.log(`    ✗ Download failed`)
      }
    } else {
      console.log(`    ✗ No album art found`)
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 1500))
  }

  console.log(`  Album art: ${fetched} downloaded, ${skipped} already had art`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  navidromeDb.close()
  process.exit(1)
})
