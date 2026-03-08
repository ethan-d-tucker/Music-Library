import { Router } from 'express'
import {
  getAuthUrl, exchangeCode, getUserPlaylists,
  getPlaylistTracks as getSpotifyPlaylistTracks,
  getSavedAlbums, getAlbumTracks as getSpotifyAlbumTracks,
  getLikedSongs, getLikedSongsCount,
  searchSpotify, isConnected
} from '../services/spotify.js'
import { insertTrack, insertPlaylist, addTrackToPlaylist, setConfig } from '../db/index.js'
import type { SpotifyTrack } from '../services/spotify.js'

const router = Router()

router.get('/status', (_req, res) => {
  res.json({ connected: isConnected() })
})

router.post('/disconnect', (_req, res) => {
  setConfig('spotify_access_token', '')
  setConfig('spotify_refresh_token', '')
  setConfig('spotify_token_expires', '')
  res.json({ success: true })
})

router.get('/auth', (req, res) => {
  const redirectUri = 'http://127.0.0.1:3001/api/spotify/callback'
  // Pass the frontend origin as state so callback knows where to redirect
  const frontendOrigin = req.query.origin as string || 'http://localhost:5173'
  const url = getAuthUrl(redirectUri, frontendOrigin)
  res.json({ url })
})

router.get('/callback', async (req, res) => {
  const code = req.query.code as string
  if (!code) {
    res.status(400).json({ error: 'Missing code parameter' })
    return
  }

  const redirectUri = 'http://127.0.0.1:3001/api/spotify/callback'

  try {
    await exchangeCode(code, redirectUri)
    // state contains the frontend origin passed during auth
    const frontendUrl = (req.query.state as string) || 'http://localhost:5173'
    res.redirect(`${frontendUrl}/?spotify=connected`)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/playlists', async (_req, res) => {
  try {
    const playlists = await getUserPlaylists()
    res.json({ playlists })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/playlists/:id/tracks', async (req, res) => {
  try {
    const tracks = await getSpotifyPlaylistTracks(req.params.id)
    res.json({ tracks })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/albums', async (_req, res) => {
  try {
    const albums = await getSavedAlbums()
    res.json({ albums })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/liked-songs/count', async (_req, res) => {
  try {
    const count = await getLikedSongsCount()
    res.json({ count })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/search', async (req, res) => {
  const query = req.query.q as string
  if (!query) {
    res.status(400).json({ error: 'q parameter required' })
    return
  }
  try {
    const results = await searchSpotify(query)
    res.json(results)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// Helper to insert an array of SpotifyTracks into DB
function importTracksToDb(tracks: SpotifyTrack[]): number {
  let imported = 0
  for (const t of tracks) {
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
    imported++
  }
  return imported
}

router.post('/import', async (req, res) => {
  const { playlistIds } = req.body as { playlistIds: string[] }
  if (!playlistIds || !Array.isArray(playlistIds)) {
    res.status(400).json({ error: 'playlistIds array required' })
    return
  }

  try {
    const results: { name: string; tracksImported: number }[] = []

    for (const spotifyPlaylistId of playlistIds) {
      const playlists = await getUserPlaylists()
      const playlistInfo = playlists.find(p => p.id === spotifyPlaylistId)
      if (!playlistInfo) continue

      const dbPlaylistId = insertPlaylist({
        name: playlistInfo.name,
        description: playlistInfo.description,
        spotify_id: spotifyPlaylistId,
      })

      const tracks = await getSpotifyPlaylistTracks(spotifyPlaylistId)
      let imported = 0
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i]
        const trackId = insertTrack({
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
        addTrackToPlaylist(dbPlaylistId, trackId, i)
        imported++
      }

      results.push({ name: playlistInfo.name, tracksImported: imported })
    }

    res.json({ success: true, results })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/import-albums', async (req, res) => {
  const { albumIds } = req.body as { albumIds: string[] }
  if (!albumIds || !Array.isArray(albumIds)) {
    res.status(400).json({ error: 'albumIds array required' })
    return
  }

  try {
    const results: { name: string; tracksImported: number }[] = []

    for (const albumId of albumIds) {
      const tracks = await getSpotifyAlbumTracks(albumId)
      if (tracks.length === 0) continue
      const imported = importTracksToDb(tracks)
      results.push({ name: `${tracks[0].albumArtist} - ${tracks[0].album}`, tracksImported: imported })
    }

    res.json({ success: true, results })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/import-liked', async (_req, res) => {
  try {
    const tracks = await getLikedSongs()
    const imported = importTracksToDb(tracks)

    // Also create a "Liked Songs" playlist
    const dbPlaylistId = insertPlaylist({
      name: 'Liked Songs',
      description: 'Imported from Spotify Liked Songs',
      spotify_id: 'liked-songs',
    })
    for (let i = 0; i < tracks.length; i++) {
      const existing = insertTrack({
        title: tracks[i].title,
        artist: tracks[i].artist,
        album: tracks[i].album,
        album_artist: tracks[i].albumArtist,
        track_number: tracks[i].trackNumber,
        disc_number: tracks[i].discNumber,
        duration_ms: tracks[i].durationMs,
        spotify_id: tracks[i].spotifyId,
        album_art_url: tracks[i].albumArtUrl,
      })
      addTrackToPlaylist(dbPlaylistId, existing, i)
    }

    res.json({ success: true, results: [{ name: 'Liked Songs', tracksImported: imported }] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
