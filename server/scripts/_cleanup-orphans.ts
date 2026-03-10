/**
 * Clean up orphaned audio files on disk.
 *
 * An orphan is a file with no matching file_path in the DB.
 * For each orphan, checks if the DB has a track with the same artist+title
 * that points to a different (existing) file — if so, the orphan is safe to delete.
 *
 * Usage:
 *   cd server && npx tsx scripts/_cleanup-orphans.ts          # Preview
 *   cd server && npx tsx scripts/_cleanup-orphans.ts --delete  # Delete safe orphans
 */
import path from 'path'
import { readdirSync, unlinkSync, existsSync } from 'fs'
import Database from 'better-sqlite3'
import { MUSIC_DIR } from '../src/config.js'

const db = new Database(path.join(MUSIC_DIR, 'library.db'))
const doDelete = process.argv.includes('--delete')

function walk(dir: string): string[] {
  const files: string[] = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name === 'Playlists') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) files.push(...walk(full))
      else {
        const ext = path.extname(entry.name).toLowerCase()
        if (ext === '.flac' || ext === '.mp3') files.push(full)
      }
    }
  } catch {}
  return files
}

const diskFiles = walk(MUSIC_DIR)

let safeToDelete = 0
let unregistered = 0
let totalOrphans = 0

for (const f of diskFiles) {
  const rel = path.relative(MUSIC_DIR, f).replace(/\\/g, '/')
  const row = db.prepare('SELECT id FROM tracks WHERE file_path = ?').get(rel)
  if (row) continue // Has DB entry, not an orphan

  totalOrphans++

  // Extract title from filename for matching
  const basename = path.basename(f, path.extname(f))
  // Strip leading track numbers like "01 ", "01. ", "01 - "
  const cleanTitle = basename.replace(/^\d+[\s._-]+/, '').trim()
  // Extract artist from path (first folder)
  const parts = rel.split('/')
  const artist = parts[0] || ''

  // Check if DB has a track with matching artist+title that has a valid file
  const match = db.prepare(`
    SELECT id, file_path FROM tracks
    WHERE LOWER(TRIM(artist)) = LOWER(?) AND LOWER(TRIM(title)) = LOWER(?)
    AND download_status = 'complete' AND file_path != ''
    LIMIT 1
  `).get(artist, cleanTitle) as { id: number; file_path: string } | undefined

  if (match && match.file_path !== rel) {
    // The DB has this track pointing to a different file — this orphan is a leftover
    const matchAbs = path.join(MUSIC_DIR, match.file_path)
    if (existsSync(matchAbs)) {
      // The DB's file exists, so this orphan is definitely redundant
      if (doDelete) {
        try {
          unlinkSync(f)
          const lrc = f.replace(/\.(mp3|flac)$/i, '.lrc')
          if (existsSync(lrc)) unlinkSync(lrc)
        } catch (err: any) {
          if (err?.code === 'EPERM') {
            console.log('  EPERM (skipped):', rel)
          } else throw err
        }
      }
      safeToDelete++
      continue
    }
  }

  // No match — this is an unregistered file (bootleg, loose, etc.)
  console.log('Unregistered:', rel)
  unregistered++
}

console.log(`\nTotal orphans: ${totalOrphans}`)
console.log(`Safe to delete (DB has replacement): ${safeToDelete}${doDelete ? ' (DELETED)' : ''}`)
console.log(`Unregistered (no DB match): ${unregistered}`)
if (!doDelete && safeToDelete > 0) {
  console.log('\nRun with --delete to remove safe orphans')
}
