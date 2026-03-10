// Typed API wrappers

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('authToken')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = { ...getAuthHeaders(), ...options?.headers }
  const res = await fetch(url, { ...options, headers })
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

// --- Deezer ---

export interface DeezerResult {
  id: number
  title: string
  artist: string
  album: string
  duration: number // seconds
  albumCoverUrl: string
  preview: string
}

export function searchDeezer(query: string) {
  return post<{ results: DeezerResult[] }>('/api/download/search-deezer', { query })
}

export function downloadDeezerTrack(track: DeezerResult) {
  return post<{ success: boolean; track: TrackRow; skipped?: boolean }>('/api/download/deezer', track)
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

// --- Download Management ---

export function getPendingDownloads() {
  return request<{ tracks: TrackRow[] }>('/api/download/pending')
}

export function getFailedDownloads() {
  return request<{ tracks: TrackRow[] }>('/api/download/failed')
}

export function cancelPendingTrack(id: number) {
  return request<{ success: boolean }>(`/api/download/pending/${id}`, { method: 'DELETE' })
}

export function cancelAllPending() {
  return request<{ success: boolean; cancelled: number }>('/api/download/pending', { method: 'DELETE' })
}

export function retryFailedDownloads() {
  return post<{ success: boolean; retried: number }>('/api/download/retry-failed', {})
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

export function createPlaylist(name: string, description?: string) {
  return post<{ id: number }>('/api/playlists', { name, description })
}

export function renamePlaylist(id: number, name: string, description?: string) {
  return request<{ success: boolean }>(`/api/playlists/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  })
}

export function addTrackToPlaylist(playlistId: number, trackId: number) {
  return post<{ success: boolean }>(`/api/playlists/${playlistId}/tracks`, { trackId })
}

export function removeTrackFromPlaylist(playlistId: number, trackId: number) {
  return request<{ success: boolean }>(`/api/playlists/${playlistId}/tracks/${trackId}`, { method: 'DELETE' })
}

export function reorderPlaylistTracks(playlistId: number, trackIds: number[]) {
  return request<{ success: boolean }>(`/api/playlists/${playlistId}/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackIds }),
  })
}

// --- Lyrics ---

export function getTrackLyrics(id: number) {
  return request<{ plain: string; synced: string }>(`/api/library/tracks/${id}/lyrics`)
}

// --- Track Editing ---

export function updateTrackMetadata(id: number, fields: {
  title?: string; artist?: string; album?: string; album_artist?: string
  track_number?: number; year?: number
}) {
  return request<{ success: boolean; track: TrackRow }>(`/api/library/tracks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
}

export async function uploadTrackArt(id: number, file: File) {
  const form = new FormData()
  form.append('art', file)
  const headers = getAuthHeaders()
  const res = await fetch(`/api/library/tracks/${id}/art`, { method: 'PUT', body: form, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as { error?: string }).error || res.statusText)
  }
  return res.json() as Promise<{ success: boolean; track: TrackRow }>
}

// --- Auth ---

export interface AuthUserResponse {
  id: number
  username: string
  displayName: string
}

export function getUsers() {
  return request<{ users: { id: number; username: string; display_name: string }[] }>('/api/auth/users')
}

export function login(username: string, pin: string) {
  return post<{ token: string; user: AuthUserResponse }>('/api/auth/login', { username, pin })
}

export function register(username: string, displayName: string, pin: string) {
  return post<{ token: string; user: AuthUserResponse }>('/api/auth/register', { username, displayName, pin })
}

export function getMe() {
  return request<{ user: AuthUserResponse }>('/api/auth/me')
}

export function logout() {
  return post<{ success: boolean }>('/api/auth/logout', {})
}

// --- Play History ---

export function recordPlay(trackId: number) {
  return post<{ success: boolean }>('/api/library/play-history', { trackId })
}

export function getPlayHistory() {
  return request<{ tracks: TrackRow[] }>('/api/library/play-history')
}

// --- Homepage ---

export function getHomeData() {
  return request<{
    recentlyPlayed: TrackRow[]
    topArtists: { artist: string; play_count: number }[]
    randomAlbums: { album: string; artist: string; album_art_url: string }[]
  }>('/api/library/home')
}
