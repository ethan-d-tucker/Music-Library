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
- `MUSIC_DIR` defaults to `~/Music/library`
- Server runs on port 3001 by default
- External binaries: yt-dlp, ffmpeg, deno (auto-discovered from WinGet paths on Windows)
- Server serves built client (`client/dist`) as static files, so port 3001 serves both API and SPA
- Remote access to app at `https://library.localmusicoklahoma.store` via Cloudflare Tunnel
- After client changes, run `cd client && npm run build` to update the production build served on port 3001

## Navidrome (Streaming Server)

- **Navidrome v0.60.3** installed at `C:\Navidrome`, config at `C:\Navidrome\navidrome.toml`
- Serves the same `~/Music/library` folder — new downloads appear automatically
- Accessible locally at `http://localhost:4533`
- Accessible remotely at `https://music.localmusicoklahoma.store` via Cloudflare Tunnel
- Tunnel config at `C:\Users\Ethan\.cloudflared\config.yml` (tunnel ID: `7715b97c-97fc-4084-9e4c-c3f22f81f926`)
- Phone access via Subsonic-compatible apps (Amperfy on iOS)
- Spotify integration enabled in Navidrome config for artist images (uses same credentials as music library app)
- Deezer also enabled by default as fallback artist image source (no config needed)
- Both Navidrome and cloudflared currently run as background processes (not yet Windows services)

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

## Conventions

- TypeScript strict, ESM (`"type": "module"`)
- Server imports use `.js` extensions (ESM convention)
- Validation with Zod
- CSS uses CSS custom properties (`var(--color-*)`) for theming
- Mobile layout uses `viewport-fit=cover` + `env(safe-area-inset-bottom)` for iOS home bar spacing
- No test framework currently configured
