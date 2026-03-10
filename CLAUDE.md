# Music Library

A local music library manager that downloads tracks via yt-dlp and organizes them with Spotify metadata.

## Architecture

Monorepo with two packages:

- **`server/`** — Express 5 API (TypeScript, tsx watch). SQLite via better-sqlite3. Handles Spotify metadata, yt-dlp downloads, file tagging (node-id3), M3U playlist generation, and library organization.
- **`client/`** — React 19 SPA (TypeScript, Vite, Tailwind v4). State managed with Zustand. PWA-installable (manifest.json, service worker). Multi-user auth (PIN-based). Pages: home (recently played, playlists, discover), library browser (artists/albums/songs tabs in sidebar), import, search, downloads, playlists. Built-in music player with now-playing bar, full-screen view, and synced lyrics.

## Commands

```bash
npm run dev          # Start both client and server (concurrently)
npm run dev:client   # Vite dev server only
npm run dev:server   # Express API only (tsx watch)
cd client && npm run build  # Production build
```

## Key Paths

- `server/src/config.ts` — Environment config, binary discovery (yt-dlp, ffmpeg, deno)
- `server/src/db/schema.ts` — SQLite schema (tracks, playlists, playlist_tracks, users, sessions, play_history, config)
- `server/src/routes/` — API routes (auth, library, playlists, spotify, download, stream)
- `server/src/routes/auth.ts` — User registration/login (PIN auth), session management
- `server/src/middleware/auth.ts` — Auth middleware (`authMiddleware` for required, `optionalAuth` for optional)
- `server/src/services/` — Business logic (organizer, tagger, lyrics, m3u)
- `server/src/services/normalizer.ts` — Tag reading/writing (FLAC via ffmpeg, MP3 via node-id3), artist name normalization (exported: `normalizeArtist`, `normalizeArtistSeparators`, `normalizeForSearch`), path-based metadata parsing
- `server/src/routes/stream.ts` — Audio streaming (`GET /api/stream/:trackId` with Range requests) and cover art serving (`GET /api/stream/art/:trackId`)
- `client/src/lib/store.ts` — Zustand store (page nav, library tab, selections)
- `client/src/lib/player.ts` — Zustand player store (singleton `<audio>` element, queue, shuffle, repeat, MediaSession API for iOS lock screen controls)
- `client/src/lib/api.ts` — Typed API wrappers for all server endpoints
- `client/src/components/Layout.tsx` — Shell layout with sidebar nav, now-playing bar, full-screen now-playing overlay
- `client/src/components/LibraryBrowser.tsx` — Spotify-style library views (artist grid with circular avatars, album card grid, album detail page with large art + Play/Shuffle buttons, track list with three-dot context menus)
- `client/src/components/NowPlayingBar.tsx` — Persistent bottom player bar (album art, track info, play/pause, progress, volume)
- `client/src/components/NowPlayingView.tsx` — Full-screen now-playing overlay (large album art, seek bar, transport controls, queue panel, synced lyrics toggle)
- `client/src/components/SyncedLyrics.tsx` — Synced lyrics display (LRC parser, auto-scroll to active line, fallback to plain lyrics)
- `client/src/components/MetadataEditor.tsx` — Modal for editing track metadata (title, artist, album, track number) and uploading cover art
- `client/src/components/AddToPlaylistModal.tsx` — Modal for adding a track to a playlist (with inline create new playlist)
- `client/src/components/LoginPage.tsx` — User picker, PIN entry, and profile creation
- `client/src/components/HomePage.tsx` — Homepage with recently played, user playlists, and random album suggestions
- `client/src/components/ImportPage.tsx` — Spotify import with search, auto-download on import, full-page progress view
- `client/src/components/PlaylistsPage.tsx` — Playlist management (create, rename, reorder tracks, remove tracks, play/shuffle, batch downloads)
- `client/src/components/SearchPage.tsx` — YouTube search (videos + playlists) and manual download
- `client/src/components/DownloadsPage.tsx` — Download management with pending/failed track lists, batch selection, cancel, retry
- `client/src/components/SettingsPage.tsx` — Settings hub with tabbed sub-pages (Manager, Import, Downloads)
- `client/src/components/ManagerPage.tsx` — Library manager for browsing/editing/deleting artists, albums, songs, playlists with inline metadata editing, track reordering, and move/delete operations
- `client/src/components/DraggableList.tsx` — Generic drag-to-reorder list component (touch + mouse support)
- `client/src/components/SwipeableTrackRow.tsx` — Swipe-right-to-add-to-playlist gesture component for track rows

## Deezer Integration (FLAC Downloads)

- **Primary download source** — Deezer is tried first for all downloads, YouTube is fallback
- Requires `DEEZER_ARL` in `.env` (192-char cookie token from browser after logging into deezer.com)
- Requires Deezer Premium for FLAC downloads (free tier = 128kbps MP3 only)
- `AUDIO_FORMAT` env var controls preferred format: `flac` (default) or `mp3`
- Search uses free public API (`api.deezer.com/search`), download uses `@karlincoder/deemix` library
- Deezer service at `server/src/services/deezer.ts` — search, match, and download
- Downloads go to `_staging/` temp dir, then move to final library path
- DB tracks table has `deezer_id` and `format` columns for tracking source and file type
- **Quality upgrade script** at `server/scripts/upgrade-quality.ts` — re-downloads existing MP3s as FLAC from Deezer, prioritized by Spotify top artists. Supports `--artist "Name"`, `--dry-run`, `--all`. Deletes old MP3s after successful FLAC replacement. Retries on EPERM (Navidrome file locks). Triggers Navidrome scan on completion.
- **Bandcamp import script** at `server/scripts/import-bandcamp.ts` — downloads Bandcamp purchases via Bandsnatch CLI, imports into library. Supports `--download --user <name> --cookies <path>`, `--import`, `--dry-run`.
- **npm alias**: `deezer-sdk` is aliased to `@karlincoder/deezer-sdk` in package.json (required by deemix)

## Multi-User Auth

- Simple PIN-based authentication (4+ digit PIN per user, hashed with `crypto.scryptSync`)
- Users table: id, username, display_name, pin_hash
- Sessions table: token (UUID v4), user_id, 30-day expiry
- Login flow: user picker → PIN entry → session token stored in localStorage
- Auth header: `Authorization: Bearer <token>` sent with all API requests via `getAuthHeaders()` in api.ts
- `optionalAuth` middleware on most routes (doesn't block unauthenticated requests, but attaches user if present)
- Stream routes (`/api/stream`) have no auth (iOS MediaSession/background play may not send headers)
- Playlists have `user_id` column: user-created playlists are private, system playlists (`user_id = NULL`) visible to all
- Play history tracks per-user listening (capped at 1000 entries per user)
- Homepage shows per-user recently played, user's playlists, and random album suggestions

## Environment

- Requires `.env` at project root with `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`
- `MUSIC_DIR` set to `D:/library` (external drive) via `.env`
- App SQLite database at `D:/library/library.db` (inside MUSIC_DIR)
- Server runs on port 3001 by default
- Navidrome credentials in `.env`: `NAVIDROME_USER=admin`, `NAVIDROME_PASS=ADMIN`
- External binaries: yt-dlp, ffmpeg, deno (auto-discovered from WinGet paths on Windows)
- Server serves built client (`client/dist`) as static files, so port 3001 serves both API and SPA
- Remote access to app at `https://library.localmusicoklahoma.store` via Cloudflare Tunnel
- After client changes, run `cd client && npm run build` to update the production build served on port 3001

## Deployment

- **Dev machine** (desktop, `DESKTOP-2880PFH`): code changes only, push to git
- **Server laptop** (hostname `Maggi`, IP `192.168.12.254`): runs all services, music on external D: drive at `D:\library`
- SSH access: `ssh server@192.168.12.254` (key auth via `~/.ssh/id_ed25519`, no password needed)
- Repo on server: `C:\Users\server\Desktop\music-library`
- Deploy aliases (in `~/.bashrc` on dev machine):
  - `deploy` — full deploy: git pull + client build + restart MusicLibrary service
  - `deploy-fast` — server-only: git pull + restart (skip client build)
  - `server` — SSH into the server laptop
- Deploy workflow: `git push && deploy` (~15 seconds for client rebuild + service restart)
- Remote commands on server: `ssh server@192.168.12.254 "<command>"` (can run scripts, nssm, etc.)
- All services (Navidrome, cloudflared, MusicLibrary, ADSBTracker) run as Windows services via NSSM (auto-start on boot)
- Old services on dev machine are stopped and disabled

## ADS-B Tracker (Flight Tracking)

- **Separate project** at `~/Desktop/adsb-client` (dev) / `C:\Users\server\Desktop\adsb-client` (server)
- Real-time aircraft tracking PWA using OpenSky Network API
- Express 5 + React 19 + Vite + Tailwind v4 + Leaflet (same stack as music library)
- Runs on port **3002**, accessible at `https://planes.localmusicoklahoma.store` via Cloudflare Tunnel
- NSSM service: `ADSBTracker` (auto-start on boot)
- Push notifications via **ntfy.sh** — alerts when aircraft enter configurable radius around home location
- SSE for real-time aircraft state updates to the map
- PWA installable on iPhone (Add to Home Screen in Safari), notifications via ntfy iOS app
- No database — all state is real-time from OpenSky, settings stored in localStorage

## Navidrome (Streaming Server)

- **Navidrome v0.60.3** installed at `C:\Navidrome`, config at `C:\Navidrome\navidrome.toml`
- Database at `C:\Navidrome\data\navidrome.db` — can query directly with better-sqlite3
- Serves the music library folder (`MUSIC_DIR`) — new downloads appear automatically
- Accessible locally at `http://localhost:4533`
- Accessible remotely at `https://music.localmusicoklahoma.store` via Cloudflare Tunnel
- Tunnel config at `~/.cloudflared/config.yml` (routes: `music.` → Navidrome:4533, `library.` → MusicLibrary:3001, `planes.` → ADSBTracker:3002)
- Phone access via Arpeggi (iOS, OpenSubsonic) — supports gapless playback, offline downloads, playlists
- Spotify integration enabled in Navidrome config for artist images (uses same credentials as music library app)
- Deezer also enabled by default as fallback artist image source (no config needed)
- Navidrome, cloudflared, MusicLibrary, and ADSBTracker all run as Windows services via NSSM
- Subsonic API: trigger scan via `GET /rest/startScan.view?u=admin&p=ADMIN&c=music-library&v=1.16.1&f=json`
- Navidrome reads M3U files from `D:/library/Playlists/` directory for playlists
- Playlists in Navidrome can be managed directly via its SQLite DB (tables: `playlist`, `playlist_tracks`, `playlist_fields`)

## Music Player (PWA)

- **Built-in audio player** — streams from `GET /api/stream/:trackId` with Range request support (required for seeking)
- **Cover art** — served via `GET /api/stream/art/:trackId`, proxies external URLs, falls back to `cover.jpg` in album folder, then embedded MP3 art
- **Player store** at `client/src/lib/player.ts` — separate Zustand store from app navigation, manages singleton `HTMLAudioElement` (not rendered in React)
- **Queue management** — play track/album/playlist, shuffle, repeat (off/all/one), add to queue, remove from queue
- **MediaSession API** — sets metadata (title, artist, artwork) and action handlers for iOS lock screen controls (play, pause, next, prev, seek)
- **Now-playing bar** — persistent bottom bar between content and mobile tab bar, shows album art thumbnail, track info, play/pause, progress bar. Tap to open full-screen view.
- **Full-screen now-playing** — large album art, seek slider, transport controls (shuffle, prev, play/pause, next, repeat), queue panel toggle
- **PWA installable** — `manifest.json`, minimal service worker (network-first), iOS meta tags (`apple-mobile-web-app-capable`, `black-translucent` status bar). "Add to Home Screen" in Safari for app-like experience.
- **FLAC streaming** — iOS Safari and Chrome both support FLAC natively, no server-side transcoding needed
- **No offline audio caching** — streaming only via Cloudflare Tunnel, use Arpeggi for offline playback

## Metadata Editing

- **Edit track metadata** via `PUT /api/library/tracks/:id` — accepts `{ title, artist, album, album_artist, track_number, year }`, updates DB, re-writes file tags via `tagger.ts`, moves/renames file if artist/album changed via `organizer.ts`, cleans up empty directories, triggers Navidrome rescan
- **Upload cover art** via `PUT /api/library/tracks/:id/art` — multipart upload, saves as `cover.jpg` in album folder, updates DB `album_art_url`, triggers Navidrome rescan. Uses multer for file handling.
- **MetadataEditor component** — modal dialog accessible from three-dot context menus on track rows throughout the app
- **DB function** `updateTrackMetadata()` in `db/index.ts` — generic field updater for tracks table

## Download Management

- **Pending track browsing** — `GET /api/download/pending` returns list of all pending tracks for UI display
- **Cancel downloads** — `DELETE /api/download/pending/:id` (single) or `DELETE /api/download/pending` (all) removes pending tracks from DB
- **Retry failed** — `POST /api/download/retry-failed` resets all failed tracks to pending status
- **Batch skip cancelled** — batch download loop checks track status before each download, skips if cancelled mid-job
- **Downloads page** — tabbed view (pending/failed), checkboxes for batch selection, "Download Selected" / "Download All" / "Cancel Selected" / "Cancel All" / "Retry Failed" buttons, search/filter within track lists
- **DB functions** — `cancelPendingTrack()`, `cancelAllPendingTracks()`, `retryFailedTracks()` in `db/index.ts`

## Key Behaviors

- Importing from Spotify automatically triggers batch download of all pending tracks
- After import, UI switches to a full-page download progress view (replaces selection UI)
- Batch downloads use SSE (`/api/download/progress/:jobId`) for real-time progress — SSE endpoint streams indefinitely, use `--max-time` with curl
- Batch download endpoint accepts optional `trackIds` array to prioritize specific tracks (e.g. playlist tracks)
- YouTube search returns both individual videos and playlist/album results in parallel
- YouTube matching uses a 3-pass search with scoring (prefers Topic channels, matches duration)
- Import page has Spotify search (albums + playlists) in addition to browsing saved library
- 1.5s delay between downloads to avoid YouTube throttling
- Compilation albums (various artists) use `album_artist` for folder organization and ID3 TPE2 tag
- File organization: `{album_artist or first artist}/{album}/{tracknum title}.{mp3|flac}`
- Lyrics fetched from LRCLIB (free, no API key) during download and backfill
- Plain lyrics embedded as ID3 USLT tags; synced lyrics written as `.lrc` sidecar files
- Live/bonus/demo track titles are cleaned to match studio lyrics (fallback search)
- Backfill endpoint: `POST /api/library/backfill-lyrics` with SSE progress at `GET /api/library/backfill-lyrics/:jobId`

## Library Hygiene Rules

- **Avoid Spotify API when possible** — use MusicBrainz for metadata, Cover Art Archive for album art. Spotify rate limits aggressively (~20hr bans).
- **Artist folder names must be clean** — no format tags (`[FLAC]`, `[24-96]`), no year ranges, no source names (`vtwin88cube`). Just the artist name.
- **Album folder names must be clean** — no format/bitrate tags, no `Artist-Album-Format-Year` scene naming. Just the album title.
- **Artist credits must use proper separators** — MusicBrainz `joinphrase` field contains the separator (` & `, `, `, etc.). Never concatenate artist names without it. Semicolons from Spotify are auto-converted to `" / "` (Navidrome's preferred multi-artist separator) by `normalizeArtistSeparators()` in the tagger, organizer, CSV import, and Deezer search.
- **Artist normalization pipeline** — `normalizeArtist()` is called in tagger.ts (before writing tags), organizer.ts (before generating folder paths), and deezer.ts (before search queries). This prevents corrupted/inconsistent artist names from entering the library. The `ARTIST_ALIASES` map in normalizer.ts contains known corrections (Merle Haggard variants, Neil Young & Crazy Horse as single entity, etc.).
- **Import scripts have no track cap** — previously 2000, removed since library is on external storage. Round-robin across artists to ensure variety.
- **Only import studio albums by default** — filter out compilations, live albums, remixes, soundtracks, demos (MusicBrainz `secondary-types`).
- **Scan script** at `server/scripts/scan-library.ts` checks for: mangled names, missing art, temp files, duplicates, empty folders. Run periodically.
- **Import script** at `server/scripts/top-music.ts` uses MusicBrainz (not Spotify) to import configured artists. Edit the `ARTISTS` array to add/remove.
- **Cleanup script** at `server/scripts/cleanup-library.ts` — comprehensive library cleanup: fix concatenated names, consolidate variant folders, fetch cover art, embed art into MP3 tags, backfill DB album_art_url. Supports `--execute`, `--fetch-art`, `--embed-art`, `--fix-db-art`, `--navidrome-check`. **Note:** each flag returns early, so run them as separate invocations (e.g. `--fetch-art` then `--embed-art`).
- **FLAC tag writing** uses `-map_metadata -1` to clear all existing metadata before writing fresh values (prevents multi-value accumulation in Vorbis Comments).
- **FLAC ALBUMARTIST tag** can be stored as `ALBUMARTIST`, `ALBUM_ARTIST`, or `ALBUM ARTIST` (with space). `readFlacTags` checks all variants.
- **Playlist generation** at `server/scripts/generate-playlists.ts` — auto-generates playlists by clustering similar artists, shuffles with album-spread logic, writes M3U files for Navidrome. Use `--regenerate` to recreate.
- **CSV playlist import** at `server/scripts/import-csv-playlists.ts` — imports Exportify CSV files as playlists with track data. Normalizes artist separators (`;` → `" / "`), detects compilation albums (3+ artists → `album_artist = "Various Artists"`), reads `Album Image URL`/`Track Number`/`Disc Number` columns from CSV when available. Usage: `npx tsx scripts/import-csv-playlists.ts ~/Downloads/*.csv`
- **CSV imports may not include album art** — run `cleanup-library.ts --fetch-art --embed-art` after downloading to backfill cover art from Cover Art Archive.
- **Album art fallback** — when album art isn't available (live albums, obscure releases, etc.), use an artist image instead. No track should be left without any cover art.
- **Release type tagging** — Navidrome reads `TXXX:MusicBrainz Album Type` (MP3) or `RELEASETYPE` (FLAC) to distinguish albums/singles/EPs. Backfill script at `server/scripts/backfill-release-types.ts` looks up types from MusicBrainz and writes them into tags. Run after bulk imports.
- **Artist image fallback** at `server/scripts/fetch-artist-images.ts` — for albums without cover art, downloads artist images from Navidrome (sourced from Spotify/Deezer) as `cover.jpg` fallback.
- **M3U regeneration** at `server/scripts/_write-m3u.ts` — regenerates M3U playlist files for specific playlists (useful after batch downloads to update Navidrome playlists with newly downloaded tracks).
- **Dedup script** at `server/scripts/_dedup-tracks.ts` — removes exact duplicate tracks (same artist+title+album, case-insensitive). Keeps best copy (FLAC > MP3, has track number > not, in playlist > not). Reassigns playlist references before deleting.
- **Orphan cleanup** at `server/scripts/_cleanup-orphans.ts` — finds audio files on disk with no DB entry. Safely deletes orphans where DB has a replacement file at a different path. Reports unregistered files (bootlegs, loose imports). Supports `--delete`.
- **Spotify mix import** at `server/scripts/import-spotify-mixes.ts` — imports Spotify playlists matching mix/radio patterns. Note: Spotify blocks playlist track fetches in Development Mode; use Exportify CSVs as workaround.
- **Artist tag fix script** at `server/scripts/fix-artist-tags.ts` — one-time script that fixed 360 files with corrupted/inconsistent artist tags (semicolons, corrupted names, missing artists). Already run and complete. Supports `--dry-run` and `--execute`.
- **Deezer cover art persistence** — download.ts now saves Deezer's `albumCoverUrl` to the DB `album_art_url` column when downloading, so art URLs aren't lost after download.

### Pipeline Hardening (Partially Complete)
The following pipeline fixes prevent future artist tag corruption:
- **DONE**: `normalizer.ts` — exported `normalizeArtist()`, `normalizeArtistSeparators()`, `normalizeForSearch()`, expanded `ARTIST_ALIASES` with Merle Haggard/Neil Young/Isbell variants
- **DONE**: `tagger.ts` — normalizes artist/albumArtist before writing MP3 and FLAC tags
- **DONE**: `organizer.ts` — normalizes artist before splitting for folder names (prevents semicolons creating wrong folders)
- **DONE**: `deezer.ts` — uses `normalizeForSearch()` instead of naive comma split (handles semicolons)
- **DONE**: `download.ts` — persists Deezer cover art URL to DB after download
- **DONE**: `import-csv-playlists.ts` — normalizes artist separators, detects compilation albums, reads art URL/track num/disc num from CSV
- **TODO**: Album art search fallback chain (Cover Art Archive → Deezer → iTunes) as a reusable function in the download pipeline

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
- Player state is in a separate Zustand store (`player.ts`) from app navigation (`store.ts`) — player persists across page changes
- File uploads use multer middleware (multipart form data)
- No test framework currently configured
