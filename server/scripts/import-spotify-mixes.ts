/**
 * Import Spotify playlists (daily mixes, artist mixes, On Repeat, etc.)
 * into the local library as playlists with track data + M3U files.
 *
 * Uses the same Spotify service as the web app — requires Spotify to be
 * connected (auth tokens stored in DB from the web UI).
 *
 * Usage:
 *   cd server && npx tsx scripts/import-spotify-mixes.ts              # import mixes only
 *   cd server && npx tsx scripts/import-spotify-mixes.ts --all        # import ALL playlists
 *   cd server && npx tsx scripts/import-spotify-mixes.ts --list       # just list playlists
 */

import { getUserPlaylists, getPlaylistTracks, isConnected } from '../src/services/spotify.js'
import { insertTrack, insertPlaylist, addTrackToPlaylist } from '../src/db/index.js'
import db from '../src/db/index.js'
import { writeM3U } from '../src/services/m3u.js'
import type { TrackRow } from '../src/db/index.js'

const args = process.argv.slice(2)
const importAll = args.includes('--all')
const listOnly = args.includes('--list')

// Patterns that match Spotify's auto-generated mixes and curated playlists
const MIX_PATTERNS = [
  /^daily mix/i,
  /^on repeat$/i,
  /^repeat rewind$/i,
  /^discover weekly$/i,
  /^release radar$/i,
  /\bmix$/i,           // "Jason Isbell Mix", "Country Mix", etc.
  /\bradio$/i,         // "Jason Isbell Radio", "Sabrina Carpenter Radio", etc.
  /^your top songs/i,
  /^time capsule$/i,
]

function isMixPlaylist(name: string): boolean {
  return MIX_PATTERNS.some(p => p.test(name))
}

async function main() {
  if (!isConnected()) {
    console.error('Spotify not connected. Open the web app and connect Spotify first.')
    process.exit(1)
  }

  console.log('Fetching Spotify playlists...\n')
  const playlists = await getUserPlaylists()

  if (listOnly) {
    console.log(`Found ${playlists.length} playlists:\n`)
    for (const p of playlists) {
      const isMix = isMixPlaylist(p.name)
      console.log(`  ${isMix ? '*' : ' '} ${p.name} (${p.trackCount} tracks) [${p.id}]`)
    }
    console.log(`\n* = matches mix pattern (will be imported without --all)`)
    return
  }

  const toImport = importAll ? playlists : playlists.filter(p => isMixPlaylist(p.name))

  if (toImport.length === 0) {
    console.log('No matching playlists found.')
    console.log('Use --list to see all playlists, or --all to import everything.')
    return
  }

  console.log(`Importing ${toImport.length} playlist(s):\n`)
  for (const p of toImport) {
    console.log(`  - ${p.name} (${p.trackCount} tracks)`)
  }
  console.log()

  // Check for existing playlists with same spotify_id to avoid duplicates
  const existingPlaylists = db.prepare('SELECT spotify_id FROM playlists WHERE spotify_id IS NOT NULL').all() as { spotify_id: string }[]
  const existingIds = new Set(existingPlaylists.map(p => p.spotify_id))

  let totalTracks = 0
  let playlistsCreated = 0

  for (const playlist of toImport) {
    process.stdout.write(`${playlist.name}... `)

    // Delete existing playlist with same spotify_id so we can refresh it
    if (existingIds.has(playlist.id)) {
      const existing = db.prepare('SELECT id FROM playlists WHERE spotify_id = ?').get(playlist.id) as { id: number } | undefined
      if (existing) {
        db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(existing.id)
        db.prepare('DELETE FROM playlists WHERE id = ?').run(existing.id)
      }
    }

    let tracks
    try {
      tracks = await getPlaylistTracks(playlist.id)
    } catch (err) {
      console.log(`FAILED: ${(err as Error).message}`)
      continue
    }

    // Create local playlist
    const dbPlaylistId = insertPlaylist({
      name: playlist.name,
      description: `Imported from Spotify`,
      spotify_id: playlist.id,
    })

    // Insert tracks and add to playlist
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i]
      const trackId = insertTrack({
        title: t.title,
        artist: t.artist,
        album: t.album,
        album_artist: t.albumArtist,
        track_number: t.trackNumber,
        disc_number: t.discNumber,
        duration_ms: t.durationMs,
        spotify_id: t.spotifyId,
        album_art_url: t.albumArtUrl,
      })
      addTrackToPlaylist(dbPlaylistId, trackId, i)
    }

    // Export as M3U for Navidrome
    // Only include tracks that have been downloaded (have file_path)
    const dbTracks = db.prepare(`
      SELECT t.* FROM tracks t
      JOIN playlist_tracks pt ON pt.track_id = t.id
      WHERE pt.playlist_id = ?
      AND t.file_path IS NOT NULL AND t.file_path != ''
      ORDER BY pt.position
    `).all(dbPlaylistId) as TrackRow[]

    if (dbTracks.length > 0) {
      writeM3U(playlist.name, dbTracks)
    }

    console.log(`${tracks.length} tracks (${dbTracks.length} downloaded)`)
    totalTracks += tracks.length
    playlistsCreated++
  }

  console.log(`\n=== Done ===`)
  console.log(`Playlists imported: ${playlistsCreated}`)
  console.log(`Total tracks: ${totalTracks}`)
  console.log(`\nM3U files written to Playlists/ folder (Navidrome will pick them up).`)
  console.log(`Start batch download to get the new tracks.`)
}

main().catch(err => {
  console.error('\nError:', err)
  process.exit(1)
})
