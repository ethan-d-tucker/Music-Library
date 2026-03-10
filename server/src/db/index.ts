import Database from 'better-sqlite3'
import path from 'path'
import { MUSIC_DIR } from '../config.js'
import { initSchema } from './schema.js'

const dbPath = path.join(MUSIC_DIR, 'library.db')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
initSchema(db)

export default db

// --- Config helpers ---

export function getConfig(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function setConfig(key: string, value: string): void {
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

// --- Track helpers ---

export interface TrackRow {
  id: number
  title: string
  artist: string
  album: string
  album_artist: string
  track_number: number
  disc_number: number
  duration_ms: number
  file_path: string
  spotify_id: string | null
  youtube_id: string
  album_art_url: string
  download_status: string
  error_message: string
  lyrics_plain: string
  lyrics_synced: string
  lyrics_status: string
  created_at: string
  updated_at: string
}

export function insertTrack(track: {
  title: string
  artist: string
  album?: string
  album_artist?: string
  track_number?: number
  disc_number?: number
  duration_ms?: number
  spotify_id?: string
  album_art_url?: string
}): number {
  const result = db.prepare(`
    INSERT INTO tracks (title, artist, album, album_artist, track_number, disc_number, duration_ms, spotify_id, album_art_url)
    VALUES (@title, @artist, @album, @album_artist, @track_number, @disc_number, @duration_ms, @spotify_id, @album_art_url)
    ON CONFLICT(spotify_id) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      album = excluded.album,
      album_artist = excluded.album_artist,
      track_number = excluded.track_number,
      duration_ms = excluded.duration_ms,
      album_art_url = excluded.album_art_url,
      updated_at = datetime('now')
  `).run({
    title: track.title,
    artist: track.artist,
    album: track.album || '',
    album_artist: track.album_artist || '',
    track_number: track.track_number || 0,
    disc_number: track.disc_number || 1,
    duration_ms: track.duration_ms || 0,
    spotify_id: track.spotify_id || null,
    album_art_url: track.album_art_url || '',
  })
  // If upsert matched existing row via spotify_id, lastInsertRowid is unreliable — look up the actual ID
  if (track.spotify_id) {
    const row = db.prepare('SELECT id FROM tracks WHERE spotify_id = ?').get(track.spotify_id) as { id: number } | undefined
    if (row) return row.id
  }
  return Number(result.lastInsertRowid)
}

export function updateTrackStatus(id: number, status: string, extra?: { file_path?: string; youtube_id?: string; error_message?: string; deezer_id?: string; format?: string; album_art_url?: string }): void {
  const sets = ['download_status = ?', "updated_at = datetime('now')"]
  const params: (string | number)[] = [status]

  if (extra?.file_path !== undefined) { sets.push('file_path = ?'); params.push(extra.file_path) }
  if (extra?.youtube_id !== undefined) { sets.push('youtube_id = ?'); params.push(extra.youtube_id) }
  if (extra?.error_message !== undefined) { sets.push('error_message = ?'); params.push(extra.error_message) }
  if (extra?.deezer_id !== undefined) { sets.push('deezer_id = ?'); params.push(extra.deezer_id) }
  if (extra?.format !== undefined) { sets.push('format = ?'); params.push(extra.format) }
  if (extra?.album_art_url !== undefined) { sets.push('album_art_url = ?'); params.push(extra.album_art_url) }

  params.push(id)
  db.prepare(`UPDATE tracks SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function updateTrackMetadata(id: number, fields: {
  title?: string; artist?: string; album?: string; album_artist?: string;
  track_number?: number; year?: number; album_art_url?: string; file_path?: string
}): void {
  const sets: string[] = ["updated_at = datetime('now')"]
  const params: (string | number)[] = []

  if (fields.title !== undefined) { sets.push('title = ?'); params.push(fields.title) }
  if (fields.artist !== undefined) { sets.push('artist = ?'); params.push(fields.artist) }
  if (fields.album !== undefined) { sets.push('album = ?'); params.push(fields.album) }
  if (fields.album_artist !== undefined) { sets.push('album_artist = ?'); params.push(fields.album_artist) }
  if (fields.track_number !== undefined) { sets.push('track_number = ?'); params.push(fields.track_number) }
  if (fields.year !== undefined) { sets.push('year = ?'); params.push(fields.year) }
  if (fields.album_art_url !== undefined) { sets.push('album_art_url = ?'); params.push(fields.album_art_url) }
  if (fields.file_path !== undefined) { sets.push('file_path = ?'); params.push(fields.file_path) }

  if (sets.length === 1) return // Only the updated_at, nothing to update

  params.push(id)
  db.prepare(`UPDATE tracks SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function getTrackById(id: number): TrackRow | undefined {
  return db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow | undefined
}

export function getTrackBySpotifyId(spotifyId: string): TrackRow | undefined {
  return db.prepare('SELECT * FROM tracks WHERE spotify_id = ?').get(spotifyId) as TrackRow | undefined
}

export function getPendingTracks(): TrackRow[] {
  return db.prepare("SELECT * FROM tracks WHERE download_status = 'pending' ORDER BY id").all() as TrackRow[]
}

export function cancelPendingTrack(id: number): boolean {
  const result = db.prepare("DELETE FROM tracks WHERE id = ? AND download_status = 'pending'").run(id)
  return result.changes > 0
}

export function cancelAllPendingTracks(): number {
  const result = db.prepare("DELETE FROM tracks WHERE download_status = 'pending'").run()
  return result.changes
}

export function retryFailedTracks(): number {
  const result = db.prepare("UPDATE tracks SET download_status = 'pending', error_message = '' WHERE download_status = 'failed'").run()
  return result.changes
}

export function getTracksByStatus(status: string): TrackRow[] {
  return db.prepare('SELECT * FROM tracks WHERE download_status = ? ORDER BY artist, album, track_number').all(status) as TrackRow[]
}

export function searchTracks(query: string): TrackRow[] {
  const pattern = `%${query}%`
  return db.prepare('SELECT * FROM tracks WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? ORDER BY artist, album, track_number')
    .all(pattern, pattern, pattern) as TrackRow[]
}

export function getAllArtists(): { artist: string; track_count: number }[] {
  return db.prepare("SELECT COALESCE(NULLIF(album_artist, ''), artist) as artist, COUNT(*) as track_count FROM tracks GROUP BY COALESCE(NULLIF(album_artist, ''), artist) ORDER BY artist COLLATE NOCASE")
    .all() as { artist: string; track_count: number }[]
}

export function getAllAlbums(query?: string): { album: string; artist: string; track_count: number; album_art_url: string }[] {
  if (query) {
    const pattern = `%${query}%`
    return db.prepare(`
      SELECT album, COALESCE(NULLIF(album_artist, ''), artist) as artist, COUNT(*) as track_count, MAX(album_art_url) as album_art_url
      FROM tracks
      WHERE album != '' AND (album LIKE ? OR artist LIKE ? OR album_artist LIKE ?)
      GROUP BY COALESCE(NULLIF(album_artist, ''), artist), album
      ORDER BY album COLLATE NOCASE, artist
    `).all(pattern, pattern, pattern) as { album: string; artist: string; track_count: number; album_art_url: string }[]
  }
  return db.prepare(`
    SELECT album, COALESCE(NULLIF(album_artist, ''), artist) as artist, COUNT(*) as track_count, MAX(album_art_url) as album_art_url
    FROM tracks
    WHERE album != ''
    GROUP BY COALESCE(NULLIF(album_artist, ''), artist), album
    ORDER BY album COLLATE NOCASE, artist
  `).all() as { album: string; artist: string; track_count: number; album_art_url: string }[]
}

export function getAlbumsByArtist(artist: string): { album: string; track_count: number; album_art_url: string }[] {
  return db.prepare("SELECT album, COUNT(*) as track_count, MAX(album_art_url) as album_art_url FROM tracks WHERE COALESCE(NULLIF(album_artist, ''), artist) = ? GROUP BY album ORDER BY album")
    .all(artist) as { album: string; track_count: number; album_art_url: string }[]
}

export function getAlbumTracks(artist: string, album: string): TrackRow[] {
  return db.prepare("SELECT * FROM tracks WHERE COALESCE(NULLIF(album_artist, ''), artist) = ? AND album = ? ORDER BY disc_number, track_number")
    .all(artist, album) as TrackRow[]
}

// --- Playlist helpers ---

export interface PlaylistRow {
  id: number
  name: string
  description: string
  spotify_id: string | null
  m3u_path: string
  created_at: string
  updated_at: string
}

export function insertPlaylist(playlist: { name: string; description?: string; spotify_id?: string; user_id?: number }): number {
  const result = db.prepare(`
    INSERT INTO playlists (name, description, spotify_id, user_id)
    VALUES (@name, @description, @spotify_id, @user_id)
    ON CONFLICT(spotify_id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      updated_at = datetime('now')
  `).run({
    name: playlist.name,
    description: playlist.description || '',
    spotify_id: playlist.spotify_id || null,
    user_id: playlist.user_id ?? null,
  })
  if (result.changes === 0) {
    const row = db.prepare('SELECT id FROM playlists WHERE spotify_id = ?').get(playlist.spotify_id) as { id: number }
    return row.id
  }
  return Number(result.lastInsertRowid)
}

export function getAllPlaylists(): PlaylistRow[] {
  return db.prepare('SELECT * FROM playlists ORDER BY name').all() as PlaylistRow[]
}

export function getPlaylistById(id: number): PlaylistRow | undefined {
  return db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as PlaylistRow | undefined
}

export function getPlaylistTracks(playlistId: number): TrackRow[] {
  return db.prepare(`
    SELECT t.* FROM tracks t
    JOIN playlist_tracks pt ON pt.track_id = t.id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position
  `).all(playlistId) as TrackRow[]
}

export function addTrackToPlaylist(playlistId: number, trackId: number, position?: number): void {
  const pos = position ?? getNextPlaylistPosition(playlistId)
  db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)')
    .run(playlistId, trackId, pos)
}

export function getNextPlaylistPosition(playlistId: number): number {
  const row = db.prepare('SELECT MAX(position) as maxPos FROM playlist_tracks WHERE playlist_id = ?').get(playlistId) as { maxPos: number | null }
  return (row.maxPos ?? -1) + 1
}

export function removeTrackFromPlaylist(playlistId: number, trackId: number): void {
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(playlistId, trackId)
  // Re-number positions
  const tracks = db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all(playlistId) as { track_id: number }[]
  const update = db.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?')
  const txn = db.transaction(() => {
    tracks.forEach((t, i) => update.run(i, playlistId, t.track_id))
  })
  txn()
}

export function reorderPlaylistTracks(playlistId: number, trackIds: number[]): void {
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId)
    const insert = db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)')
    trackIds.forEach((trackId, i) => insert.run(playlistId, trackId, i))
  })
  txn()
}

export function updatePlaylist(id: number, fields: { name?: string; description?: string }): void {
  const sets: string[] = ["updated_at = datetime('now')"]
  const params: (string | number)[] = []
  if (fields.name !== undefined) { sets.push('name = ?'); params.push(fields.name) }
  if (fields.description !== undefined) { sets.push('description = ?'); params.push(fields.description) }
  if (sets.length === 1) return
  params.push(id)
  db.prepare(`UPDATE playlists SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function updateTrackLyrics(id: number, plain: string, synced: string, status: string): void {
  db.prepare("UPDATE tracks SET lyrics_plain = ?, lyrics_synced = ?, lyrics_status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(plain, synced, status, id)
}

export function getTracksNeedingLyrics(): TrackRow[] {
  return db.prepare("SELECT * FROM tracks WHERE download_status = 'complete' AND lyrics_status = '' ORDER BY artist, album, track_number")
    .all() as TrackRow[]
}

export function getLibraryStats(): { tracks: number; artists: number; albums: number; downloaded: number; pending: number; failed: number } {
  const total = (db.prepare('SELECT COUNT(*) as c FROM tracks').get() as { c: number }).c
  const artists = (db.prepare("SELECT COUNT(DISTINCT artist) as c FROM tracks WHERE download_status = 'complete'").get() as { c: number }).c
  const albums = (db.prepare("SELECT COUNT(DISTINCT COALESCE(NULLIF(album_artist, ''), artist) || '|||' || album) as c FROM tracks WHERE download_status = 'complete'").get() as { c: number }).c
  const downloaded = (db.prepare("SELECT COUNT(*) as c FROM tracks WHERE download_status = 'complete'").get() as { c: number }).c
  const pending = (db.prepare("SELECT COUNT(*) as c FROM tracks WHERE download_status = 'pending'").get() as { c: number }).c
  const failed = (db.prepare("SELECT COUNT(*) as c FROM tracks WHERE download_status = 'failed'").get() as { c: number }).c
  return { tracks: total, artists, albums, downloaded, pending, failed }
}

// --- User helpers ---

export interface UserRow {
  id: number
  username: string
  display_name: string
  pin_hash: string
  created_at: string
}

export function createUser(username: string, displayName: string, pinHash: string): number {
  const result = db.prepare('INSERT INTO users (username, display_name, pin_hash) VALUES (?, ?, ?)').run(username, displayName, pinHash)
  return Number(result.lastInsertRowid)
}

export function getUserByUsername(username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
}

export function getUserById(id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
}

export function getAllUsers(): { id: number; username: string; display_name: string }[] {
  return db.prepare('SELECT id, username, display_name FROM users ORDER BY username').all() as { id: number; username: string; display_name: string }[]
}

// --- Session helpers ---

export function createSession(userId: number, token: string): void {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt)
}

export function getSession(token: string): { user_id: number; expires_at: string } | undefined {
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token) as { user_id: number; expires_at: string } | undefined
  if (!row) return undefined
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return undefined
  }
  return row
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

// --- Play history helpers ---

export function recordPlay(userId: number, trackId: number): void {
  db.prepare('INSERT INTO play_history (user_id, track_id) VALUES (?, ?)').run(userId, trackId)
  // Cap at 1000 entries per user
  db.prepare(`
    DELETE FROM play_history WHERE id IN (
      SELECT id FROM play_history WHERE user_id = ?
      ORDER BY played_at DESC LIMIT -1 OFFSET 1000
    )
  `).run(userId)
}

export function getRecentlyPlayed(userId: number, limit = 20): TrackRow[] {
  return db.prepare(`
    SELECT t.* FROM tracks t
    JOIN (
      SELECT track_id, MAX(played_at) as last_played
      FROM play_history WHERE user_id = ?
      GROUP BY track_id
      ORDER BY last_played DESC
      LIMIT ?
    ) ph ON ph.track_id = t.id
    ORDER BY ph.last_played DESC
  `).all(userId, limit) as TrackRow[]
}

export function getTopArtists(userId: number, limit = 10): { artist: string; play_count: number }[] {
  return db.prepare(`
    SELECT t.artist, COUNT(*) as play_count
    FROM play_history ph
    JOIN tracks t ON t.id = ph.track_id
    WHERE ph.user_id = ?
    GROUP BY t.artist
    ORDER BY play_count DESC
    LIMIT ?
  `).all(userId, limit) as { artist: string; play_count: number }[]
}

export function getRandomAlbums(limit = 6): { album: string; artist: string; album_art_url: string }[] {
  return db.prepare(`
    SELECT album, COALESCE(NULLIF(album_artist, ''), artist) as artist, MAX(album_art_url) as album_art_url
    FROM tracks
    WHERE album != '' AND download_status = 'complete'
    GROUP BY COALESCE(NULLIF(album_artist, ''), artist), album
    ORDER BY RANDOM()
    LIMIT ?
  `).all(limit) as { album: string; artist: string; album_art_url: string }[]
}

// --- Playlist with user ownership ---

export function getUserPlaylists(userId: number): PlaylistRow[] {
  return db.prepare('SELECT * FROM playlists WHERE user_id = ? OR user_id IS NULL ORDER BY name').all(userId) as PlaylistRow[]
}
