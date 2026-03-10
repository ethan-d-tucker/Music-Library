import type Database from 'better-sqlite3'

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      title           TEXT NOT NULL,
      artist          TEXT NOT NULL,
      album           TEXT DEFAULT '',
      album_artist    TEXT DEFAULT '',
      track_number    INTEGER DEFAULT 0,
      disc_number     INTEGER DEFAULT 1,
      duration_ms     INTEGER DEFAULT 0,
      file_path       TEXT DEFAULT '',
      spotify_id      TEXT UNIQUE,
      youtube_id      TEXT DEFAULT '',
      album_art_url   TEXT DEFAULT '',
      download_status TEXT DEFAULT 'pending',
      error_message   TEXT DEFAULT '',
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      description     TEXT DEFAULT '',
      spotify_id      TEXT UNIQUE,
      m3u_path        TEXT DEFAULT '',
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id     INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
      track_id        INTEGER REFERENCES tracks(id) ON DELETE CASCADE,
      position        INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, track_id)
    );

    CREATE TABLE IF NOT EXISTS config (
      key             TEXT PRIMARY KEY,
      value           TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_spotify_id ON tracks(spotify_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
    CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(artist, album);
    CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(download_status);
  `)

  // Migration: add lyrics columns
  const cols = db.pragma('table_info(tracks)') as { name: string }[]
  const colNames = new Set(cols.map(c => c.name))
  if (!colNames.has('lyrics_plain')) {
    db.exec("ALTER TABLE tracks ADD COLUMN lyrics_plain TEXT DEFAULT ''")
  }
  if (!colNames.has('lyrics_synced')) {
    db.exec("ALTER TABLE tracks ADD COLUMN lyrics_synced TEXT DEFAULT ''")
  }
  if (!colNames.has('lyrics_status')) {
    db.exec("ALTER TABLE tracks ADD COLUMN lyrics_status TEXT DEFAULT ''")
  }

  // Migration: add Deezer and format columns
  if (!colNames.has('deezer_id')) {
    db.exec("ALTER TABLE tracks ADD COLUMN deezer_id TEXT DEFAULT ''")
  }
  if (!colNames.has('format')) {
    db.exec("ALTER TABLE tracks ADD COLUMN format TEXT DEFAULT 'mp3'")
  }

  // Migration: add year column
  if (!colNames.has('year')) {
    db.exec("ALTER TABLE tracks ADD COLUMN year INTEGER DEFAULT 0")
  }

  // Migration: users and auth tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      username        TEXT NOT NULL UNIQUE,
      display_name    TEXT NOT NULL,
      pin_hash        TEXT NOT NULL,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token           TEXT PRIMARY KEY,
      user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at      TEXT DEFAULT (datetime('now')),
      expires_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS play_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
      track_id        INTEGER REFERENCES tracks(id) ON DELETE CASCADE,
      played_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_play_history_user ON play_history(user_id, played_at DESC);
  `)

  // Migration: add user_id to playlists
  const playlistCols = db.pragma('table_info(playlists)') as { name: string }[]
  const playlistColNames = new Set(playlistCols.map(c => c.name))
  if (!playlistColNames.has('user_id')) {
    db.exec("ALTER TABLE playlists ADD COLUMN user_id INTEGER DEFAULT NULL")
  }
}
