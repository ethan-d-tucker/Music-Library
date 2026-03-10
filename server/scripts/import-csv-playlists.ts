/**
 * Import Exportify CSV playlists into the library.
 * Creates playlists + inserts tracks (as pending for download) + writes M3U files.
 *
 * Usage: cd server && npx tsx scripts/import-csv-playlists.ts <csv1> <csv2> ...
 *        cd server && npx tsx scripts/import-csv-playlists.ts ~/Downloads/*_Radio.csv ~/Downloads/Daily_Mix_*.csv
 */

import fs from 'fs'
import path from 'path'
import { insertTrack, insertPlaylist, addTrackToPlaylist } from '../src/db/index.js'
import db from '../src/db/index.js'
import { writeM3U } from '../src/services/m3u.js'
import { normalizeArtistSeparators } from '../src/services/normalizer.js'
import type { TrackRow } from '../src/db/index.js'

const files = process.argv.slice(2).filter(f => !f.startsWith('-'))

if (files.length === 0) {
  console.log('Usage: npx tsx scripts/import-csv-playlists.ts <csv1> [csv2] ...')
  console.log('Example: npx tsx scripts/import-csv-playlists.ts ~/Downloads/*_Radio.csv')
  process.exit(1)
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

for (const csvPath of files) {
  const resolved = path.resolve(csvPath)
  if (!fs.existsSync(resolved)) {
    console.log(`File not found: ${resolved}`)
    continue
  }

  const content = fs.readFileSync(resolved, 'utf-8')
  const lines = content.split('\n').filter(l => l.trim())

  if (lines.length < 2) {
    console.log(`Empty CSV: ${resolved}`)
    continue
  }

  // Parse header
  const header = parseCsvLine(lines[0])
  const idx = (name: string) => header.indexOf(name)
  const trackUriIdx = idx('Track URI')
  const trackNameIdx = idx('Track Name')
  const albumNameIdx = idx('Album Name')
  const artistNameIdx = idx('Artist Name(s)')
  const durationIdx = idx('Duration (ms)')
  const albumArtIdx = idx('Album Image URL')
  const trackNumIdx = idx('Track Number')
  const discNumIdx = idx('Disc Number')

  if (trackNameIdx < 0 || artistNameIdx < 0) {
    console.log(`Invalid CSV format: ${resolved}`)
    continue
  }

  // Derive playlist name from filename
  const playlistName = path.basename(resolved, '.csv').replace(/_/g, ' ')

  // Delete existing playlist with same name
  const existing = db.prepare("SELECT id FROM playlists WHERE name = ?").get(playlistName) as { id: number } | undefined
  if (existing) {
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(existing.id)
    db.prepare('DELETE FROM playlists WHERE id = ?').run(existing.id)
  }

  const dbPlaylistId = insertPlaylist({
    name: playlistName,
    description: `Imported from Exportify CSV`,
  })

  // First pass: collect tracks per album to detect compilations (3+ different artists = Various Artists)
  interface CsvTrack { title: string; artist: string; album: string; durationMs: number; spotifyId: string; albumArtUrl: string; trackNum: number; discNum: number }
  const csvTracks: CsvTrack[] = []
  const albumArtists = new Map<string, Set<string>>()

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i])
    const title = fields[trackNameIdx]
    const album = fields[albumNameIdx] || ''
    const rawArtist = fields[artistNameIdx] || ''
    const artist = normalizeArtistSeparators(rawArtist)
    const durationMs = parseInt(fields[durationIdx]) || 0
    const spotifyUri = fields[trackUriIdx] || ''
    const spotifyId = spotifyUri.replace('spotify:track:', '')
    const albumArtUrl = albumArtIdx >= 0 ? (fields[albumArtIdx] || '') : ''
    const trackNum = trackNumIdx >= 0 ? (parseInt(fields[trackNumIdx]) || 0) : 0
    const discNum = discNumIdx >= 0 ? (parseInt(fields[discNumIdx]) || 1) : 1

    if (!title || !artist) continue

    csvTracks.push({ title, artist, album, durationMs, spotifyId, albumArtUrl, trackNum, discNum })

    if (album) {
      if (!albumArtists.has(album)) albumArtists.set(album, new Set())
      albumArtists.get(album)!.add(artist.split(' / ')[0].split(',')[0].trim().toLowerCase())
    }
  }

  // Detect compilation albums (3+ unique artists)
  const compilationAlbums = new Set<string>()
  for (const [album, artists] of albumArtists) {
    if (artists.size >= 3) compilationAlbums.add(album)
  }

  let imported = 0
  for (let i = 0; i < csvTracks.length; i++) {
    const t = csvTracks[i]
    const isCompilation = compilationAlbums.has(t.album)
    const albumArtist = isCompilation ? 'Various Artists' : t.artist

    const trackId = insertTrack({
      title: t.title,
      artist: t.artist,
      album: t.album,
      album_artist: albumArtist,
      track_number: t.trackNum,
      disc_number: t.discNum,
      duration_ms: t.durationMs,
      spotify_id: t.spotifyId || undefined,
      album_art_url: t.albumArtUrl || undefined,
    })

    addTrackToPlaylist(dbPlaylistId, trackId, i)
    imported++
  }

  if (compilationAlbums.size > 0) {
    console.log(`  Compilations detected: ${[...compilationAlbums].join(', ')}`)
  }

  // Write M3U with any already-downloaded tracks
  const dbTracks = db.prepare(`
    SELECT t.* FROM tracks t
    JOIN playlist_tracks pt ON pt.track_id = t.id
    WHERE pt.playlist_id = ?
    AND t.file_path IS NOT NULL AND t.file_path != ''
    ORDER BY pt.position
  `).all(dbPlaylistId) as TrackRow[]

  if (dbTracks.length > 0) {
    writeM3U(playlistName, dbTracks)
  }

  console.log(`${playlistName}: ${imported} tracks imported (${dbTracks.length} already downloaded)`)
}

// Stats
const stats = db.prepare("SELECT download_status, COUNT(*) as cnt FROM tracks GROUP BY download_status").all() as any[]
console.log('\nLibrary totals:')
for (const s of stats) console.log(`  ${s.download_status}: ${s.cnt}`)
