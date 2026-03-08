import { Router } from 'express'
import NodeID3 from 'node-id3'
import { getAllArtists, getAllAlbums, getAlbumsByArtist, getAlbumTracks, searchTracks, getLibraryStats, getTracksByStatus, getTracksNeedingLyrics, updateTrackLyrics } from '../db/index.js'
import { triggerNavidromeScan } from '../services/navidrome.js'
import { normalizeLibrary } from '../services/normalizer.js'
import { fetchLyrics, writeLrcFile } from '../services/lyrics.js'
import { getAbsolutePath } from '../services/organizer.js'

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

export default router
