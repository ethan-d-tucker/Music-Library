import { Router } from 'express'
import { searchYouTube, searchYouTubePlaylists, downloadAudio, expandPlaylist } from '../services/ytdlp.js'
import { findBestMatch } from '../services/matcher.js'
import { tagFile } from '../services/tagger.js'
import { getTrackPath, getAbsolutePath, ensureDirectories } from '../services/organizer.js'
import { getTrackById, getPendingTracks, updateTrackStatus, insertTrack, type TrackRow } from '../db/index.js'
import { triggerNavidromeScan } from '../services/navidrome.js'
import { normalizeFile } from '../services/normalizer.js'
import { MUSIC_DIR } from '../config.js'

const router = Router()

// Active batch jobs (in-memory)
interface BatchJob {
  id: string
  total: number
  completed: number
  failed: number
  current: string
  done: boolean
  errors: { trackId: number; title: string; error: string }[]
}

const activeJobs = new Map<string, BatchJob>()

router.post('/search', async (req, res) => {
  const { query } = req.body as { query: string }
  if (!query) {
    res.status(400).json({ error: 'query required' })
    return
  }
  try {
    const results = await searchYouTube(query, 8)
    res.json({ results })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/search-playlists', async (req, res) => {
  const { query } = req.body as { query: string }
  if (!query) {
    res.status(400).json({ error: 'query required' })
    return
  }
  try {
    const playlists = await searchYouTubePlaylists(query)
    res.json({ playlists })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

async function downloadAndTagTrack(track: TrackRow): Promise<void> {
  updateTrackStatus(track.id, 'downloading')

  // Find best YouTube match
  const match = await findBestMatch(track.artist, track.title, track.duration_ms)
  if (!match) {
    updateTrackStatus(track.id, 'failed', { error_message: 'No good YouTube match found' })
    throw new Error(`No match for "${track.artist} - ${track.title}"`)
  }

  // Compute file path
  const relativePath = getTrackPath(track.artist, track.album, track.track_number, track.title, track.album_artist)
  const absolutePath = getAbsolutePath(relativePath)
  ensureDirectories(relativePath)

  // Download
  await downloadAudio(match.result.url, absolutePath)

  // Tag
  await tagFile(absolutePath, {
    title: track.title,
    artist: track.artist,
    album: track.album,
    trackNumber: String(track.track_number),
    partOfSet: String(track.disc_number),
    albumArtUrl: track.album_art_url,
    albumArtist: track.album_artist || undefined,
  })

  // Normalize artist name if needed
  await normalizeFile(absolutePath)

  // Update DB
  updateTrackStatus(track.id, 'complete', {
    file_path: relativePath,
    youtube_id: match.result.id,
  })
}

router.post('/track/:id', async (req, res) => {
  const trackId = parseInt(req.params.id)
  const track = getTrackById(trackId)
  if (!track) {
    res.status(404).json({ error: 'Track not found' })
    return
  }

  try {
    await downloadAndTagTrack(track)
    await triggerNavidromeScan()
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// Download from a specific YouTube URL with manual metadata
router.post('/url', async (req, res) => {
  const { url, title, artist, album } = req.body as { url: string; title: string; artist: string; album?: string }
  if (!url || !title || !artist) {
    res.status(400).json({ error: 'url, title, and artist required' })
    return
  }

  try {
    const trackId = insertTrack({ title, artist, album })
    const track = getTrackById(trackId)!

    const relativePath = getTrackPath(artist, album || '', 0, title)
    const absolutePath = getAbsolutePath(relativePath)
    ensureDirectories(relativePath)

    await downloadAudio(url, absolutePath)
    await tagFile(absolutePath, { title, artist, album: album || '', trackNumber: '0' })

    updateTrackStatus(trackId, 'complete', {
      file_path: relativePath,
      youtube_id: new URL(url).searchParams.get('v') || '',
    })

    await triggerNavidromeScan()
    res.json({ success: true, track: getTrackById(trackId) })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// Start batch download — optionally provide trackIds to download specific tracks
router.post('/batch', (req, res) => {
  const { trackIds } = req.body as { trackIds?: number[] }
  let tracks: TrackRow[]
  if (trackIds && trackIds.length > 0) {
    tracks = trackIds.map(id => getTrackById(id)).filter((t): t is TrackRow => t !== undefined && t.download_status !== 'complete')
  } else {
    tracks = getPendingTracks()
  }
  if (tracks.length === 0) {
    res.json({ message: 'No tracks to download' })
    return
  }
  const pending = tracks

  const jobId = crypto.randomUUID()
  const job: BatchJob = {
    id: jobId,
    total: pending.length,
    completed: 0,
    failed: 0,
    current: '',
    done: false,
    errors: [],
  }
  activeJobs.set(jobId, job)

  // Process in background
  ;(async () => {
    for (const track of pending) {
      job.current = `${track.artist} - ${track.title}`
      try {
        await downloadAndTagTrack(track)
        job.completed++
      } catch (err) {
        job.failed++
        job.errors.push({ trackId: track.id, title: `${track.artist} - ${track.title}`, error: (err as Error).message })
      }
      // Small delay to avoid YouTube throttling
      await new Promise(r => setTimeout(r, 1500))
    }
    job.done = true
    job.current = ''
    await triggerNavidromeScan()
    // Clean up after 5 minutes
    setTimeout(() => activeJobs.delete(jobId), 5 * 60 * 1000)
  })()

  res.json({ jobId, total: pending.length })
})

// SSE progress endpoint
router.get('/progress/:jobId', (req, res) => {
  const job = activeJobs.get(req.params.jobId)
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
      failed: job.failed,
      current: job.current,
      done: job.done,
      errors: job.errors,
    })}\n\n`)

    if (job.done) {
      clearInterval(interval)
      res.end()
    }
  }, 500)

  req.on('close', () => clearInterval(interval))
})

// Expand a YouTube playlist/album URL into individual tracks
router.post('/playlist', async (req, res) => {
  const { url } = req.body as { url: string }
  if (!url) {
    res.status(400).json({ error: 'url required' })
    return
  }
  try {
    const result = await expandPlaylist(url)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
