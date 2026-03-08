import { Router } from 'express'
import { getAllArtists, getAllAlbums, getAlbumsByArtist, getAlbumTracks, searchTracks, getLibraryStats, getTracksByStatus } from '../db/index.js'
import { triggerNavidromeScan } from '../services/navidrome.js'
import { normalizeLibrary } from '../services/normalizer.js'

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

export default router
