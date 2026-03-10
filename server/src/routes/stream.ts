import { Router } from 'express'
import { createReadStream, statSync, existsSync, readFileSync } from 'fs'
import path from 'path'
import { getTrackById } from '../db/index.js'
import { getAbsolutePath } from '../services/organizer.js'

const router = Router()

// Stream audio file with Range request support
router.get('/:trackId', (req, res) => {
  const trackId = parseInt(req.params.trackId)
  const track = getTrackById(trackId)
  if (!track || !track.file_path) {
    res.status(404).json({ error: 'Track not found' })
    return
  }

  const absolutePath = getAbsolutePath(track.file_path)
  if (!existsSync(absolutePath)) {
    res.status(404).json({ error: 'File not found' })
    return
  }

  const stat = statSync(absolutePath)
  const fileSize = stat.size
  const ext = path.extname(absolutePath).toLowerCase()
  const contentType = ext === '.flac' ? 'audio/flac' : 'audio/mpeg'

  const range = req.headers.range
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    const chunkSize = end - start + 1

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    })
    createReadStream(absolutePath, { start, end }).pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    })
    createReadStream(absolutePath).pipe(res)
  }
})

// Serve cover art for a track
router.get('/art/:trackId', async (req, res) => {
  const trackId = parseInt(req.params.trackId)
  const track = getTrackById(trackId)
  if (!track) {
    res.status(404).json({ error: 'Track not found' })
    return
  }

  // If we have an external URL, proxy it
  if (track.album_art_url && track.album_art_url.startsWith('http')) {
    try {
      const response = await fetch(track.album_art_url)
      if (response.ok) {
        const contentType = response.headers.get('content-type') || 'image/jpeg'
        res.setHeader('Content-Type', contentType)
        res.setHeader('Cache-Control', 'public, max-age=86400')
        const buffer = Buffer.from(await response.arrayBuffer())
        res.send(buffer)
        return
      }
    } catch {
      // Fall through to embedded art extraction
    }
  }

  // Try to find cover.jpg in the album folder
  if (track.file_path) {
    const absolutePath = getAbsolutePath(track.file_path)
    const albumDir = path.dirname(absolutePath)
    const coverPath = path.join(albumDir, 'cover.jpg')
    if (existsSync(coverPath)) {
      res.setHeader('Content-Type', 'image/jpeg')
      res.setHeader('Cache-Control', 'public, max-age=86400')
      res.send(readFileSync(coverPath))
      return
    }

    // Try cover.png
    const coverPng = path.join(albumDir, 'cover.png')
    if (existsSync(coverPng)) {
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'public, max-age=86400')
      res.send(readFileSync(coverPng))
      return
    }
  }

  // Try extracting embedded art from MP3 via node-id3
  if (track.file_path) {
    const absolutePath = getAbsolutePath(track.file_path)
    const ext = path.extname(absolutePath).toLowerCase()
    if (ext === '.mp3' && existsSync(absolutePath)) {
      try {
        const NodeID3 = await import('node-id3')
        const tags = NodeID3.default.read(absolutePath)
        if (tags.image && typeof tags.image !== 'string' && tags.image.imageBuffer) {
          const mime = tags.image.mime || 'image/jpeg'
          res.setHeader('Content-Type', mime)
          res.setHeader('Cache-Control', 'public, max-age=86400')
          res.send(tags.image.imageBuffer)
          return
        }
      } catch {
        // Fall through
      }
    }
  }

  // No art found — return 404
  res.status(404).json({ error: 'No cover art available' })
})

export default router
