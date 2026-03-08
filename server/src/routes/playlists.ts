import { Router } from 'express'
import { getAllPlaylists, getPlaylistById, getPlaylistTracks, insertPlaylist, addTrackToPlaylist } from '../db/index.js'
import { writeM3U, generateM3U } from '../services/m3u.js'
import db from '../db/index.js'

const router = Router()

router.get('/', (_req, res) => {
  const playlists = getAllPlaylists()
  // Include track count for each playlist
  const withCounts = playlists.map(p => ({
    ...p,
    trackCount: (db.prepare('SELECT COUNT(*) as c FROM playlist_tracks WHERE playlist_id = ?').get(p.id) as { c: number }).c,
  }))
  res.json({ playlists: withCounts })
})

router.get('/:id', (req, res) => {
  const playlist = getPlaylistById(parseInt(req.params.id))
  if (!playlist) {
    res.status(404).json({ error: 'Playlist not found' })
    return
  }
  const tracks = getPlaylistTracks(playlist.id)
  res.json({ playlist, tracks })
})

router.post('/', (req, res) => {
  const { name, description } = req.body as { name: string; description?: string }
  if (!name) {
    res.status(400).json({ error: 'name required' })
    return
  }
  const id = insertPlaylist({ name, description })
  res.json({ id })
})

router.post('/:id/tracks', (req, res) => {
  const playlistId = parseInt(req.params.id)
  const { trackId, position } = req.body as { trackId: number; position: number }
  if (!trackId || position === undefined) {
    res.status(400).json({ error: 'trackId and position required' })
    return
  }
  addTrackToPlaylist(playlistId, trackId, position)
  res.json({ success: true })
})

router.delete('/:id', (req, res) => {
  const playlistId = parseInt(req.params.id)
  db.prepare('DELETE FROM playlists WHERE id = ?').run(playlistId)
  res.json({ success: true })
})

router.get('/:id/m3u', (req, res) => {
  const playlist = getPlaylistById(parseInt(req.params.id))
  if (!playlist) {
    res.status(404).json({ error: 'Playlist not found' })
    return
  }
  const tracks = getPlaylistTracks(playlist.id)
  const content = generateM3U(playlist.name, tracks)
  res.setHeader('Content-Type', 'audio/x-mpegurl')
  res.setHeader('Content-Disposition', `attachment; filename="${playlist.name}.m3u"`)
  res.send(content)
})

router.post('/:id/export', (req, res) => {
  const playlist = getPlaylistById(parseInt(req.params.id))
  if (!playlist) {
    res.status(404).json({ error: 'Playlist not found' })
    return
  }
  const tracks = getPlaylistTracks(playlist.id)
  const m3uPath = writeM3U(playlist.name, tracks)
  db.prepare('UPDATE playlists SET m3u_path = ? WHERE id = ?').run(m3uPath, playlist.id)
  res.json({ success: true, m3uPath })
})

export default router
