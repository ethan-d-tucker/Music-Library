/**
 * Find audio files on disk that have no matching DB entry.
 * Usage: cd server && npx tsx scripts/_find-orphans.ts
 */
import path from 'path'
import { readdirSync, unlinkSync } from 'fs'
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
let orphans = 0

for (const f of diskFiles) {
  const rel = path.relative(MUSIC_DIR, f).replace(/\\/g, '/')
  const row = db.prepare('SELECT id FROM tracks WHERE file_path = ?').get(rel)
  if (!row) {
    console.log('Orphan:', rel)
    if (doDelete) {
      unlinkSync(f)
      console.log('  Deleted')
    }
    orphans++
  }
}

console.log(`\nTotal: ${orphans} orphaned files / ${diskFiles.length} total audio files`)
if (orphans > 0 && !doDelete) {
  console.log('Run with --delete to remove orphaned files')
}
