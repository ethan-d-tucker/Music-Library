import { Router } from 'express'
import NodeID3 from 'node-id3'
import multer from 'multer'
import { existsSync, renameSync, mkdirSync, rmSync, readdirSync, copyFileSync } from 'fs'
import path from 'path'
import { getAllArtists, getAllAlbums, getAlbumsByArtist, getAlbumTracks, searchTracks, getLibraryStats, getTracksByStatus, getTracksNeedingLyrics, updateTrackLyrics, getTrackById, updateTrackMetadata, recordPlay, getRecentlyPlayed, getTopArtists, getRandomAlbums, getRecentlyAdded, getMostPlayedTracks, searchArtists, deleteTrackFromDb, reorderAlbumTracks } from '../db/index.js'
import { triggerNavidromeScan } from '../services/navidrome.js'
import { normalizeLibrary } from '../services/normalizer.js'
import { fetchLyrics, writeLrcFile } from '../services/lyrics.js'
import { getAbsolutePath, getTrackPath, ensureDirectories } from '../services/organizer.js'
import { tagFile } from '../services/tagger.js'
import { MUSIC_DIR } from '../config.js'

const router = Router()

router.get('/stats', (_req, res) => {
  res.json(getLibraryStats())
})

router.get('/artists', (_req, res) => {
  res.json({ artists: getAllArtists() })
})

router.get('/artists/:name/albums', (req, res) => {
  res.json({ albums: getAlbumsByArtist(req.params.name) })
})

router.get('/albums', (req, res) => {
  const query = req.query.q as string
  res.json({ albums: getAllAlbums(query || undefined) })
})

router.get('/albums/:artist/:album', (req, res) => {
  res.json({ tracks: getAlbumTracks(req.params.artist, req.params.album) })
})

router.get('/tracks', (req, res) => {
  const query = req.query.q as string
  const status = req.query.status as string
  if (status) {
    res.json({ tracks: getTracksByStatus(status) })
  } else if (query) {
    res.json({ tracks: searchTracks(query) })
  } else {
    res.json({ tracks: searchTracks('') })
  }
})

router.post('/rescan', async (_req, res) => {
  await triggerNavidromeScan()
  res.json({ success: true, message: 'Navidrome scan triggered' })
})

router.post('/normalize', async (_req, res) => {
  try {
    const result = await normalizeLibrary()
    await triggerNavidromeScan()
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// --- Metadata editing ---

const upload = multer({ dest: path.join(MUSIC_DIR, '_staging') })

// Update track metadata
router.put('/tracks/:id', async (req, res) => {
  const trackId = parseInt(req.params.id as string)
  const track = getTrackById(trackId)
  if (!track) {
    res.status(404).json({ error: 'Track not found' })
    return
  }

  const { title, artist, album, album_artist, track_number, year } = req.body as {
    title?: string; artist?: string; album?: string; album_artist?: string
    track_number?: number; year?: number
  }

  // Update DB
  updateTrackMetadata(trackId, { title, artist, album, album_artist, track_number, year })

  // Re-tag the file if it exists
  if (track.file_path && track.download_status === 'complete') {
    const currentPath = getAbsolutePath(track.file_path)
    if (existsSync(currentPath)) {
      const updatedTrack = getTrackById(trackId)!

      // Re-write tags
      await tagFile(currentPath, {
        title: updatedTrack.title,
        artist: updatedTrack.artist,
        album: updatedTrack.album,
        trackNumber: String(updatedTrack.track_number),
        albumArtist: updatedTrack.album_artist || undefined,
        albumArtUrl: updatedTrack.album_art_url || undefined,
      })

      // Move file if artist or album changed
      if (artist !== undefined || album !== undefined || album_artist !== undefined) {
        const ext = path.extname(currentPath).slice(1) as 'flac' | 'mp3'
        const newRelativePath = getTrackPath(
          updatedTrack.artist, updatedTrack.album,
          updatedTrack.track_number, updatedTrack.title,
          updatedTrack.album_artist, ext
        )
        const newAbsolutePath = getAbsolutePath(newRelativePath)

        if (currentPath !== newAbsolutePath) {
          ensureDirectories(newRelativePath)
          renameSync(currentPath, newAbsolutePath)
          updateTrackMetadata(trackId, { file_path: newRelativePath })

          // Clean up empty directories
          try {
            const oldDir = path.dirname(currentPath)
            if (existsSync(oldDir) && readdirSync(oldDir).length === 0) {
              rmSync(oldDir, { recursive: true })
              const parentDir = path.dirname(oldDir)
              if (existsSync(parentDir) && readdirSync(parentDir).length === 0) {
                rmSync(parentDir, { recursive: true })
              }
            }
          } catch {}
        }
      }
    }
  }

  await triggerNavidromeScan()
  res.json({ success: true, track: getTrackById(trackId) })
})

// Upload cover art for a track
router.put('/tracks/:id/art', upload.single('art'), async (req, res) => {
  const trackId = parseInt(req.params.id as string)
  const track = getTrackById(trackId)
  if (!track) {
    res.status(404).json({ error: 'Track not found' })
    return
  }

  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' })
    return
  }

  try {
    const tempPath = req.file.path

    // Save as cover.jpg in the album folder
    if (track.file_path) {
      const trackAbsPath = getAbsolutePath(track.file_path)
      const albumDir = path.dirname(trackAbsPath)
      const coverPath = path.join(albumDir, 'cover.jpg')
      copyFileSync(tempPath, coverPath)
    }

    // Update album_art_url to point to our art endpoint
    updateTrackMetadata(trackId, { album_art_url: `/api/stream/art/${trackId}` })

    // Clean up temp file
    try { rmSync(tempPath) } catch {}

    await triggerNavidromeScan()
    res.json({ success: true, track: getTrackById(trackId) })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// Backfill lyrics for existing tracks
interface LyricsJob {
  id: string
  total: number
  completed: number
  found: number
  done: boolean
}

const lyricsJobs = new Map<string, LyricsJob>()

router.post('/backfill-lyrics', (_req, res) => {
  const tracks = getTracksNeedingLyrics()
  if (tracks.length === 0) {
    res.json({ message: 'No tracks need lyrics' })
    return
  }

  const jobId = crypto.randomUUID()
  const job: LyricsJob = { id: jobId, total: tracks.length, completed: 0, found: 0, done: false }
  lyricsJobs.set(jobId, job)

  ;(async () => {
    for (const track of tracks) {
      try {
        const lyrics = await fetchLyrics({
          artist: track.artist,
          title: track.title,
          album: track.album,
          durationMs: track.duration_ms,
        })
        if (lyrics) {
          job.found++
          // Embed USLT in existing MP3
          if (track.file_path && lyrics.plain) {
            const absPath = getAbsolutePath(track.file_path)
            NodeID3.update({ unsynchronisedLyrics: { language: 'eng', text: lyrics.plain } }, absPath)
            if (lyrics.synced) writeLrcFile(absPath, lyrics.synced)
          }
          updateTrackLyrics(track.id, lyrics.plain, lyrics.synced, 'found')
        } else {
          updateTrackLyrics(track.id, '', '', 'not_found')
        }
      } catch {
        updateTrackLyrics(track.id, '', '', 'error')
      }
      job.completed++
      await new Promise(r => setTimeout(r, 500))
    }
    job.done = true
    await triggerNavidromeScan()
    setTimeout(() => lyricsJobs.delete(jobId), 5 * 60 * 1000)
  })()

  res.json({ jobId, total: tracks.length })
})

router.get('/backfill-lyrics/:jobId', (req, res) => {
  const job = lyricsJobs.get(req.params.jobId)
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify({
      total: job.total,
      completed: job.completed,
      found: job.found,
      done: job.done,
    })}\n\n`)

    if (job.done) {
      clearInterval(interval)
      res.end()
    }
  }, 500)

  req.on('close', () => clearInterval(interval))
})

// Get lyrics for a track
router.get('/tracks/:id/lyrics', (req, res) => {
  const trackId = parseInt(req.params.id as string)
  const track = getTrackById(trackId)
  if (!track) {
    res.status(404).json({ error: 'Track not found' })
    return
  }
  res.json({ plain: track.lyrics_plain || '', synced: track.lyrics_synced || '' })
})

// Record a play (for history)
router.post('/play-history', (req, res) => {
  if (!req.user) {
    res.json({ success: true }) // silently ignore if not logged in
    return
  }
  const { trackId } = req.body as { trackId: number }
  if (!trackId) {
    res.status(400).json({ error: 'trackId required' })
    return
  }
  recordPlay(req.user.id, trackId)
  res.json({ success: true })
})

// Get play history for current user
router.get('/play-history', (req, res) => {
  if (!req.user) {
    res.json({ tracks: [] })
    return
  }
  const tracks = getRecentlyPlayed(req.user.id)
  res.json({ tracks })
})

// --- Library Management ---

// Delete track (removes file + DB + playlist refs)
router.delete('/tracks/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const track = deleteTrackFromDb(id)
  if (!track) {
    res.status(404).json({ error: 'Track not found' })
    return
  }
  // Delete file from disk
  if (track.file_path) {
    const absPath = getAbsolutePath(track.file_path)
    try {
      if (existsSync(absPath)) {
        rmSync(absPath)
        // Clean up empty parent directories
        let dir = path.dirname(absPath)
        while (dir !== MUSIC_DIR && dir !== path.dirname(dir)) {
          try {
            const entries = readdirSync(dir)
            if (entries.length === 0) {
              rmSync(dir, { recursive: true })
              dir = path.dirname(dir)
            } else {
              break
            }
          } catch { break }
        }
      }
    } catch (err) {
      console.error(`Failed to delete file ${absPath}:`, err)
    }
  }
  // Delete .lrc sidecar file if exists
  if (track.file_path) {
    const lrcPath = getAbsolutePath(track.file_path.replace(/\.[^.]+$/, '.lrc'))
    try { if (existsSync(lrcPath)) rmSync(lrcPath) } catch {}
  }
  triggerNavidromeScan()
  res.json({ success: true })
})

// Move track to different album
router.post('/tracks/:id/move', async (req, res) => {
  const id = parseInt(req.params.id)
  const { artist, album, album_artist } = req.body
  if (!artist || !album) {
    res.status(400).json({ error: 'artist and album required' })
    return
  }
  try {
    const result = await updateTrackMetadata(id, {
      artist,
      album,
      album_artist: album_artist || artist,
    })
    triggerNavidromeScan()
    res.json({ success: true, track: result })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// Reorder tracks within an album
router.put('/albums/reorder', (req, res) => {
  const { artist, album, trackIds } = req.body
  if (!artist || !album || !Array.isArray(trackIds)) {
    res.status(400).json({ error: 'artist, album, and trackIds required' })
    return
  }
  reorderAlbumTracks(artist, album, trackIds)
  triggerNavidromeScan()
  res.json({ success: true })
})

// Merge albums (move all tracks from source to target)
router.post('/albums/merge', async (req, res) => {
  const { source, target } = req.body
  if (!source?.artist || !source?.album || !target?.artist || !target?.album) {
    res.status(400).json({ error: 'source and target with artist/album required' })
    return
  }
  const sourceTracks = getAlbumTracks(source.artist, source.album)
  let moved = 0
  for (const track of sourceTracks) {
    try {
      await updateTrackMetadata(track.id, {
        artist: target.artist,
        album: target.album,
        album_artist: target.artist,
      })
      moved++
    } catch (err) {
      console.error(`Failed to move track ${track.id}:`, err)
    }
  }
  triggerNavidromeScan()
  res.json({ success: true, moved })
})

// Unified search (artists + albums + tracks)
router.get('/search', (req, res) => {
  const q = (req.query.q as string || '').trim()
  if (!q) {
    res.json({ artists: [], albums: [], tracks: [] })
    return
  }
  const artists = searchArtists(q, 10)
  const albums = getAllAlbums(q).slice(0, 10)
  const tracks = searchTracks(q).filter(t => t.download_status === 'complete').slice(0, 20)
  res.json({ artists, albums, tracks })
})

// Homepage data
router.get('/home', (req, res) => {
  const userId = req.user?.id
  const recentlyPlayed = userId ? getRecentlyPlayed(userId) : []
  const topArtists = userId ? getTopArtists(userId) : []
  const randomAlbums = getRandomAlbums(9)
  const recentlyAdded = getRecentlyAdded(20)
  const mostPlayed = userId ? getMostPlayedTracks(userId, 20) : []
  res.json({ recentlyPlayed, topArtists, randomAlbums, recentlyAdded, mostPlayed })
})

export default router
