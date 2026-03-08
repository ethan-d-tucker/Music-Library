// Typed API wrappers

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as { error?: string }).error || res.statusText)
  }
  return res.json() as Promise<T>
}

function post<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// --- Spotify ---

export interface SpotifyPlaylist {
  id: string
  name: string
  description: string
  trackCount: number
  imageUrl: string
}

export function getSpotifyStatus() {
  return request<{ connected: boolean }>('/api/spotify/status')
}

export function getSpotifyAuthUrl() {
  return request<{ url: string }>(`/api/spotify/auth?origin=${encodeURIComponent(window.location.origin)}`)
}

export function getSpotifyPlaylists() {
  return request<{ playlists: SpotifyPlaylist[] }>('/api/spotify/playlists')
}

export interface SpotifyAlbum {
  id: string
  name: string
  artist: string
  trackCount: number
  imageUrl: string
}

export function getSpotifyAlbums() {
  return request<{ albums: SpotifyAlbum[] }>('/api/spotify/albums')
}

export function getLikedSongsCount() {
  return request<{ count: number }>('/api/spotify/liked-songs/count')
}

export function importSpotifyPlaylists(playlistIds: string[]) {
  return post<{ success: boolean; results: ImportResult[] }>(
    '/api/spotify/import',
    { playlistIds }
  )
}

export function importSpotifyAlbums(albumIds: string[]) {
  return post<{ success: boolean; results: ImportResult[] }>(
    '/api/spotify/import-albums',
    { albumIds }
  )
}

export function importLikedSongs() {
  return post<{ success: boolean; results: ImportResult[] }>(
    '/api/spotify/import-liked',
    {}
  )
}

export function searchSpotify(query: string) {
  return request<{ albums: SpotifyAlbum[]; playlists: SpotifyPlaylist[] }>(
    `/api/spotify/search?q=${encodeURIComponent(query)}`
  )
}

export interface ImportResult {
  name: string
  tracksImported: number
}

// --- Download ---

export interface SearchResult {
  id: string
  title: string
  channel: string
  duration: number
  durationFormatted: string
  url: string
  thumbnail: string
}

export function searchYouTube(query: string) {
  return post<{ results: SearchResult[] }>('/api/download/search', { query })
}

export interface PlaylistSearchResult {
  id: string
  title: string
  url: string
  thumbnail: string
}

export function searchYouTubePlaylists(query: string) {
  return post<{ playlists: PlaylistSearchResult[] }>('/api/download/search-playlists', { query })
}

export function expandPlaylist(url: string) {
  return post<{ title: string; tracks: SearchResult[] }>('/api/download/playlist', { url })
}

export function downloadTrack(trackId: number) {
  return post<{ success: boolean }>(`/api/download/track/${trackId}`, {})
}

export function downloadFromUrl(url: string, title: string, artist: string, album?: string) {
  return post<{ success: boolean; track: TrackRow }>('/api/download/url', { url, title, artist, album })
}

export function startBatchDownload(trackIds?: number[]) {
  return post<{ jobId: string; total: number }>('/api/download/batch', { trackIds })
}

// --- Library ---

export interface TrackRow {
  id: number
  title: string
  artist: string
  album: string
  album_artist: string
  track_number: number
  duration_ms: number
  file_path: string
  spotify_id: string | null
  youtube_id: string
  album_art_url: string
  download_status: string
  error_message: string
}

export interface LibraryStats {
  tracks: number
  artists: number
  albums: number
  downloaded: number
  pending: number
  failed: number
}

export function getLibraryStats() {
  return request<LibraryStats>('/api/library/stats')
}

export function getArtists() {
  return request<{ artists: { artist: string; track_count: number }[] }>('/api/library/artists')
}

export function getAllLibraryAlbums(query?: string) {
  const params = query ? `?q=${encodeURIComponent(query)}` : ''
  return request<{ albums: { album: string; artist: string; track_count: number; album_art_url: string }[] }>(
    `/api/library/albums${params}`
  )
}

export function getAlbumsByArtist(artist: string) {
  return request<{ albums: { album: string; track_count: number; album_art_url: string }[] }>(
    `/api/library/artists/${encodeURIComponent(artist)}/albums`
  )
}

export function getAlbumTracks(artist: string, album: string) {
  return request<{ tracks: TrackRow[] }>(
    `/api/library/albums/${encodeURIComponent(artist)}/${encodeURIComponent(album)}`
  )
}

export function getAllTracks() {
  return request<{ tracks: TrackRow[] }>('/api/library/tracks')
}

export function searchLibrary(query: string) {
  return request<{ tracks: TrackRow[] }>(`/api/library/tracks?q=${encodeURIComponent(query)}`)
}

export function getTracksByStatus(status: string) {
  return request<{ tracks: TrackRow[] }>(`/api/library/tracks?status=${status}`)
}

// --- Playlists ---

export interface PlaylistWithCount {
  id: number
  name: string
  description: string
  spotify_id: string | null
  trackCount: number
}

export function getPlaylists() {
  return request<{ playlists: PlaylistWithCount[] }>('/api/playlists')
}

export function getPlaylistDetail(id: number) {
  return request<{ playlist: PlaylistWithCount; tracks: TrackRow[] }>(`/api/playlists/${id}`)
}

export function exportPlaylistM3U(id: number) {
  return post<{ success: boolean; m3uPath: string }>(`/api/playlists/${id}/export`, {})
}

export function deletePlaylist(id: number) {
  return request<{ success: boolean }>(`/api/playlists/${id}`, { method: 'DELETE' })
}
