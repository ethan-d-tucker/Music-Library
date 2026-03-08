/**
 * Generate playlists from the downloaded library by grouping similar artists.
 * Creates M3U files in the Playlists/ folder for Navidrome to pick up.
 *
 * Usage:
 *   cd server && npx tsx scripts/generate-playlists.ts              # create playlists
 *   cd server && npx tsx scripts/generate-playlists.ts --regenerate  # delete + recreate
 */

import db from '../src/db/index.js'
import { insertPlaylist, addTrackToPlaylist } from '../src/db/index.js'
import { writeM3U } from '../src/services/m3u.js'
import type { TrackRow } from '../src/db/index.js'

const regenerate = process.argv.includes('--regenerate')

// Artist clusters — group similar artists together
const CLUSTERS = [
  {
    name: 'Americana & Alt-Country',
    artists: [
      'Jason Isbell', 'Jason Isbell and the 400 Unit',
      'Turnpike Troubadours', 'Tyler Childers', 'Sturgill Simpson',
      'Johnny Blue Skies', 'The SteelDrivers', 'Chris Stapleton',
      'Justin Townes Earle', 'The Highwomen', 'Darrell Scott',
    ],
    maxTracks: 75,
  },
  {
    name: 'Classic Country',
    artists: [
      'Merle Haggard', 'Merle Haggard & The Strangers',
      'Merle Haggard and The Strangers', 'Bonnie Owens and Merle Haggard with The Strangers',
      'Randy Travis', 'Keith Whitley', 'Johnny Cash',
    ],
    maxTracks: 75,
  },
  {
    name: 'Folk & Roots',
    artists: [
      'The Avett Brothers', 'Trampled by Turtles', 'John Prine',
      'Mt. Joy', 'Dan Reeder', 'Tony Rice', 'Pure Prairie League',
      'Townes Van Zandt',
    ],
    maxTracks: 75,
  },
  {
    name: 'Pop Hits',
    artists: [
      'Chappell Roan', 'Sabrina Carpenter', 'Olivia Rodrigo', 'Adele',
    ],
    maxTracks: 60,
  },
  {
    name: 'Hip Hop & R&B',
    artists: [
      'Kendrick Lamar', 'Kanye West', 'Tyler, The Creator',
      'Childish Gambino', 'Marvin Gaye',
    ],
    maxTracks: 75,
  },
  {
    name: 'Rock Classics',
    artists: [
      'Pink Floyd', 'David Bowie', 'Pearl Jam',
      'Creedence Clearwater Revival', 'Bob Dylan',
    ],
    maxTracks: 75,
  },
  {
    name: 'Indie & Alternative',
    artists: [
      'Rainbow Kitten Surprise', 'Mt. Joy', 'Hozier',
    ],
    maxTracks: 60,
  },
]

// Shuffle array with no more than 2 consecutive tracks from the same album
function shuffleWithSpread(tracks: TrackRow[]): TrackRow[] {
  // Fisher-Yates shuffle first
  const shuffled = [...tracks]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  // Then fix runs of 3+ from the same album
  for (let i = 2; i < shuffled.length; i++) {
    if (shuffled[i].album === shuffled[i - 1].album && shuffled[i].album === shuffled[i - 2].album) {
      // Find a swap candidate that breaks the run
      for (let j = i + 1; j < shuffled.length; j++) {
        if (shuffled[j].album !== shuffled[i].album) {
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
          break
        }
      }
    }
  }

  return shuffled
}

async function main() {
  if (regenerate) {
    // Delete all auto-generated playlists
    const autoPlaylists = db.prepare("SELECT id FROM playlists WHERE description LIKE '%[Auto]%'").all() as { id: number }[]
    for (const { id } of autoPlaylists) {
      db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(id)
      db.prepare('DELETE FROM playlists WHERE id = ?').run(id)
    }
    console.log(`Deleted ${autoPlaylists.length} existing auto-playlists\n`)
  }

  // Get all downloaded tracks
  const allTracks = db.prepare("SELECT * FROM tracks WHERE download_status = 'complete' AND file_path != ''").all() as TrackRow[]
  console.log(`Library has ${allTracks.length} downloaded tracks\n`)

  for (const cluster of CLUSTERS) {
    // Find tracks matching any artist in this cluster (case-insensitive partial match)
    const matching = allTracks.filter(t => {
      const artist = (t.artist || '').toLowerCase()
      const albumArtist = (t.album_artist || '').toLowerCase()
      return cluster.artists.some(a => {
        const lower = a.toLowerCase()
        return artist.includes(lower) || albumArtist.includes(lower)
      })
    })

    if (matching.length === 0) {
      console.log(`${cluster.name}: no downloaded tracks, skipping`)
      continue
    }

    // Shuffle and cap
    const shuffled = shuffleWithSpread(matching).slice(0, cluster.maxTracks)

    // Check if playlist already exists
    const existing = db.prepare("SELECT id FROM playlists WHERE name = ? AND description LIKE '%[Auto]%'").get(cluster.name) as { id: number } | undefined
    if (existing && !regenerate) {
      console.log(`${cluster.name}: already exists (use --regenerate to recreate)`)
      continue
    }

    // Create playlist
    const playlistId = insertPlaylist({
      name: cluster.name,
      description: `[Auto] Generated from ${cluster.artists.length} artists (${matching.length} available, ${shuffled.length} selected)`,
    })

    for (let i = 0; i < shuffled.length; i++) {
      addTrackToPlaylist(playlistId, shuffled[i].id, i)
    }

    // Write M3U
    writeM3U(cluster.name, shuffled)

    const artistCounts = new Map<string, number>()
    for (const t of shuffled) {
      const key = t.album_artist || t.artist
      artistCounts.set(key, (artistCounts.get(key) || 0) + 1)
    }
    const artistSummary = [...artistCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name} (${count})`)
      .join(', ')

    console.log(`${cluster.name}: ${shuffled.length} tracks from ${artistCounts.size} artists`)
    console.log(`  Top: ${artistSummary}`)
  }

  console.log(`\nPlaylists written to Playlists/ folder.`)
  console.log(`Navidrome will pick them up on next scan.`)
}

main().catch(err => {
  console.error('\nError:', err)
  process.exit(1)
})
