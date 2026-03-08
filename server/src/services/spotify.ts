import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } from '../config.js'
import { getConfig, setConfig } from '../db/index.js'

const SPOTIFY_API = 'https://api.spotify.com/v1'
const SPOTIFY_AUTH = 'https://accounts.spotify.com'

export interface SpotifyPlaylist {
  id: string
  name: string
  description: string
  trackCount: number
  imageUrl: string
}

export interface SpotifyAlbum {
  id: string
  name: string
  artist: string
  trackCount: number
  imageUrl: string
}

export interface SpotifyTrack {
  spotifyId: string
  title: string
  artist: string
  albumArtist: string
  album: string
  albumId?: string
  trackNumber: number
  discNumber: number
  durationMs: number
  albumArtUrl: string
}

export function getAuthUrl(redirectUri: string, state?: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: 'playlist-read-private playlist-read-collaborative user-library-read user-top-read',
    redirect_uri: redirectUri,
  })
  if (state) params.set('state', state)
  return `${SPOTIFY_AUTH}/authorize?${params.toString()}`
}

export async function exchangeCode(code: string, redirectUri: string): Promise<void> {
  const res = await fetch(`${SPOTIFY_AUTH}/api/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`)
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number }
  setConfig('spotify_access_token', data.access_token)
  setConfig('spotify_refresh_token', data.refresh_token)
  setConfig('spotify_token_expires', String(Date.now() + data.expires_in * 1000))
}

async function refreshToken(): Promise<string> {
  const refreshToken = getConfig('spotify_refresh_token')
  if (!refreshToken) throw new Error('Not connected to Spotify')

  const res = await fetch(`${SPOTIFY_AUTH}/api/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`)
  const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number }
  setConfig('spotify_access_token', data.access_token)
  if (data.refresh_token) setConfig('spotify_refresh_token', data.refresh_token)
  setConfig('spotify_token_expires', String(Date.now() + data.expires_in * 1000))
  return data.access_token
}

async function getAccessToken(): Promise<string> {
  const token = getConfig('spotify_access_token')
  const expires = getConfig('spotify_token_expires')
  if (token && expires && Date.now() < parseInt(expires) - 60_000) {
    return token
  }
  return refreshToken()
}

async function spotifyGet<T>(endpoint: string, retries = 3): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(`${SPOTIFY_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 429 && retries > 0) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10)
    await new Promise(r => setTimeout(r, retryAfter * 1000))
    return spotifyGet<T>(endpoint, retries - 1)
  }
  if (!res.ok) throw new Error(`Spotify API error: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

interface SpotifyPaginatedResponse<T> {
  items: T[]
  next: string | null
  total: number
}

interface RawPlaylist {
  id: string
  name: string
  description: string
  images: { url: string }[]
}

export async function getUserPlaylists(): Promise<SpotifyPlaylist[]> {
  const playlists: SpotifyPlaylist[] = []
  let offset = 0
  const limit = 50

  while (true) {
    const data = await spotifyGet<{ items: RawPlaylist[]; next: string | null }>(`/me/playlists?limit=${limit}&offset=${offset}`)

    for (const p of data.items) {
      if (!p) continue
      const trackCount = (p as any).tracks?.total ?? (p as any).items?.total ?? 0
      playlists.push({
        id: p.id,
        name: p.name,
        description: p.description || '',
        trackCount,
        imageUrl: p.images?.[0]?.url || '',
      })
    }

    if (!data.next) break
    offset += limit
  }

  return playlists
}

export async function getPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = []
  let offset = 0
  const limit = 100

  while (true) {
    const data = await spotifyGet<SpotifyPaginatedResponse<{
      track: {
        id: string
        name: string
        artists: { name: string }[]
        album: { name: string; artists: { name: string }[]; images: { url: string }[] }
        track_number: number
        disc_number: number
        duration_ms: number
      } | null
    }>>(`/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}&fields=items(track(id,name,artists(name),album(name,artists(name),images(url)),track_number,disc_number,duration_ms)),next,total`)

    for (const item of data.items) {
      if (!item.track || !item.track.id) continue
      const t = item.track
      tracks.push({
        spotifyId: t.id,
        title: t.name,
        artist: t.artists.map(a => a.name).join(', '),
        albumArtist: t.album.artists.map(a => a.name).join(', '),
        album: t.album.name,
        trackNumber: t.track_number,
        discNumber: t.disc_number,
        durationMs: t.duration_ms,
        albumArtUrl: t.album.images?.[0]?.url || '',
      })
    }

    if (!data.next) break
    offset += limit
  }

  return tracks
}

export async function getSavedAlbums(): Promise<SpotifyAlbum[]> {
  const albums: SpotifyAlbum[] = []
  let offset = 0
  const limit = 50

  while (true) {
    const data = await spotifyGet<SpotifyPaginatedResponse<{
      album: {
        id: string
        name: string
        artists: { name: string }[]
        total_tracks: number
        images: { url: string }[]
      }
    }>>(`/me/albums?limit=${limit}&offset=${offset}`)

    for (const item of data.items) {
      if (!item?.album) continue
      const a = item.album
      albums.push({
        id: a.id,
        name: a.name,
        artist: a.artists.map(x => x.name).join(', '),
        trackCount: a.total_tracks,
        imageUrl: a.images?.[0]?.url || '',
      })
    }

    if (!data.next) break
    offset += limit
  }

  return albums
}

export async function getAlbumTracks(albumId: string): Promise<SpotifyTrack[]> {
  // First get album info for art + artist
  const album = await spotifyGet<{
    name: string
    artists: { name: string }[]
    images: { url: string }[]
  }>(`/albums/${albumId}`)

  const albumName = album.name
  const albumArtist = album.artists.map(a => a.name).join(', ')
  const albumArtUrl = album.images?.[0]?.url || ''

  const tracks: SpotifyTrack[] = []
  let offset = 0
  const limit = 50

  while (true) {
    const data = await spotifyGet<SpotifyPaginatedResponse<{
      id: string
      name: string
      artists: { name: string }[]
      track_number: number
      disc_number: number
      duration_ms: number
    }>>(`/albums/${albumId}/tracks?limit=${limit}&offset=${offset}`)

    for (const t of data.items) {
      if (!t?.id) continue
      tracks.push({
        spotifyId: t.id,
        title: t.name,
        artist: t.artists.map(a => a.name).join(', '),
        albumArtist,
        album: albumName,
        trackNumber: t.track_number,
        discNumber: t.disc_number,
        durationMs: t.duration_ms,
        albumArtUrl,
      })
    }

    if (!data.next) break
    offset += limit
  }

  return tracks
}

export async function getLikedSongs(): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = []
  let offset = 0
  const limit = 50

  while (true) {
    const data = await spotifyGet<SpotifyPaginatedResponse<{
      track: {
        id: string
        name: string
        artists: { name: string }[]
        album: { name: string; artists: { name: string }[]; images: { url: string }[] }
        track_number: number
        disc_number: number
        duration_ms: number
      } | null
    }>>(`/me/tracks?limit=${limit}&offset=${offset}`)

    for (const item of data.items) {
      if (!item.track || !item.track.id) continue
      const t = item.track
      tracks.push({
        spotifyId: t.id,
        title: t.name,
        artist: t.artists.map(a => a.name).join(', '),
        albumArtist: t.album.artists.map(a => a.name).join(', '),
        album: t.album.name,
        trackNumber: t.track_number,
        discNumber: t.disc_number,
        durationMs: t.duration_ms,
        albumArtUrl: t.album.images?.[0]?.url || '',
      })
    }

    if (!data.next) break
    offset += limit
  }

  return tracks
}

export async function getLikedSongsCount(): Promise<number> {
  const data = await spotifyGet<{ total: number }>('/me/tracks?limit=1&offset=0')
  return data.total
}

export async function searchSpotify(query: string): Promise<{ albums: SpotifyAlbum[]; playlists: SpotifyPlaylist[] }> {
  const data = await spotifyGet<{
    albums: { items: { id: string; name: string; artists: { name: string }[]; total_tracks: number; images: { url: string }[] }[] }
    playlists: { items: ({ id: string; name: string; description: string; images: { url: string }[]; tracks: { total: number } } | null)[] }
  }>(`/search?type=album,playlist&q=${encodeURIComponent(query)}&limit=10`)

  const albums: SpotifyAlbum[] = data.albums.items.map(a => ({
    id: a.id,
    name: a.name,
    artist: a.artists.map(x => x.name).join(', '),
    trackCount: a.total_tracks,
    imageUrl: a.images?.[0]?.url || '',
  }))

  const playlists: SpotifyPlaylist[] = data.playlists.items
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map(p => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      trackCount: p.tracks?.total ?? 0,
      imageUrl: p.images?.[0]?.url || '',
    }))

  return { albums, playlists }
}

export function isConnected(): boolean {
  return !!getConfig('spotify_refresh_token')
}

export type TimeRange = 'short_term' | 'medium_term' | 'long_term'

export async function getTopTracks(timeRange: TimeRange, limit = 50): Promise<SpotifyTrack[]> {
  const data = await spotifyGet<{
    items: {
      id: string
      name: string
      artists: { name: string }[]
      album: { id: string; name: string; artists: { name: string }[]; images: { url: string }[] }
      track_number: number
      disc_number: number
      duration_ms: number
    }[]
  }>(`/me/top/tracks?time_range=${timeRange}&limit=${limit}`)

  return data.items.map(t => ({
    spotifyId: t.id,
    title: t.name,
    artist: t.artists.map(a => a.name).join(', '),
    albumArtist: t.album.artists.map(a => a.name).join(', '),
    album: t.album.name,
    albumId: t.album.id,
    trackNumber: t.track_number,
    discNumber: t.disc_number,
    durationMs: t.duration_ms,
    albumArtUrl: t.album.images?.[0]?.url || '',
  }))
}

export interface SpotifyArtist {
  id: string
  name: string
  imageUrl: string
  popularity: number
}

export async function getTopArtists(timeRange: TimeRange, limit = 50): Promise<SpotifyArtist[]> {
  const data = await spotifyGet<{
    items: {
      id: string
      name: string
      images: { url: string }[]
      popularity: number
    }[]
  }>(`/me/top/artists?time_range=${timeRange}&limit=${limit}`)

  return data.items.map(a => ({
    id: a.id,
    name: a.name,
    imageUrl: a.images?.[0]?.url || '',
    popularity: a.popularity,
  }))
}

export async function getArtistAlbums(artistId: string): Promise<SpotifyAlbum[]> {
  const albums: SpotifyAlbum[] = []
  let offset = 0
  const limit = 10

  while (true) {
    const data = await spotifyGet<SpotifyPaginatedResponse<{
      id: string
      name: string
      artists: { name: string }[]
      total_tracks: number
      images: { url: string }[]
      album_group: string
      album_type: string
    }>>(`/artists/${artistId}/albums?include_groups=album,single&limit=${limit}&offset=${offset}`)

    for (const a of data.items) {
      if (!a?.id) continue
      albums.push({
        id: a.id,
        name: a.name,
        artist: a.artists.map(x => x.name).join(', '),
        trackCount: a.total_tracks,
        imageUrl: a.images?.[0]?.url || '',
      })
    }

    if (!data.next) break
    offset += limit
  }

  return albums
}
