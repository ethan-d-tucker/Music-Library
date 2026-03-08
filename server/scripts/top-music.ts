/**
 * Import top Spotify music into the library.
 *
 * Phase 1: Top tracks → import their full albums (no orphan singles)
 * Phase 2: Top artists → import their discographies
 * Capped at ~10GB estimated size.
 *
 * Usage: cd server && npx tsx scripts/top-music.ts
 */

import {
  getTopTracks,
  getTopArtists,
  getArtistAlbums,
  getAlbumTracks,
  isConnected,
  type SpotifyTrack,
  type TimeRange,
} from '../src/services/spotify.js'
import { insertTrack, getLibraryStats } from '../src/db/index.js'
import db from '../src/db/index.js'

const MAX_SIZE_GB = 10
const AVG_TRACK_SIZE_MB = 5
const MAX_NEW_TRACKS = Math.floor((MAX_SIZE_GB * 1024) / AVG_TRACK_SIZE_MB)

let totalImported = 0
let totalSkipped = 0

function progress(phase: string, detail: string) {
  const estGB = (totalImported * AVG_TRACK_SIZE_MB / 1024).toFixed(1)
  process.stdout.write(`\r[${phase}] ${detail} | ${totalImported} tracks imported | ~${estGB} GB   `)
}

function progressLine(msg: string) {
  process.stdout.write('\n')
  console.log(msg)
}

function getExistingSpotifyIds(): Set<string> {
  const rows = db.prepare('SELECT spotify_id FROM tracks WHERE spotify_id IS NOT NULL').all() as { spotify_id: string }[]
  return new Set(rows.map(r => r.spotify_id))
}

function importTrackBatch(tracks: SpotifyTrack[], existingIds: Set<string>): number {
  let count = 0
  for (const t of tracks) {
    if (existingIds.has(t.spotifyId)) continue
    if (totalImported >= MAX_NEW_TRACKS) break
    insertTrack({
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
    existingIds.add(t.spotifyId)
    totalImported++
    count++
  }
  return count
}

async function phase1TopTrackAlbums(existingIds: Set<string>): Promise<{ albums: number; tracks: number }> {
  const timeRanges: TimeRange[] = ['short_term', 'medium_term', 'long_term']
  const albumIds = new Map<string, string>() // albumId → first track artist for logging

  // Collect unique album IDs from top tracks
  for (const range of timeRanges) {
    progress('Phase 1', `Fetching top tracks (${range})`)
    const tracks = await getTopTracks(range, 50)
    for (const t of tracks) {
      if (t.albumId && !albumIds.has(t.albumId)) {
        albumIds.set(t.albumId, `${t.albumArtist} - ${t.album}`)
      }
    }
  }

  progressLine(`Found ${albumIds.size} unique albums from top tracks`)

  let albumCount = 0
  let trackCount = 0
  let i = 0

  for (const [albumId, label] of albumIds) {
    if (totalImported >= MAX_NEW_TRACKS) break
    i++
    progress('Phase 1', `Album ${i}/${albumIds.size}: ${label}`)

    await new Promise(r => setTimeout(r, 300))

    let tracks: SpotifyTrack[]
    try {
      tracks = await getAlbumTracks(albumId)
    } catch (err) {
      progressLine(`  Skipping "${label}" — ${(err as Error).message}`)
      continue
    }

    const imported = importTrackBatch(tracks, existingIds)
    if (imported > 0) {
      albumCount++
      trackCount += imported
    }
  }

  return { albums: albumCount, tracks: trackCount }
}

async function phase2ArtistDiscographies(existingIds: Set<string>): Promise<{ artists: number; albums: number; tracks: number }> {
  progress('Phase 2', 'Fetching top artists...')
  const artists = await getTopArtists('long_term', 50)
  progressLine(`Found ${artists.length} top artists`)

  let artistCount = 0
  let albumCount = 0
  let trackCount = 0

  for (let ai = 0; ai < artists.length; ai++) {
    const artist = artists[ai]
    if (totalImported >= MAX_NEW_TRACKS) {
      progressLine(`Reached track budget (${MAX_NEW_TRACKS}), stopping`)
      break
    }

    progress('Phase 2', `Artist ${ai + 1}/${artists.length}: ${artist.name}`)

    let albums
    try {
      albums = await getArtistAlbums(artist.id)
    } catch (err) {
      progressLine(`  Skipping ${artist.name} — ${(err as Error).message}`)
      continue
    }

    let artistTracks = 0

    for (const album of albums) {
      if (totalImported >= MAX_NEW_TRACKS) break

      await new Promise(r => setTimeout(r, 300))

      let tracks: SpotifyTrack[]
      try {
        tracks = await getAlbumTracks(album.id)
      } catch (err) {
        continue // silently skip failed albums
      }

      const imported = importTrackBatch(tracks, existingIds)
      if (imported > 0) {
        albumCount++
        artistTracks += imported
      }
    }

    if (artistTracks > 0) {
      artistCount++
      progressLine(`  ${artist.name}: ${artistTracks} new tracks`)
    }
  }

  return { artists: artistCount, albums: albumCount, tracks: trackCount }
}

async function main() {
  if (!isConnected()) {
    console.error('Not connected to Spotify. Start the app and connect first.')
    process.exit(1)
  }

  const stats = getLibraryStats()
  console.log(`Current library: ${stats.downloaded} downloaded, ${stats.pending} pending`)
  console.log(`Target: ~${MAX_SIZE_GB}GB (~${MAX_NEW_TRACKS} tracks at ~${AVG_TRACK_SIZE_MB}MB each)\n`)

  const existingIds = getExistingSpotifyIds()

  // Phase 1: Top tracks → full albums
  console.log('=== Phase 1: Top Tracks → Full Albums ===')
  const p1 = await phase1TopTrackAlbums(existingIds)
  progressLine(`Phase 1 done: ${p1.tracks} tracks from ${p1.albums} albums\n`)

  // Phase 2: Top artists → discographies
  console.log('=== Phase 2: Top Artists → Discographies ===')
  const p2 = await phase2ArtistDiscographies(existingIds)
  progressLine(`Phase 2 done: ${p2.tracks} tracks from ${p2.artists} artists\n`)

  // Summary
  const estGB = (totalImported * AVG_TRACK_SIZE_MB / 1024).toFixed(1)
  const pending = (db.prepare("SELECT COUNT(*) as c FROM tracks WHERE download_status = 'pending'").get() as { c: number }).c

  console.log('=== Summary ===')
  console.log(`Total new tracks imported: ${totalImported}`)
  console.log(`Estimated download size: ~${estGB} GB`)
  console.log(`Total pending in DB: ${pending}`)
  console.log('')
  console.log('Next: start the app and go to the Downloads page to begin downloading.')
}

main().catch(err => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
