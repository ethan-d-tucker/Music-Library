/**
 * Import specific artists' studio albums into the library using MusicBrainz.
 *
 * No Spotify API needed — uses MusicBrainz for metadata and
 * Cover Art Archive for album art. Only imports studio albums
 * (no compilations, singles, or EPs).
 *
 * Usage: cd server && npx tsx scripts/top-music.ts
 */

import { insertTrack, getLibraryStats } from '../src/db/index.js'
import db from '../src/db/index.js'

const USER_AGENT = 'MusicLibraryImporter/1.0 (local)'

// --- CONFIGURE WHAT TO IMPORT ---

interface ArtistEntry {
  name: string
  priorityAlbums?: string[] // import these first
}

const ARTISTS: ArtistEntry[] = [
  { name: 'Merle Haggard', priorityAlbums: ['Down Every Road'] },
  { name: 'Jason Isbell' },
  { name: 'Turnpike Troubadours' },
  { name: 'The Avett Brothers' },
  { name: 'Chappell Roan' },
  { name: 'Dan Reeder' },
  { name: 'Trampled by Turtles' },
  { name: 'Tyler Childers' },
  { name: 'Sturgill Simpson' },
  { name: 'Johnny Blue Skies' },
  // New artists from On Repeat
  { name: 'Sabrina Carpenter', priorityAlbums: ["Short n' Sweet"] },
  { name: 'Olivia Rodrigo', priorityAlbums: ['SOUR'] },
  { name: 'The Highwomen', priorityAlbums: ['The Highwomen'] },
  { name: 'Rainbow Kitten Surprise', priorityAlbums: ['How to: Friend, Love, Freefall'] },
  { name: 'Adele', priorityAlbums: ['25'] },
  { name: 'Randy Travis', priorityAlbums: ['Storms of Life'] },
  { name: 'The SteelDrivers', priorityAlbums: ['The SteelDrivers'] },
  { name: 'Hozier', priorityAlbums: ['Hozier'] },
  { name: 'Keith Whitley', priorityAlbums: ["Don't Close Your Eyes"] },
  { name: 'Pure Prairie League', priorityAlbums: ["Bustin' Out"] },
  // More additions
  { name: 'Townes Van Zandt', priorityAlbums: ['Live at the Old Quarter, Houston, Texas', 'Our Mother the Mountain'] },
  { name: 'Bob Dylan', priorityAlbums: ['Highway 61 Revisited', 'Blonde on Blonde', 'Blood on the Tracks'] },
]

// --- END CONFIG ---

// MusicBrainz requires 1 req/sec — use 1.5s + retry on 503
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

interface MBArtist { id: string; name: string }

interface MBReleaseGroup {
  id: string
  title: string
  'primary-type': string
  'secondary-types'?: string[]
  'first-release-date': string
}

interface MBRelease {
  id: string
  title: string
  'artist-credit': { name: string; joinphrase?: string }[]
  media: {
    position: number
    tracks: {
      position: number
      title: string
      length: number | null
      'artist-credit': { name: string; joinphrase?: string }[]
    }[]
  }[]
}

function formatCredit(credits: { name: string; joinphrase?: string }[]): string {
  return credits.map(c => c.name + (c.joinphrase || '')).join('')
}

async function searchArtist(name: string): Promise<MBArtist | null> {
  const data = await mbFetch<{ artists: MBArtist[] }>(
    `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(`"${name}"`)}&limit=5&fmt=json`
  )
  const match = data.artists?.find(a => a.name.toLowerCase() === name.toLowerCase())
  return match || data.artists?.[0] || null
}

async function getAlbums(artistId: string): Promise<MBReleaseGroup[]> {
  const groups: MBReleaseGroup[] = []
  let offset = 0

  while (true) {
    const data = await mbFetch<{ 'release-groups': MBReleaseGroup[]; 'release-group-count': number }>(
      `https://musicbrainz.org/ws/2/release-group?artist=${artistId}&type=album&limit=100&offset=${offset}&fmt=json`
    )
    groups.push(...data['release-groups'])
    if (groups.length >= data['release-group-count'] || data['release-groups'].length === 0) break
    offset += 100
  }

  // Filter: only studio albums (no compilations, live, remix, soundtrack, etc.)
  return groups.filter(g => {
    const secondary = g['secondary-types'] || []
    const skipTypes = ['Compilation', 'Live', 'Remix', 'DJ-mix', 'Soundtrack', 'Demo', 'Interview']
    return !secondary.some(t => skipTypes.includes(t))
  })
}

async function getReleaseTracks(releaseGroupId: string): Promise<MBRelease | null> {
  const data = await mbFetch<{ releases: { id: string; status: string; country: string }[] }>(
    `https://musicbrainz.org/ws/2/release?release-group=${releaseGroupId}&limit=10&fmt=json`
  )

  // Prefer official US/XW releases
  const sorted = data.releases.sort((a, b) => {
    const aScore = (a.status === 'Official' ? 2 : 0) + (['US', 'XW'].includes(a.country) ? 1 : 0)
    const bScore = (b.status === 'Official' ? 2 : 0) + (['US', 'XW'].includes(b.country) ? 1 : 0)
    return bScore - aScore
  })

  if (sorted.length === 0) return null

  return mbFetch<MBRelease>(
    `https://musicbrainz.org/ws/2/release/${sorted[0].id}?inc=recordings+artist-credits&fmt=json`
  )
}

async function getCoverArt(releaseGroupId: string): Promise<string> {
  try {
    const res = await fetch(`https://coverartarchive.org/release-group/${releaseGroupId}/front`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    })
    if (res.status >= 300 && res.status < 400) {
      return res.headers.get('location') || ''
    }
    return ''
  } catch {
    return ''
  }
}

function getExistingTracks(): Set<string> {
  const rows = db.prepare('SELECT title, artist, album FROM tracks').all() as { title: string; artist: string; album: string }[]
  return new Set(rows.map(r => `${r.title.toLowerCase()}|${r.artist.toLowerCase()}|${r.album.toLowerCase()}`))
}

const importBatch = db.transaction((tracks: {
  title: string; artist: string; album: string; album_artist: string
  track_number: number; disc_number: number; duration_ms: number; album_art_url: string
}[], existing: Set<string>): number => {
  let count = 0
  for (const t of tracks) {
    const key = `${t.title.toLowerCase()}|${t.artist.toLowerCase()}|${t.album.toLowerCase()}`
    if (existing.has(key)) continue
    insertTrack(t)
    existing.add(key)
    count++
  }
  return count
})

async function importAlbum(
  album: MBReleaseGroup,
  existing: Set<string>,
  isPriority: boolean,
): Promise<number> {
  console.log(`  ${isPriority ? '* ' : ''}${album.title}${isPriority ? ' [priority]' : ''}`)

  let release: MBRelease | null
  try {
    release = await getReleaseTracks(album.id)
  } catch (err) {
    console.log(`    SKIP (${(err as Error).message})`)
    return 0
  }

  if (!release || release.media.length === 0) {
    console.log(`    SKIP (no tracks found)`)
    return 0
  }

  const albumArtist = formatCredit(release['artist-credit'])
  const coverArt = await getCoverArt(album.id)

  const tracks: Parameters<typeof importBatch>[0] = []
  for (const disc of release.media) {
    for (const track of disc.tracks) {
      tracks.push({
        title: track.title,
        artist: track['artist-credit'] ? formatCredit(track['artist-credit']) : albumArtist,
        album: release.title,
        album_artist: albumArtist,
        track_number: track.position,
        disc_number: disc.position,
        duration_ms: track.length || 0,
        album_art_url: coverArt,
      })
    }
  }

  const imported = importBatch(tracks, existing)
  if (imported > 0) {
    console.log(`    + ${imported} tracks`)
  } else {
    console.log(`    already in library`)
  }
  return imported
}

async function main() {
  const stats = getLibraryStats()
  console.log(`Library: ${stats.downloaded} downloaded, ${stats.pending} pending\n`)

  const existing = getExistingTracks()
  let totalImported = 0

  // Phase 1: Resolve all artists and fetch album lists
  const artistAlbums: { entry: ArtistEntry; priority: MBReleaseGroup[]; albums: MBReleaseGroup[] }[] = []

  for (const entry of ARTISTS) {
    console.log(`Searching: ${entry.name}...`)

    let artist: MBArtist | null
    try {
      artist = await searchArtist(entry.name)
    } catch (err) {
      console.log(`  ERROR: ${(err as Error).message}`)
      continue
    }

    if (!artist) {
      console.log(`  Not found`)
      continue
    }

    console.log(`  Found: ${artist.name}`)

    let albums: MBReleaseGroup[]
    try {
      albums = await getAlbums(artist.id)
    } catch (err) {
      console.log(`  ERROR: ${(err as Error).message}`)
      continue
    }

    albums.sort((a, b) => (a['first-release-date'] || '').localeCompare(b['first-release-date'] || ''))

    const priority: MBReleaseGroup[] = []
    const rest: MBReleaseGroup[] = []
    for (const album of albums) {
      if (entry.priorityAlbums?.some(p => album.title.toLowerCase().includes(p.toLowerCase()))) {
        priority.push(album)
      } else {
        rest.push(album)
      }
    }

    console.log(`  ${priority.length + rest.length} studio albums`)
    artistAlbums.push({ entry, priority, albums: rest })
  }

  // Phase 2: Import priority albums first
  console.log(`\n--- Importing priority albums ---`)
  for (const { entry, priority } of artistAlbums) {
    for (const album of priority) {
      console.log(`\n[${entry.name}]`)
      totalImported += await importAlbum(album, existing, true)
    }
  }

  // Phase 3: Round-robin — one album per artist at a time
  console.log(`\n--- Importing albums (round-robin) ---`)
  const cursors = artistAlbums.map(() => 0)
  let anyLeft = true

  while (anyLeft) {
    anyLeft = false
    for (let i = 0; i < artistAlbums.length; i++) {
      const { entry, albums } = artistAlbums[i]
      if (cursors[i] >= albums.length) continue

      anyLeft = true
      const album = albums[cursors[i]]
      cursors[i]++

      console.log(`\n[${entry.name}]`)
      totalImported += await importAlbum(album, existing, false)
    }
  }

  const pending = (db.prepare("SELECT COUNT(*) as c FROM tracks WHERE download_status = 'pending'").get() as { c: number }).c
  const estGB = (totalImported * 5 / 1024).toFixed(1)

  console.log(`\n=== Done ===`)
  console.log(`New tracks imported: ${totalImported} (~${estGB}GB)`)
  console.log(`Total pending downloads: ${pending}`)
  console.log(`\nStart the app and go to Downloads to begin downloading.`)
}

main().catch(err => {
  console.error('\nError:', err)
  process.exit(1)
})
