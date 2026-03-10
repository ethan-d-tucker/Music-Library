/**
 * One-off script to write M3U files for the imported radio/mix playlists.
 * Usage: cd server && npx tsx scripts/_write-m3u.ts
 */
import db from '../src/db/index.js'
import { writeM3U } from '../src/services/m3u.js'
import type { TrackRow } from '../src/db/index.js'

const names = [
  'Chappell Roan Radio',
  'Daily Mix 3',
  'Daily Mix 5',
  'Daily Mix 6',
  'Jason Isbell Radio',
  'Justin Townes Earle Radio',
]

for (const name of names) {
  const playlist = db.prepare("SELECT id FROM playlists WHERE name = ?").get(name) as { id: number } | undefined
  if (!playlist) {
    console.log(`Not found: ${name}`)
    continue
  }

  const tracks = db.prepare(`
    SELECT t.* FROM tracks t
    JOIN playlist_tracks pt ON pt.track_id = t.id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position
  `).all(playlist.id) as TrackRow[]

  const downloaded = tracks.filter(t => t.file_path)
  writeM3U(name, tracks)
  console.log(`${name}: ${downloaded.length}/${tracks.length} tracks in M3U`)
}
