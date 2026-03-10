/**
 * Clean up the music library:
 * - Fix concatenated artist names (missing separators)
 * - Consolidate duplicate/variant artist folders
 * - Fix ID3 tags to match canonical names
 * - Update the SQLite database
 * - Compare with Navidrome to find missing artists
 *
 * Usage:
 *   cd server && npx tsx scripts/cleanup-library.ts                    # dry run
 *   cd server && npx tsx scripts/cleanup-library.ts --execute           # apply changes
 *   cd server && npx tsx scripts/cleanup-library.ts --fetch-art         # download missing cover art
 *   cd server && npx tsx scripts/cleanup-library.ts --embed-art         # embed cover.jpg into MP3 ID3 tags
 *   cd server && npx tsx scripts/cleanup-library.ts --fix-db-art        # backfill album_art_url in DB
 *   cd server && npx tsx scripts/cleanup-library.ts --navidrome-check   # compare with Navidrome
 *   cd server && npx tsx scripts/cleanup-library.ts /d/Music/library    # target different dir
 */

import fs from 'fs'
import path from 'path'
import readline from 'readline'
import NodeID3 from 'node-id3'
import { MUSIC_DIR, FFMPEG_DIR, NAVIDROME_URL, NAVIDROME_USER, NAVIDROME_PASS } from '../src/config.js'
import db from '../src/db/index.js'
import { readFlacTags, writeFlacTags, writeMp3Tags } from '../src/services/normalizer.js'

// --- CLI args ---
const args = process.argv.slice(2)
const executeMode = args.includes('--execute')
const navidromeCheck = args.includes('--navidrome-check')
const fetchArt = args.includes('--fetch-art')
const embedArt = args.includes('--embed-art')
const fixDbArt = args.includes('--fix-db-art')
const autoYes = args.includes('--yes') || args.includes('-y')
const musicDir = args.find(a => !a.startsWith('-')) || MUSIC_DIR

// --- MusicBrainz helpers (adapted from top-music.ts) ---
const USER_AGENT = 'MusicLibraryCleanup/1.0 (local)'

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
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

interface MBArtistCredit { name: string; joinphrase?: string; artist?: { id: string; name: string } }

function formatCredit(credits: MBArtistCredit[]): string {
  return credits.map(c => c.name + (c.joinphrase || '')).join('')
}

async function searchArtist(name: string): Promise<{ id: string; name: string } | null> {
  const data = await mbFetch<{ artists: { id: string; name: string }[] }>(
    `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(`"${name}"`)}&limit=5&fmt=json`
  )
  const match = data.artists?.find(a => a.name.toLowerCase() === name.toLowerCase())
  return match || data.artists?.[0] || null
}

async function searchRelease(artist: string, album: string): Promise<MBArtistCredit[] | null> {
  try {
    const query = `release:"${album}" AND artist:"${artist}"`
    const data = await mbFetch<{ releases: { id: string; title: string; 'artist-credit': MBArtistCredit[] }[] }>(
      `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&limit=5&fmt=json`
    )
    if (data.releases?.length > 0) {
      // Find best match
      const exact = data.releases.find(r =>
        r.title.toLowerCase() === album.toLowerCase()
      )
      const release = exact || data.releases[0]
      return release['artist-credit'] || null
    }
  } catch {}
  return null
}

// --- Known camelCase exceptions (not concatenation bugs) ---
const CAMELCASE_OK = [
  'McDonald', 'McCartney', 'McMurtry', 'MacIsaac', 'DeVille',
  'McGraw', 'McEntire', 'McBride', 'McCoy', 'McCoury',
  'Mt.', 'Mt ', 'MacArthur', 'McCall',
]

function isConcatenated(name: string): boolean {
  if (!(/[a-z][A-Z]/.test(name))) return false
  if (CAMELCASE_OK.some(ok => name.includes(ok))) return false
  // Split and check if parts look like real names (> 3 chars each)
  const parts = name.split(/(?<=[a-z])(?=[A-Z])/)
  return parts.length > 1 && parts.some(p => p.length > 3)
}

function splitConcatenated(name: string): string[] {
  return name.split(/(?<=[a-z])(?=[A-Z])/)
}

// --- Artist name variant aliases ---
// Maps lowercase variant -> canonical name
// These are used to detect and fix non-concatenation variants
const ARTIST_ALIASES: Record<string, string> = {
  'tyler the creator': 'Tyler, The Creator',
  'tyler, the creator': 'Tyler, The Creator',
  'the creator, tyler': 'Tyler, The Creator',
  'jason isbell & the 400 unit': 'Jason Isbell and the 400 Unit',
  'jason isbell and the 400 unit': 'Jason Isbell and the 400 Unit',
  'jason isbell & the four hundred unit': 'Jason Isbell and the 400 Unit',
  'justin towes earle': 'Justin Townes Earle',
  'justin townes earle': 'Justin Townes Earle',
  'sturgill simpson': 'Sturgill Simpson',
  'johnny blue skies': 'Johnny Blue Skies',
}

function getCanonicalAlias(name: string): string | null {
  const lower = name.toLowerCase()
  const alias = ARTIST_ALIASES[lower]
  if (alias && alias !== name) return alias
  return null
}

// --- Normalize for clustering ---
function normalizeForCluster(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(the|and|with|&|,)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}

// --- Types ---
interface ScannedAlbum {
  artistFolder: string
  albumFolder: string
  fullPath: string
  files: { path: string; ext: string }[]
}

interface ArtistCluster {
  normalizedKey: string
  folderNames: string[]
  albums: ScannedAlbum[]
  canonicalName?: string
  // Per-album canonical artist (some albums may have different credits)
  albumCredits: Map<string, string>
}

interface TagFix {
  filePath: string
  field: 'artist' | 'albumArtist'
  oldValue: string
  newValue: string
  ext: string
}

interface FolderMove {
  fromArtist: string
  toArtist: string
  albumFolder: string
  fromPath: string
  toPath: string
}

interface DbUpdate {
  field: 'artist' | 'album_artist'
  oldValue: string
  newValue: string
  albumFilter?: string // only update rows matching this album
}

interface CleanupPlan {
  folderMoves: FolderMove[]
  tagFixes: TagFix[]
  dbUpdates: DbUpdate[]
  emptyDirsToRemove: string[]
}

// ============================================================
// Phase 1: Scan
// ============================================================
function scanLibrary(): ScannedAlbum[] {
  console.log(`Scanning: ${musicDir}\n`)
  const albums: ScannedAlbum[] = []

  const topLevel = fs.readdirSync(musicDir, { withFileTypes: true })
  for (const entry of topLevel) {
    if (!entry.isDirectory() || entry.name === 'Playlists') continue
    const artistDir = path.join(musicDir, entry.name)

    let albumEntries: fs.Dirent[]
    try {
      albumEntries = fs.readdirSync(artistDir, { withFileTypes: true })
    } catch { continue }

    for (const albumEntry of albumEntries) {
      if (!albumEntry.isDirectory()) continue
      const albumDir = path.join(artistDir, albumEntry.name)

      let files: string[]
      try {
        files = fs.readdirSync(albumDir)
      } catch { continue }

      const audioFiles = files
        .filter(f => /\.(mp3|flac|m4a|ogg|opus)$/i.test(f))
        .map(f => ({
          path: path.join(albumDir, f),
          ext: path.extname(f).toLowerCase(),
        }))

      if (audioFiles.length > 0) {
        albums.push({
          artistFolder: entry.name,
          albumFolder: albumEntry.name,
          fullPath: albumDir,
          files: audioFiles,
        })
      }
    }
  }

  console.log(`Found ${albums.length} albums across ${new Set(albums.map(a => a.artistFolder)).size} artist folders\n`)
  return albums
}

// ============================================================
// Phase 2: Detect & Cluster
// ============================================================
function detectClusters(albums: ScannedAlbum[]): ArtistCluster[] {
  // Group by normalized key
  const clusterMap = new Map<string, ArtistCluster>()

  for (const album of albums) {
    let artistName = album.artistFolder

    // If concatenated, try to extract the primary artist for clustering
    if (isConcatenated(artistName)) {
      const parts = splitConcatenated(artistName)
      // Use all parts for normalization so "Merle HaggardThe Strangers"
      // clusters with "Merle Haggard & The Strangers"
      artistName = parts.join(' ')
    }

    const key = normalizeForCluster(artistName)

    if (!clusterMap.has(key)) {
      clusterMap.set(key, {
        normalizedKey: key,
        folderNames: [],
        albums: [],
        albumCredits: new Map(),
      })
    }

    const cluster = clusterMap.get(key)!
    if (!cluster.folderNames.includes(album.artistFolder)) {
      cluster.folderNames.push(album.artistFolder)
    }
    cluster.albums.push(album)
  }

  // Only return clusters that have issues (concatenated names, multiple variants, or known alias mismatches)
  const problematic = [...clusterMap.values()].filter(c =>
    c.folderNames.length > 1 ||
    c.folderNames.some(n => isConcatenated(n)) ||
    c.folderNames.some(n => getCanonicalAlias(n) !== null)
  )

  console.log(`Found ${problematic.length} artist clusters with issues:`)
  for (const c of problematic) {
    console.log(`  [${c.normalizedKey}] ${c.folderNames.map(n => `"${n}"`).join(', ')} (${c.albums.length} albums)`)
  }
  console.log()

  return problematic
}

// ============================================================
// Phase 2b: Scan all files for alias mismatches
// ============================================================
function scanForAliasMismatches(albums: ScannedAlbum[]): TagFix[] {
  console.log('Scanning all files for artist name variants...')
  const fixes: TagFix[] = []

  for (const album of albums) {
    // Check folder name alias
    const folderAlias = getCanonicalAlias(album.artistFolder)

    for (const file of album.files) {
      if (file.ext !== '.mp3') continue
      try {
        const tags = NodeID3.read(file.path)
        const artist = tags.artist || ''
        const albumArtist = tags.performerInfo || ''

        // Check if artist tag has a known alias
        const artistAlias = getCanonicalAlias(artist)
        if (artistAlias) {
          fixes.push({
            filePath: file.path,
            field: 'artist',
            oldValue: artist,
            newValue: artistAlias,
            ext: file.ext,
          })
        }

        // Check if albumArtist tag has a known alias
        const albumArtistAlias = getCanonicalAlias(albumArtist)
        if (albumArtistAlias) {
          fixes.push({
            filePath: file.path,
            field: 'albumArtist',
            oldValue: albumArtist,
            newValue: albumArtistAlias,
            ext: file.ext,
          })
        }
      } catch {}
    }
  }

  if (fixes.length > 0) {
    // Group for display
    const groups = new Map<string, number>()
    for (const fix of fixes) {
      const key = `${fix.field}: "${fix.oldValue}" -> "${fix.newValue}"`
      groups.set(key, (groups.get(key) || 0) + 1)
    }
    console.log(`  Found ${fixes.length} alias-based tag fixes:`)
    for (const [desc, count] of groups) {
      console.log(`    ${desc} (${count} files)`)
    }
  } else {
    console.log('  No alias mismatches found')
  }
  console.log()

  return fixes
}

// ============================================================
// Phase 3: Resolve via MusicBrainz
// ============================================================
async function resolveCanonical(clusters: ArtistCluster[]): Promise<void> {
  console.log('Resolving canonical names via MusicBrainz...\n')

  for (const cluster of clusters) {
    // Check if any folder name has a known alias — use that directly
    const aliasMatch = cluster.folderNames.map(n => getCanonicalAlias(n)).find(a => a !== null)
    if (aliasMatch && !cluster.folderNames.some(n => isConcatenated(n)) && cluster.folderNames.length === 1) {
      // Simple alias fix — no need for MusicBrainz
      console.log(`  Alias match: "${cluster.folderNames[0]}" -> "${aliasMatch}"`)
      cluster.canonicalName = aliasMatch
      for (const album of cluster.albums) {
        cluster.albumCredits.set(album.albumFolder, aliasMatch)
      }
      console.log()
      continue
    }

    // Extract primary artist name from the cluster
    // Use the first non-concatenated folder name, or split the concatenated one
    let primaryArtist = cluster.folderNames.find(n => !isConcatenated(n))
    if (!primaryArtist) {
      // All names are concatenated — use the first split part
      const parts = splitConcatenated(cluster.folderNames[0])
      primaryArtist = parts[0]
    }

    // Check alias for the primary artist
    const primaryAlias = getCanonicalAlias(primaryArtist)
    if (primaryAlias) primaryArtist = primaryAlias

    // Strip common collaborator suffixes for the primary search
    const searchName = primaryArtist
      .replace(/\s*(&|and|with)\s+.+$/i, '')
      .trim()

    console.log(`  Searching MusicBrainz for "${searchName}"...`)

    const mbArtist = await searchArtist(searchName)
    if (!mbArtist) {
      console.log(`    Not found — skipping cluster`)
      continue
    }
    console.log(`    Found: ${mbArtist.name}`)

    // For each album in the cluster, look up the specific release credit
    for (const album of cluster.albums) {
      const albumName = album.albumFolder
        .replace(/\s*\(\d{4}\).*$/, '')  // strip year
        .replace(/\s*\[.*$/, '')          // strip tags
        .trim()

      console.log(`    Looking up album: "${albumName}"...`)
      const credits = await searchRelease(searchName, albumName)

      if (credits && credits.length > 0) {
        const canonical = formatCredit(credits)
        cluster.albumCredits.set(album.albumFolder, canonical)
        console.log(`      -> "${canonical}"`)
      } else {
        // Fallback: use the MusicBrainz artist name as-is
        cluster.albumCredits.set(album.albumFolder, mbArtist.name)
        console.log(`      -> "${mbArtist.name}" (fallback)`)
      }
    }

    // Set cluster canonical to the most common credit
    const creditCounts = new Map<string, number>()
    for (const credit of cluster.albumCredits.values()) {
      creditCounts.set(credit, (creditCounts.get(credit) || 0) + 1)
    }
    const sorted = [...creditCounts.entries()].sort((a, b) => b[1] - a[1])
    cluster.canonicalName = sorted[0]?.[0] || primaryArtist
    console.log(`    Cluster canonical: "${cluster.canonicalName}"\n`)
  }
}

// ============================================================
// Phase 4: Build Plan
// ============================================================
function buildPlan(clusters: ArtistCluster[]): CleanupPlan {
  const plan: CleanupPlan = {
    folderMoves: [],
    tagFixes: [],
    dbUpdates: [],
    emptyDirsToRemove: [],
  }

  for (const cluster of clusters) {
    if (!cluster.canonicalName) continue

    for (const album of cluster.albums) {
      // Determine target artist folder for this album
      const targetArtist = cluster.albumCredits.get(album.albumFolder) || cluster.canonicalName
      const targetPath = path.join(musicDir, targetArtist, album.albumFolder)

      // Need to move?
      if (album.artistFolder !== targetArtist) {
        plan.folderMoves.push({
          fromArtist: album.artistFolder,
          toArtist: targetArtist,
          albumFolder: album.albumFolder,
          fromPath: album.fullPath,
          toPath: targetPath,
        })
      }

      // Check tags for each file
      for (const file of album.files) {
        if (file.ext === '.mp3') {
          try {
            const tags = NodeID3.read(file.path)
            const artist = tags.artist || ''
            const albumArtist = tags.performerInfo || ''

            if (artist && isConcatenated(artist)) {
              plan.tagFixes.push({
                filePath: file.path,
                field: 'artist',
                oldValue: artist,
                newValue: targetArtist,
                ext: file.ext,
              })
            }
            if (albumArtist && isConcatenated(albumArtist)) {
              plan.tagFixes.push({
                filePath: file.path,
                field: 'albumArtist',
                oldValue: albumArtist,
                newValue: targetArtist,
                ext: file.ext,
              })
            }
          } catch {}
        }
        // FLAC tags will be read async during execution — just plan by folder name
        if (file.ext === '.flac' && isConcatenated(album.artistFolder)) {
          plan.tagFixes.push({
            filePath: file.path,
            field: 'artist',
            oldValue: album.artistFolder,
            newValue: targetArtist,
            ext: file.ext,
          })
        }
      }

      // DB updates — per-album, matching on artist + album name for precision
      if (album.artistFolder !== targetArtist) {
        plan.dbUpdates.push({
          field: 'album_artist',
          oldValue: album.artistFolder,
          newValue: targetArtist,
          albumFilter: album.albumFolder,
        })
      }
    }

    // Track empty dirs that will result from moves
    const sourceFolders = new Set(cluster.albums.map(a => a.artistFolder))
    for (const folder of sourceFolders) {
      if (folder === cluster.canonicalName) continue
      // If ALL albums from this folder are being moved out
      const albumsStaying = cluster.albums.filter(a =>
        a.artistFolder === folder &&
        (cluster.albumCredits.get(a.albumFolder) || cluster.canonicalName) === folder
      )
      if (albumsStaying.length === 0) {
        plan.emptyDirsToRemove.push(path.join(musicDir, folder))
      }
    }
  }

  return plan
}

// ============================================================
// Phase 4b: Display Plan
// ============================================================
function displayPlan(plan: CleanupPlan): void {
  console.log('\n' + '='.repeat(60))
  console.log('CLEANUP PLAN')
  console.log('='.repeat(60))

  if (plan.folderMoves.length > 0) {
    console.log(`\nFOLDER MOVES (${plan.folderMoves.length}):`)
    for (const move of plan.folderMoves) {
      console.log(`  "${move.fromArtist}/${move.albumFolder}"`)
      console.log(`    -> "${move.toArtist}/${move.albumFolder}"`)
    }
  }

  if (plan.tagFixes.length > 0) {
    // Group by old -> new
    const groups = new Map<string, number>()
    for (const fix of plan.tagFixes) {
      const key = `${fix.field}: "${fix.oldValue}" -> "${fix.newValue}"`
      groups.set(key, (groups.get(key) || 0) + 1)
    }
    console.log(`\nTAG FIXES (${plan.tagFixes.length} files):`)
    for (const [desc, count] of groups) {
      console.log(`  ${desc} (${count} files)`)
    }
  }

  if (plan.dbUpdates.length > 0) {
    console.log(`\nDATABASE UPDATES (${plan.dbUpdates.length}):`)
    for (const upd of plan.dbUpdates) {
      console.log(`  ${upd.field}: "${upd.oldValue}" -> "${upd.newValue}"${upd.albumFilter ? ` [album: ${upd.albumFilter}]` : ''}`)
    }
  }

  if (plan.emptyDirsToRemove.length > 0) {
    console.log(`\nEMPTY DIRS TO REMOVE (${plan.emptyDirsToRemove.length}):`)
    for (const dir of plan.emptyDirsToRemove) {
      console.log(`  ${path.relative(musicDir, dir)}`)
    }
  }

  const totalActions = plan.folderMoves.length + plan.tagFixes.length + plan.dbUpdates.length + plan.emptyDirsToRemove.length
  if (totalActions === 0) {
    console.log('\nNo issues found! Library is clean.')
  }

  console.log()
}

// ============================================================
// Phase 5: Execute
// ============================================================
async function executePlan(plan: CleanupPlan): Promise<void> {
  const log: { timestamp: string; actions: unknown[] } = {
    timestamp: new Date().toISOString(),
    actions: [],
  }

  // 1. Create target dirs and move album folders
  console.log('Moving folders...')
  for (const move of plan.folderMoves) {
    const targetArtistDir = path.join(musicDir, move.toArtist)
    fs.mkdirSync(targetArtistDir, { recursive: true })

    if (fs.existsSync(move.toPath)) {
      // Target album dir already exists — move files individually
      console.log(`  MERGE: "${move.fromArtist}/${move.albumFolder}" -> "${move.toArtist}/${move.albumFolder}"`)
      const files = fs.readdirSync(move.fromPath)
      for (const file of files) {
        const src = path.join(move.fromPath, file)
        const dst = path.join(move.toPath, file)
        if (!fs.existsSync(dst)) {
          fs.renameSync(src, dst)
        } else {
          console.log(`    SKIP (exists): ${file}`)
        }
      }
      // Remove source if now empty
      try {
        const remaining = fs.readdirSync(move.fromPath)
        if (remaining.length === 0) fs.rmdirSync(move.fromPath)
      } catch {}
    } else {
      console.log(`  MOVE: "${move.fromArtist}/${move.albumFolder}" -> "${move.toArtist}/${move.albumFolder}"`)
      fs.mkdirSync(path.dirname(move.toPath), { recursive: true })
      fs.renameSync(move.fromPath, move.toPath)
    }

    log.actions.push({ type: 'move', from: move.fromPath, to: move.toPath })
  }

  // 2. Remove empty artist directories
  console.log('Cleaning empty directories...')
  for (const dir of plan.emptyDirsToRemove) {
    try {
      const contents = fs.readdirSync(dir)
      if (contents.length === 0) {
        fs.rmdirSync(dir)
        console.log(`  Removed: ${path.relative(musicDir, dir)}`)
        log.actions.push({ type: 'rmdir', path: dir })
      } else {
        console.log(`  SKIP (not empty): ${path.relative(musicDir, dir)}`)
      }
    } catch {}
  }

  // 3. Fix ID3 tags
  console.log(`Fixing tags (${plan.tagFixes.length} files)...`)
  let tagFixed = 0
  for (const fix of plan.tagFixes) {
    // File may have been moved — compute new path
    const relToMusic = path.relative(musicDir, fix.filePath)
    const parts = relToMusic.split(path.sep)
    const oldArtistFolder = parts[0]
    // Find if this artist folder was moved
    const move = plan.folderMoves.find(m =>
      m.fromArtist === oldArtistFolder && parts[1] === m.albumFolder
    )
    const actualPath = move
      ? path.join(move.toPath, ...parts.slice(2))
      : fix.filePath

    if (!fs.existsSync(actualPath)) {
      console.log(`  SKIP (not found): ${path.basename(actualPath)}`)
      continue
    }

    try {
      if (fix.ext === '.mp3') {
        const updates: Record<string, string> = {}
        if (fix.field === 'artist') updates.artist = fix.newValue
        if (fix.field === 'albumArtist') updates.albumArtist = fix.newValue
        writeMp3Tags(actualPath, updates)
      } else if (fix.ext === '.flac') {
        const existing = await readFlacTags(actualPath)
        await writeFlacTags(actualPath, {
          artist: fix.field === 'artist' ? fix.newValue : (existing.artist || ''),
          album: existing.album || '',
          title: existing.title || '',
          trackNumber: parseInt(existing.track || '0') || 0,
          albumArtist: fix.field === 'albumArtist' ? fix.newValue : (existing.albumArtist || fix.newValue),
        })
      }
      tagFixed++
      log.actions.push({ type: 'tag', path: actualPath, field: fix.field, old: fix.oldValue, new: fix.newValue })
    } catch (err) {
      console.log(`  ERROR: ${path.basename(actualPath)}: ${(err as Error).message}`)
    }
  }
  console.log(`  Fixed ${tagFixed} files`)

  // 4. Update database
  console.log('Updating database...')
  const updateDb = db.transaction(() => {
    for (const upd of plan.dbUpdates) {
      const col = upd.field // 'artist' or 'album_artist'
      let result
      if (upd.albumFilter) {
        result = db.prepare(`UPDATE tracks SET ${col} = ? WHERE ${col} = ? AND album LIKE ?`)
          .run(upd.newValue, upd.oldValue, `%${upd.albumFilter}%`)
      } else {
        result = db.prepare(`UPDATE tracks SET ${col} = ? WHERE ${col} = ?`).run(upd.newValue, upd.oldValue)
      }
      console.log(`  ${col}: "${upd.oldValue}" -> "${upd.newValue}"${upd.albumFilter ? ` [${upd.albumFilter}]` : ''} (${result.changes} rows)`)
      log.actions.push({ type: 'db', field: col, old: upd.oldValue, new: upd.newValue, rows: result.changes })
    }

    // Also update file_path for moved folders
    for (const move of plan.folderMoves) {
      const oldPrefix = `${move.fromArtist}/${move.albumFolder}`
      const newPrefix = `${move.toArtist}/${move.albumFolder}`
      const result = db.prepare(
        "UPDATE tracks SET file_path = REPLACE(file_path, ?, ?) WHERE file_path LIKE ?"
      ).run(oldPrefix, newPrefix, `%${oldPrefix}%`)
      if (result.changes > 0) {
        console.log(`  file_path: "${oldPrefix}" -> "${newPrefix}" (${result.changes} rows)`)
        log.actions.push({ type: 'db_path', old: oldPrefix, new: newPrefix, rows: result.changes })
      }
    }
  })
  updateDb()

  // 5. Write log
  const logPath = path.join(musicDir, `cleanup-log-${Date.now()}.json`)
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2))
  console.log(`\nLog written to: ${logPath}`)
}

// ============================================================
// Navidrome comparison
// ============================================================
async function compareNavidrome(): Promise<void> {
  if (!NAVIDROME_USER || !NAVIDROME_PASS) {
    console.log('Navidrome credentials not configured in .env (NAVIDROME_USER, NAVIDROME_PASS)')
    return
  }

  console.log(`\nComparing with Navidrome at ${NAVIDROME_URL}...\n`)

  // Encode password for Subsonic API (plaintext with enc: prefix, or just plain)
  const params = new URLSearchParams({
    u: NAVIDROME_USER,
    p: NAVIDROME_PASS,
    v: '1.16.1',
    c: 'musiclib-cleanup',
    f: 'json',
  })

  try {
    const res = await fetch(`${NAVIDROME_URL}/rest/getArtists?${params}`, {
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json() as {
      'subsonic-response': {
        status: string
        artists?: {
          index: { name: string; artist: { id: string; name: string; albumCount: number }[] }[]
        }
      }
    }

    if (data['subsonic-response'].status !== 'ok') {
      console.log('Navidrome API error:', JSON.stringify(data))
      return
    }

    const navidromeArtists = new Set<string>()
    for (const idx of data['subsonic-response'].artists?.index || []) {
      for (const artist of idx.artist) {
        navidromeArtists.add(artist.name)
      }
    }

    // Get disk artists
    const diskArtists = new Set<string>()
    const topLevel = fs.readdirSync(musicDir, { withFileTypes: true })
    for (const entry of topLevel) {
      if (entry.isDirectory() && entry.name !== 'Playlists') {
        diskArtists.add(entry.name)
      }
    }

    // Compare
    const onDiskOnly = [...diskArtists].filter(a => !navidromeArtists.has(a)).sort()
    const inNavidromeOnly = [...navidromeArtists].filter(a => !diskArtists.has(a)).sort()

    if (onDiskOnly.length > 0) {
      console.log(`ON DISK BUT NOT IN NAVIDROME (${onDiskOnly.length}):`)
      for (const a of onDiskOnly) console.log(`  - ${a}`)
      console.log()
    }

    if (inNavidromeOnly.length > 0) {
      console.log(`IN NAVIDROME BUT NOT ON DISK (${inNavidromeOnly.length}):`)
      for (const a of inNavidromeOnly) console.log(`  - ${a}`)
      console.log()
    }

    if (onDiskOnly.length === 0 && inNavidromeOnly.length === 0) {
      console.log('Navidrome and disk are in sync!')
    }

    // Check for artists/albums without images
    console.log('Checking for missing artwork in Navidrome...\n')

    // Get all albums from Navidrome
    const albumRes = await fetch(`${NAVIDROME_URL}/rest/getAlbumList2?${params}&type=alphabeticalByArtist&size=500`, {
      signal: AbortSignal.timeout(15000),
    })
    const albumData = await albumRes.json() as {
      'subsonic-response': {
        albumList2?: {
          album: { id: string; name: string; artist: string; coverArt?: string; artistId: string }[]
        }
      }
    }

    const albums = albumData['subsonic-response'].albumList2?.album || []
    const albumsNoArt: { name: string; artist: string }[] = []
    for (const album of albums) {
      if (!album.coverArt) {
        albumsNoArt.push({ name: album.name, artist: album.artist })
      }
    }

    if (albumsNoArt.length > 0) {
      console.log(`ALBUMS WITHOUT ARTWORK IN NAVIDROME (${albumsNoArt.length}):`)
      for (const a of albumsNoArt) console.log(`  - ${a.artist} / ${a.name}`)
      console.log()
    }

    // Check disk for missing cover art files
    const diskAlbumsNoArt: string[] = []
    const diskTopLevel = fs.readdirSync(musicDir, { withFileTypes: true })
    for (const artistEntry of diskTopLevel) {
      if (!artistEntry.isDirectory() || artistEntry.name === 'Playlists') continue
      const artistDir = path.join(musicDir, artistEntry.name)
      let albumEntries: fs.Dirent[]
      try { albumEntries = fs.readdirSync(artistDir, { withFileTypes: true }) } catch { continue }
      for (const albumEntry of albumEntries) {
        if (!albumEntry.isDirectory()) continue
        const albumDir = path.join(artistDir, albumEntry.name)
        let files: string[]
        try { files = fs.readdirSync(albumDir) } catch { continue }
        const hasAudio = files.some(f => /\.(mp3|flac|m4a|ogg|opus)$/i.test(f))
        const hasArt = files.some(f => /^(cover|folder|album|front|artwork)\.(jpg|jpeg|png|webp)$/i.test(f))
        if (hasAudio && !hasArt) {
          diskAlbumsNoArt.push(`${artistEntry.name} / ${albumEntry.name}`)
        }
      }
    }

    if (diskAlbumsNoArt.length > 0) {
      console.log(`ALBUMS WITHOUT COVER ART ON DISK (${diskAlbumsNoArt.length}):`)
      for (const a of diskAlbumsNoArt) console.log(`  - ${a}`)
      console.log()
    }

    // Artists without images in Navidrome — check via getArtistInfo2
    const artistsNoImage: string[] = []
    for (const idx of data['subsonic-response'].artists?.index || []) {
      for (const artist of idx.artist) {
        try {
          const infoRes = await fetch(`${NAVIDROME_URL}/rest/getArtistInfo2?${params}&id=${artist.id}`, {
            signal: AbortSignal.timeout(5000),
          })
          const infoData = await infoRes.json() as {
            'subsonic-response': {
              artistInfo2?: { largeImageUrl?: string; mediumImageUrl?: string; smallImageUrl?: string }
            }
          }
          const info = infoData['subsonic-response'].artistInfo2
          if (!info?.largeImageUrl && !info?.mediumImageUrl && !info?.smallImageUrl) {
            artistsNoImage.push(artist.name)
          }
        } catch {}
      }
    }

    if (artistsNoImage.length > 0) {
      console.log(`ARTISTS WITHOUT IMAGES IN NAVIDROME (${artistsNoImage.length}):`)
      for (const a of artistsNoImage) console.log(`  - ${a}`)
      console.log()
    }

    // Offer to trigger rescan
    if (onDiskOnly.length > 0) {
      console.log('Note: Navidrome reads artist names from ID3 tags, not folder names.')
      console.log('After fixing tags, trigger a rescan in Navidrome UI or run:')
      console.log(`  curl "${NAVIDROME_URL}/rest/startScan?${params}"`)
    }
  } catch (err) {
    console.log(`Failed to connect to Navidrome: ${(err as Error).message}`)
  }
}

// ============================================================
// Cover art fetching
// ============================================================
async function fetchMissingArt(): Promise<void> {
  console.log('Scanning for albums without cover art...\n')

  const missing: { artistFolder: string; albumFolder: string; albumDir: string }[] = []

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
      const hasAudio = files.some(f => /\.(mp3|flac|m4a|ogg|opus)$/i.test(f))
      const hasArt = files.some(f => /^(cover|folder|album|front|artwork)\.(jpg|jpeg|png|webp)$/i.test(f))
      if (hasAudio && !hasArt) {
        missing.push({ artistFolder: artistEntry.name, albumFolder: albumEntry.name, albumDir })
      }
    }
  }

  console.log(`Found ${missing.length} albums without cover art\n`)

  let fetched = 0
  let failed = 0

  for (const { artistFolder, albumFolder, albumDir } of missing) {
    const albumName = albumFolder
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
    const artistName = artistFolder
      .split(';')[0] // handle semicolon-separated artists
      .replace(/\s*(&|and|with)\s+.+$/i, '')
      .trim()

    process.stdout.write(`  ${artistFolder} / ${albumFolder}... `)

    // Search MusicBrainz for the release group
    try {
      const query = `release:"${albumName}" AND artist:"${artistName}"`
      const data = await mbFetch<{
        releases: {
          id: string
          title: string
          'release-group': { id: string }
        }[]
      }>(
        `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&limit=5&fmt=json`
      )

      if (!data.releases?.length) {
        // Retry with base album name only (strip everything after first dash/colon)
        const baseAlbum = albumName.replace(/\s*[-:–].*$/, '').trim()
        if (baseAlbum !== albumName && baseAlbum.length > 2) {
          const retryQuery = `release:"${baseAlbum}" AND artist:"${artistName}"`
          const retryData = await mbFetch<typeof data>(
            `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(retryQuery)}&limit=5&fmt=json`
          )
          if (retryData.releases?.length) {
            data.releases = retryData.releases
          }
        }
      }

      if (!data.releases?.length) {
        console.log('not found on MusicBrainz')
        failed++
        continue
      }

      // Find best match
      const exact = data.releases.find(r =>
        r.title.toLowerCase() === albumName.toLowerCase()
      )
      const release = exact || data.releases[0]
      const rgId = release['release-group']?.id

      if (!rgId) {
        console.log('no release group ID')
        failed++
        continue
      }

      // Try Cover Art Archive
      const artRes = await fetch(`https://coverartarchive.org/release-group/${rgId}/front`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      })

      if (!artRes.ok) {
        // Fallback: try the specific release
        const artRes2 = await fetch(`https://coverartarchive.org/release/${release.id}/front`, {
          redirect: 'follow',
          signal: AbortSignal.timeout(15000),
        })
        if (!artRes2.ok) {
          console.log('no cover art available')
          failed++
          continue
        }
        const buffer = Buffer.from(await artRes2.arrayBuffer())
        const ext = artRes2.headers.get('content-type')?.includes('png') ? 'png' : 'jpg'
        fs.writeFileSync(path.join(albumDir, `cover.${ext}`), buffer)
        console.log(`downloaded (${(buffer.length / 1024).toFixed(0)}KB)`)
        fetched++
        continue
      }

      const buffer = Buffer.from(await artRes.arrayBuffer())
      const ext = artRes.headers.get('content-type')?.includes('png') ? 'png' : 'jpg'
      fs.writeFileSync(path.join(albumDir, `cover.${ext}`), buffer)
      console.log(`downloaded (${(buffer.length / 1024).toFixed(0)}KB)`)
      fetched++
    } catch (err) {
      console.log(`error: ${(err as Error).message}`)
      failed++
    }
  }

  console.log(`\nCover art: ${fetched} downloaded, ${failed} failed, ${missing.length - fetched - failed} skipped`)
}

// ============================================================
// Embed cover art into MP3 ID3 tags
// ============================================================
async function embedCoverArt(): Promise<void> {
  console.log('Scanning for MP3s missing embedded album art...\n')

  let fixed = 0
  let skipped = 0
  let total = 0

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

      // Find cover image
      const coverFile = files.find(f => /^(cover|folder|album|front|artwork)\.(jpg|jpeg|png|webp)$/i.test(f))
      if (!coverFile) continue

      const coverPath = path.join(albumDir, coverFile)
      let coverBuffer: Buffer | null = null

      const mp3Files = files.filter(f => /\.mp3$/i.test(f))
      for (const mp3 of mp3Files) {
        total++
        const mp3Path = path.join(albumDir, mp3)

        // Check if already has embedded art
        try {
          const tags = NodeID3.read(mp3Path)
          if (tags.image && typeof tags.image === 'object' && (tags.image as any).imageBuffer?.length > 0) {
            skipped++
            continue
          }
        } catch {
          skipped++
          continue
        }

        // Lazy-load the cover image
        if (!coverBuffer) {
          try {
            coverBuffer = fs.readFileSync(coverPath)
          } catch {
            break // can't read cover, skip this album
          }
        }

        // Embed cover art
        try {
          const mimeType = coverFile.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
          NodeID3.update({
            image: {
              mime: mimeType,
              type: { id: 3, name: 'front cover' },
              description: 'Cover',
              imageBuffer: coverBuffer,
            },
          }, mp3Path)
          fixed++
          process.stdout.write(`  Embedded art: ${artistEntry.name} / ${albumEntry.name} / ${mp3}\n`)
        } catch (err) {
          console.log(`  Error embedding ${mp3}: ${(err as Error).message}`)
        }
      }
    }
  }

  console.log(`\nEmbed art: ${fixed} updated, ${skipped} already had art, ${total} total MP3s scanned`)
}

// ============================================================
// Fix DB album_art_url — copy art URLs within albums
// ============================================================
function fixDbAlbumArt(): void {
  console.log('Fixing missing album_art_url in database...\n')

  // Find albums where some tracks have art URLs and others don't
  const albums = db.prepare(`
    SELECT DISTINCT album, album_artist FROM tracks
    WHERE album != '' AND album_art_url != ''
  `).all() as { album: string; album_artist: string }[]

  let fixed = 0
  for (const { album, album_artist } of albums) {
    // Get the art URL from a track that has one
    const withArt = db.prepare(`
      SELECT album_art_url FROM tracks
      WHERE album = ? AND album_artist = ? AND album_art_url != ''
      LIMIT 1
    `).get(album, album_artist) as { album_art_url: string } | undefined

    if (!withArt) continue

    // Update tracks in same album that are missing art
    const result = db.prepare(`
      UPDATE tracks SET album_art_url = ?
      WHERE album = ? AND album_artist = ? AND (album_art_url IS NULL OR album_art_url = '')
    `).run(withArt.album_art_url, album, album_artist)

    if (result.changes > 0) {
      console.log(`  ${album_artist} - ${album}: fixed ${result.changes} tracks`)
      fixed += result.changes
    }
  }

  console.log(`\nFixed album_art_url for ${fixed} tracks`)
}

// ============================================================
// Prompt for confirmation
// ============================================================
function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('Music Library Cleanup')
  console.log(`Library: ${musicDir}`)
  console.log(`Mode: ${executeMode ? 'EXECUTE' : 'DRY RUN'}\n`)

  if (navidromeCheck) {
    await compareNavidrome()
    return
  }

  if (fetchArt) {
    await fetchMissingArt()
    return
  }

  if (embedArt) {
    await embedCoverArt()
    return
  }

  if (fixDbArt) {
    fixDbAlbumArt()
    return
  }

  // Phase 1: Scan
  const albums = scanLibrary()
  if (albums.length === 0) {
    console.log('No albums found.')
    return
  }

  // Phase 2: Detect clusters
  const clusters = detectClusters(albums)

  // Phase 2b: Scan ALL files for alias mismatches (not just clustered ones)
  const aliasFixes = scanForAliasMismatches(albums)

  if (clusters.length === 0 && aliasFixes.length === 0) {
    console.log('No naming issues detected!')
    await compareNavidrome()
    return
  }

  // Phase 3: Resolve canonical names for clusters
  if (clusters.length > 0) {
    await resolveCanonical(clusters)
  }

  // Phase 4: Build and display plan
  const plan = buildPlan(clusters)

  // Add alias-based tag fixes and folder renames
  const aliasRenames = new Set<string>()
  for (const fix of aliasFixes) {
    // Check if already covered by cluster-based fixes
    const alreadyCovered = plan.tagFixes.some(tf => tf.filePath === fix.filePath && tf.field === fix.field)
    if (!alreadyCovered) {
      plan.tagFixes.push(fix)
    }
  }
  // Check if any artist folders need renaming due to aliases
  const allArtistFolders = new Set(albums.map(a => a.artistFolder))
  for (const folder of allArtistFolders) {
    const alias = getCanonicalAlias(folder)
    if (alias && alias !== folder && !aliasRenames.has(folder)) {
      aliasRenames.add(folder)
      // Check if already covered by cluster moves
      const alreadyMoved = plan.folderMoves.some(m => m.fromArtist === folder)
      if (!alreadyMoved) {
        // Add folder rename for all albums under this artist
        const artistAlbums = albums.filter(a => a.artistFolder === folder)
        for (const album of artistAlbums) {
          plan.folderMoves.push({
            fromArtist: folder,
            toArtist: alias,
            albumFolder: album.albumFolder,
            fromPath: album.fullPath,
            toPath: path.join(musicDir, alias, album.albumFolder),
          })
          plan.dbUpdates.push({
            field: 'album_artist',
            oldValue: folder,
            newValue: alias,
            albumFilter: album.albumFolder,
          })
        }
        plan.emptyDirsToRemove.push(path.join(musicDir, folder))
      }
    }
  }

  displayPlan(plan)

  const totalActions = plan.folderMoves.length + plan.tagFixes.length + plan.dbUpdates.length
  if (totalActions === 0) {
    console.log('Nothing to fix.')
    return
  }

  // Phase 5: Execute (if --execute)
  if (executeMode) {
    if (!autoYes) {
      console.log('WARNING: This will modify files, folders, and the database.')
      console.log('Make sure you have a backup before proceeding.\n')
      const ok = await confirm('Proceed with cleanup? [y/N] ')
      if (!ok) {
        console.log('Aborted.')
        return
      }
    }
    await executePlan(plan)
    console.log('\nDone! Run scan-library.ts to verify.')
  } else {
    console.log('This was a dry run. Use --execute to apply changes.')
  }
}

main().catch(err => {
  console.error('\nError:', err)
  process.exit(1)
})
