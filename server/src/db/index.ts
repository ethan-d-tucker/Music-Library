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
  // If upsert matched existing row, return that row's id
  if (result.changes === 0) {
    const row = db.prepare('SELECT id FROM tracks WHERE spotify_id = ?').get(track.spotify_id) as { id: number }
    return row.id
  }
  return Number(result.lastInsertRowid)
}

export function updateTrackStatus(id: number, status: string, extra?: { file_path?: string; youtube_id?: string; error_message?: string }): void {
  const sets = ['download_status = ?', "updated_at = datetime('now')"]
  const params: (string | number)[] = [status]

  if (extra?.file_path !== undefined) { sets.push('file_path = ?'); params.push(extra.file_path) }
  if (extra?.youtube_id !== undefined) { sets.push('youtube_id = ?'); params.push(extra.youtube_id) }
  if (extra?.error_message !== undefined) { sets.push('error_message = ?'); params.push(extra.error_message) }

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

export function insertPlaylist(playlist: { name: string; description?: string; spotify_id?: string }): number {
  const result = db.prepare(`
    INSERT INTO playlists (name, description, spotify_id)
    VALUES (@name, @description, @spotify_id)
    ON CONFLICT(spotify_id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      updated_at = datetime('now')
  `).run({
    name: playlist.name,
    description: playlist.description || '',
    spotify_id: playlist.spotify_id || null,
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

export function addTrackToPlaylist(playlistId: number, trackId: number, position: number): void {
  db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)')
    .run(playlistId, trackId, position)
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
