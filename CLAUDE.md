# Music Library

A local music library manager that downloads tracks via yt-dlp and organizes them with Spotify metadata.

## Architecture

Monorepo with two packages:

- **`server/`** — Express 5 API (TypeScript, tsx watch). SQLite via better-sqlite3. Handles Spotify metadata, yt-dlp downloads, file tagging (node-id3), M3U playlist generation, and library organization.
- **`client/`** — React 19 SPA (TypeScript, Vite, Tailwind v4). State managed with Zustand. Pages: library browser (artists/albums/songs tabs in sidebar), import, search, downloads, playlists.

## Commands

```bash
npm run dev          # Start both client and server (concurrently)
npm run dev:client   # Vite dev server only
npm run dev:server   # Express API only (tsx watch)
cd client && npm run build  # Production build
```

## Key Paths

- `server/src/config.ts` — Environment config, binary discovery (yt-dlp, ffmpeg, deno)
- `server/src/db/schema.ts` — SQLite schema (tracks, playlists, playlist_tracks, config)
- `server/src/routes/` — API routes (library, playlists, spotify, download)
- `server/src/services/` — Business logic (organizer, tagger, lyrics, m3u)
- `server/src/services/normalizer.ts` — Tag reading/writing (FLAC via ffmpeg, MP3 via node-id3), artist name normalization, path-based metadata parsing
- `client/src/lib/store.ts` — Zustand store (page nav, library tab, selections)
- `client/src/lib/api.ts` — Typed API wrappers for all server endpoints
- `client/src/components/Layout.tsx` — Shell layout with sidebar nav (library sub-tabs rendered here)
- `client/src/components/LibraryBrowser.tsx` — Library views (ArtistsView, AlbumsView, SongsView)
- `client/src/components/ImportPage.tsx` — Spotify import with search, auto-download on import, full-page progress view
- `client/src/components/PlaylistsPage.tsx` — Playlist management and batch downloads
- `client/src/components/SearchPage.tsx` — YouTube search (videos + playlists) and manual download
- `client/src/components/DownloadsPage.tsx` — Download queue and progress tracking

## Environment

- Requires `.env` at project root with `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`
- `MUSIC_DIR` set to `D:/library` (external drive) via `.env`
- Server runs on port 3001 by default
- External binaries: yt-dlp, ffmpeg, deno (auto-discovered from WinGet paths on Windows)
- Server serves built client (`client/dist`) as static files, so port 3001 serves both API and SPA
- Remote access to app at `https://library.localmusicoklahoma.store` via Cloudflare Tunnel
- After client changes, run `cd client && npm run build` to update the production build served on port 3001

## Deployment

- **Dev machine** (desktop): code changes only, push to git
- **Server machine** (old laptop): runs all services, music on external D: drive at `D:\library`
- Deploy workflow: push from dev → `git pull` + `cd client && npm run build` + `nssm restart MusicLibrary` on server
- All services run as Windows services via NSSM (auto-start on boot)

## Navidrome (Streaming Server)

- **Navidrome v0.60.3** installed at `C:\Navidrome`, config at `C:\Navidrome\navidrome.toml`
- Serves the music library folder (`MUSIC_DIR`) — new downloads appear automatically
- Accessible locally at `http://localhost:4533`
- Accessible remotely at `https://music.localmusicoklahoma.store` via Cloudflare Tunnel
- Tunnel config at `~/.cloudflared/config.yml`
- Phone access via Subsonic-compatible apps (Amperfy on iOS)
- Spotify integration enabled in Navidrome config for artist images (uses same credentials as music library app)
- Deezer also enabled by default as fallback artist image source (no config needed)
- Navidrome, cloudflared, and MusicLibrary app all run as Windows services via NSSM

## Key Behaviors

- Importing from Spotify automatically triggers batch download of all pending tracks
- After import, UI switches to a full-page download progress view (replaces selection UI)
- Batch downloads use SSE (`/api/download/progress/:jobId`) for real-time progress
- YouTube search returns both individual videos and playlist/album results in parallel
- YouTube matching uses a 3-pass search with scoring (prefers Topic channels, matches duration)
- Import page has Spotify search (albums + playlists) in addition to browsing saved library
- 1.5s delay between downloads to avoid YouTube throttling
- Compilation albums (various artists) use `album_artist` for folder organization and ID3 TPE2 tag
- File organization: `{album_artist or first artist}/{album}/{tracknum title}.mp3`
- Lyrics fetched from LRCLIB (free, no API key) during download and backfill
- Plain lyrics embedded as ID3 USLT tags; synced lyrics written as `.lrc` sidecar files
- Live/bonus/demo track titles are cleaned to match studio lyrics (fallback search)
- Backfill endpoint: `POST /api/library/backfill-lyrics` with SSE progress at `GET /api/library/backfill-lyrics/:jobId`

## Library Hygiene Rules

- **Avoid Spotify API when possible** — use MusicBrainz for metadata, Cover Art Archive for album art. Spotify rate limits aggressively (~20hr bans).
- **Artist folder names must be clean** — no format tags (`[FLAC]`, `[24-96]`), no year ranges, no source names (`vtwin88cube`). Just the artist name.
- **Album folder names must be clean** — no format/bitrate tags, no `Artist-Album-Format-Year` scene naming. Just the album title.
- **Artist credits must use proper separators** — MusicBrainz `joinphrase` field contains the separator (` & `, `, `, etc.). Never concatenate artist names without it.
- **Import scripts have no track cap** — previously 2000, removed since library is on external storage. Round-robin across artists to ensure variety.
- **Only import studio albums by default** — filter out compilations, live albums, remixes, soundtracks, demos (MusicBrainz `secondary-types`).
- **Scan script** at `server/scripts/scan-library.ts` checks for: mangled names, missing art, temp files, duplicates, empty folders. Run periodically.
- **Import script** at `server/scripts/top-music.ts` uses MusicBrainz (not Spotify) to import configured artists. Edit the `ARTISTS` array to add/remove.
- **Cleanup script** at `server/scripts/cleanup-library.ts` — comprehensive library cleanup: fix concatenated names, consolidate variant folders, fetch cover art, embed art into MP3 tags, backfill DB album_art_url. Supports `--execute`, `--fetch-art`, `--embed-art`, `--fix-db-art`, `--navidrome-check`.
- **FLAC tag writing** uses `-map_metadata -1` to clear all existing metadata before writing fresh values (prevents multi-value accumulation in Vorbis Comments).
- **FLAC ALBUMARTIST tag** can be stored as `ALBUMARTIST`, `ALBUM_ARTIST`, or `ALBUM ARTIST` (with space). `readFlacTags` checks all variants.
- **Playlist generation** at `server/scripts/generate-playlists.ts` — auto-generates playlists by clustering similar artists, shuffles with album-spread logic, writes M3U files for Navidrome. Use `--regenerate` to recreate.
- **CSV playlist import** at `server/scripts/import-csv-playlists.ts` — imports Exportify CSV files as playlists with track data. Usage: `npx tsx scripts/import-csv-playlists.ts ~/Downloads/*.csv`
- **Spotify mix import** at `server/scripts/import-spotify-mixes.ts` — imports Spotify playlists matching mix/radio patterns. Note: Spotify blocks playlist track fetches in Development Mode; use Exportify CSVs as workaround.

## Spotify API Limitations

- Spotify app is in "Development Mode" — the `/playlists/{id}/tracks` endpoint returns 403 Forbidden
- Listing playlists (`/me/playlists`) and liked songs (`/me/tracks`) still work
- Workaround: use [Exportify](https://exportify.net) to export playlists as CSV, then import with `import-csv-playlists.ts`
- To fix permanently: request "Extended Quota Mode" in the Spotify Developer Dashboard

## Conventions

- TypeScript strict, ESM (`"type": "module"`)
- Server imports use `.js` extensions (ESM convention)
- Validation with Zod
- CSS uses CSS custom properties (`var(--color-*)`) for theming
- Mobile layout uses `viewport-fit=cover` + `env(safe-area-inset-bottom)` for iOS home bar spacing
- No test framework currently configured
