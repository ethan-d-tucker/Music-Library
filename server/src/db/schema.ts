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
}
