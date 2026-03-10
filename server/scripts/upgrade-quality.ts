/**
 * Upgrade MP3 tracks to FLAC by re-downloading from Deezer.
 * Prioritizes artists by Spotify listening history.
 *
 * Usage:
 *   cd server && npx tsx scripts/upgrade-quality.ts              # Top artists from Spotify
 *   cd server && npx tsx scripts/upgrade-quality.ts --artist "Jason Isbell"  # Specific artist
 *   cd server && npx tsx scripts/upgrade-quality.ts --dry-run    # Preview only
 *   cd server && npx tsx scripts/upgrade-quality.ts --all        # All downloaded artists
 */
import path from 'path'
import { existsSync, unlinkSync, mkdirSync, rmSync, renameSync, copyFileSync } from 'fs'
import db from '../src/db/index.js'
import { MUSIC_DIR, DEEZER_ARL, AUDIO_FORMAT } from '../src/config.js'
import { searchDeezer, downloadDeezerTrack, isDeezerConfigured } from '../src/services/deezer.js'
import { getTrackPath, getAbsolutePath, ensureDirectories } from '../src/services/organizer.js'
import { tagFile } from '../src/services/tagger.js'
import { normalizeFile } from '../src/services/normalizer.js'
import { fetchLyrics, writeLrcFile } from '../src/services/lyrics.js'
import { getTopArtists, isConnected as spotifyConnected } from '../src/services/spotify.js'
import { updateTrackStatus, updateTrackLyrics, type TrackRow } from '../src/db/index.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const allArtists = args.includes('--all')
const artistIdx = args.indexOf('--artist')
const specificArtist = artistIdx !== -1 ? args[artistIdx + 1] : null

if (!isDeezerConfigured()) {
  console.error('Error: DEEZER_ARL not set in .env')
  process.exit(1)
}

interface ArtistUpgradeInfo {
  name: string
  mp3Count: number
  totalCount: number
}

async function getArtistPriority(): Promise<string[]> {
  if (specificArtist) return [specificArtist]

  if (allArtists) {
    const rows = db.prepare(`
      SELECT COALESCE(NULLIF(album_artist, ''), artist) as name, COUNT(*) as cnt
      FROM tracks
      WHERE download_status = 'complete' AND (format = 'mp3' OR format = '' OR format IS NULL)
      GROUP BY name
      ORDER BY cnt DESC
    `).all() as { name: string; cnt: number }[]
    return rows.map(r => r.name)
  }

  // Use Spotify top artists
  if (!spotifyConnected()) {
    console.error('Error: Not connected to Spotify. Use --artist "Name" or --all instead.')
    process.exit(1)
  }

  console.log('Fetching top artists from Spotify...')
  const topArtists = await getTopArtists('long_term', 50)
  console.log(`Found ${topArtists.length} top artists\n`)
  return topArtists.map(a => a.name)
}

function getMp3TracksForArtist(artistName: string): TrackRow[] {
  return db.prepare(`
    SELECT * FROM tracks
    WHERE download_status = 'complete'
      AND (format = 'mp3' OR format = '' OR format IS NULL)
      AND (COALESCE(NULLIF(album_artist, ''), artist) = ? OR artist = ?)
    ORDER BY album, disc_number, track_number
  `).all(artistName, artistName) as TrackRow[]
}

async function retryOnEperm<T>(fn: () => Promise<T>, retries = 3, delayMs = 2000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err: any) {
      if (err?.code === 'EPERM' && i < retries - 1) {
        await new Promise(r => setTimeout(r, delayMs))
        continue
      }
      throw err
    }
  }
  throw new Error('unreachable')
}

function moveFile(src: string, dest: string): void {
  try {
    renameSync(src, dest)
  } catch (err: any) {
    if (err?.code === 'EXDEV' || err?.code === 'EPERM') {
      copyFileSync(src, dest)
      try { unlinkSync(src) } catch {}
    } else {
      throw err
    }
  }
}

async function upgradeTrack(track: TrackRow): Promise<boolean> {
  const match = await searchDeezer(track.artist, track.title, track.duration_ms)
  if (!match) {
    console.log(`    ✗ No Deezer match: ${track.title}`)
    return false
  }

  const stagingDir = path.join(MUSIC_DIR, '_staging', String(track.id))
  mkdirSync(stagingDir, { recursive: true })

  try {
    const downloadedPath = await downloadDeezerTrack(match.id, stagingDir, AUDIO_FORMAT)
    const actualExt = path.extname(downloadedPath).slice(1) as 'flac' | 'mp3'

    // Compute new path
    const newRelativePath = getTrackPath(track.artist, track.album, track.track_number, track.title, track.album_artist, actualExt)
    const newAbsolutePath = getAbsolutePath(newRelativePath)
    ensureDirectories(newRelativePath)

    // Move downloaded file to library
    moveFile(downloadedPath, newAbsolutePath)

    // Tag with our conventions (retry on EPERM since Navidrome may have file locked)
    await retryOnEperm(() => tagFile(newAbsolutePath, {
      title: track.title,
      artist: track.artist,
      album: track.album,
      trackNumber: String(track.track_number),
      partOfSet: String(track.disc_number),
      albumArtUrl: track.album_art_url || match.albumCoverUrl || undefined,
      albumArtist: track.album_artist || undefined,
    }))

    await retryOnEperm(() => normalizeFile(newAbsolutePath))

    // Write LRC sidecar if we have synced lyrics
    if (track.lyrics_synced) {
      writeLrcFile(newAbsolutePath, track.lyrics_synced)
    }

    // Delete old MP3 file
    const oldAbsolutePath = getAbsolutePath(track.file_path)
    if (existsSync(oldAbsolutePath) && oldAbsolutePath !== newAbsolutePath) {
      unlinkSync(oldAbsolutePath)
      // Also remove old .lrc if it existed
      const oldLrc = oldAbsolutePath.replace(/\.mp3$/i, '.lrc')
      if (existsSync(oldLrc)) unlinkSync(oldLrc)
    }

    // Update DB
    updateTrackStatus(track.id, 'complete', {
      file_path: newRelativePath,
      deezer_id: String(match.id),
      format: actualExt,
    })

    console.log(`    ✓ ${track.title} → ${actualExt.toUpperCase()}`)
    return true
  } finally {
    try { rmSync(stagingDir, { recursive: true, force: true }) } catch {}
  }
}

async function main() {
  const artists = await getArtistPriority()

  let totalUpgraded = 0
  let totalFailed = 0
  let totalSkipped = 0

  for (const artistName of artists) {
    const mp3Tracks = getMp3TracksForArtist(artistName)
    if (mp3Tracks.length === 0) continue

    console.log(`\n${artistName} — ${mp3Tracks.length} MP3 tracks to upgrade`)

    if (dryRun) {
      for (const t of mp3Tracks) {
        console.log(`  [dry-run] ${t.album} / ${t.title}`)
      }
      totalSkipped += mp3Tracks.length
      continue
    }

    let artistUpgraded = 0
    let artistFailed = 0

    for (const track of mp3Tracks) {
      try {
        const success = await upgradeTrack(track)
        if (success) {
          artistUpgraded++
          totalUpgraded++
        } else {
          artistFailed++
          totalFailed++
        }
      } catch (err) {
        console.log(`    ✗ Error: ${track.title} — ${(err as Error).message}`)
        artistFailed++
        totalFailed++
      }

      // Delay between downloads
      await new Promise(r => setTimeout(r, 1500))
    }

    console.log(`  Done: ${artistUpgraded}/${mp3Tracks.length} upgraded${artistFailed > 0 ? `, ${artistFailed} failed` : ''}`)
  }

  console.log(`\n=== Summary ===`)
  if (dryRun) {
    console.log(`Dry run: ${totalSkipped} tracks would be upgraded`)
  } else {
    console.log(`Upgraded: ${totalUpgraded}, Failed: ${totalFailed}`)
  }

  // Trigger Navidrome scan
  if (!dryRun && totalUpgraded > 0) {
    try {
      const { triggerNavidromeScan } = await import('../src/services/navidrome.js')
      await triggerNavidromeScan()
      console.log('Navidrome scan triggered')
    } catch {}
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
