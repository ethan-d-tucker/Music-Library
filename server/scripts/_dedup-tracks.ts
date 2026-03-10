/**
 * Remove exact duplicate tracks (same artist + title + album).
 * Keeps the best copy (downloaded > in playlist > lowest ID).
 * Reassigns playlist references to the kept track.
 * Removes orphaned files from disk.
 *
 * Usage: cd server && npx tsx scripts/_dedup-tracks.ts
 */
import path from 'path'
import { existsSync, unlinkSync } from 'fs'
import Database from 'better-sqlite3'
import { MUSIC_DIR } from '../src/config.js'

const db = new Database(path.join(MUSIC_DIR, 'library.db'))

interface TrackInfo {
  id: number
  artist: string
  title: string
  album: string
  file_path: string
  download_status: string
  playlistCount: number
}

const groups = db.prepare(`
  SELECT GROUP_CONCAT(id) as ids
  FROM tracks
  GROUP BY LOWER(TRIM(artist)), LOWER(TRIM(title)), LOWER(TRIM(album))
  HAVING COUNT(*) > 1
`).all() as { ids: string }[]

console.log(`Found ${groups.length} duplicate groups\n`)

let deleted = 0
let filesRemoved = 0
let playlistsReassigned = 0

const txn = db.transaction(() => {
  for (const g of groups) {
    const ids = g.ids.split(',').map(Number)

    const tracks: TrackInfo[] = ids.map(id => {
      const t = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as any
      const pl = db.prepare('SELECT COUNT(*) as c FROM playlist_tracks WHERE track_id = ?').get(id) as { c: number }
      return { ...t, playlistCount: pl.c }
    })

    // Sort: prefer downloaded FLAC > downloaded MP3 > has track_number > in playlist > lower id
    tracks.sort((a, b) => {
      if (a.download_status === 'complete' && b.download_status !== 'complete') return -1
      if (b.download_status === 'complete' && a.download_status !== 'complete') return 1
      const aFlac = (a as any).format === 'flac'
      const bFlac = (b as any).format === 'flac'
      if (aFlac && !bFlac) return -1
      if (bFlac && !aFlac) return 1
      const aTn = (a as any).track_number || 0
      const bTn = (b as any).track_number || 0
      if (aTn > 0 && bTn === 0) return -1
      if (bTn > 0 && aTn === 0) return 1
      if (a.playlistCount > 0 && b.playlistCount === 0) return -1
      if (b.playlistCount > 0 && a.playlistCount === 0) return 1
      return a.id - b.id
    })

    const keep = tracks[0]
    const dupes = tracks.slice(1)

    for (const d of dupes) {
      // Reassign playlist references to the kept track
      if (d.playlistCount > 0) {
        const playlists = db.prepare('SELECT playlist_id, position FROM playlist_tracks WHERE track_id = ?')
          .all(d.id) as { playlist_id: number; position: number }[]

        for (const pl of playlists) {
          const existing = db.prepare('SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?')
            .get(pl.playlist_id, keep.id)
          if (existing) {
            db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?')
              .run(pl.playlist_id, d.id)
          } else {
            db.prepare('UPDATE playlist_tracks SET track_id = ? WHERE playlist_id = ? AND track_id = ?')
              .run(keep.id, pl.playlist_id, d.id)
            playlistsReassigned++
          }
        }
      }

      // Delete any remaining playlist refs
      db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(d.id)

      // Remove file if it exists and is different from kept file
      if (d.file_path && d.file_path !== keep.file_path) {
        const absPath = path.join(MUSIC_DIR, d.file_path)
        if (existsSync(absPath)) {
          unlinkSync(absPath)
          filesRemoved++
          const lrcPath = absPath.replace(/\.(mp3|flac)$/i, '.lrc')
          if (existsSync(lrcPath)) unlinkSync(lrcPath)
        }
      }

      db.prepare('DELETE FROM tracks WHERE id = ?').run(d.id)
      deleted++
    }
  }
})

txn()
console.log(`Deleted: ${deleted} duplicate tracks`)
console.log(`Files removed: ${filesRemoved}`)
console.log(`Playlist refs reassigned: ${playlistsReassigned}`)
