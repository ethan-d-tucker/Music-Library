import { useState, useEffect } from 'react'
import { Search, Download, Check, Loader2, AlertCircle, Music, User, Disc3, Play } from 'lucide-react'
import { useAppStore } from '../lib/store.ts'
import { usePlayerStore } from '../lib/player.ts'
import { searchDeezer, downloadDeezerTrack, searchLibraryUnified, type DeezerResult, type TrackRow } from '../lib/api.ts'
import { SwipeableTrackRow } from './SwipeableTrackRow.tsx'

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDurationMs(ms: number): string {
  return formatDuration(Math.floor(ms / 1000))
}

type SearchTab = 'library' | 'download'

// --- Library Search View ---

function LibrarySearchView() {
  const navigateToArtist = useAppStore((s) => s.navigateToArtist)
  const navigateToAlbum = useAppStore((s) => s.navigateToAlbum)
  const playTrack = usePlayerStore((s) => s.playTrack)
  const addToQueue = usePlayerStore((s) => s.addToQueue)

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [artists, setArtists] = useState<{ artist: string; track_count: number; album_art_url: string }[]>([])
  const [albums, setAlbums] = useState<{ album: string; artist: string; track_count: number; album_art_url: string }[]>([])
  const [tracks, setTracks] = useState<TrackRow[]>([])
  const [searching, setSearching] = useState(false)
  const [showAllArtists, setShowAllArtists] = useState(false)
  const [showAllAlbums, setShowAllAlbums] = useState(false)
  const [showAllTracks, setShowAllTracks] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const q = debouncedQuery.trim()
    if (!q) {
      setArtists([])
      setAlbums([])
      setTracks([])
      return
    }
    setSearching(true)
    searchLibraryUnified(q)
      .then((r) => {
        setArtists(r.artists)
        setAlbums(r.albums)
        setTracks(r.tracks)
        setShowAllArtists(false)
        setShowAllAlbums(false)
        setShowAllTracks(false)
      })
      .catch(console.error)
      .finally(() => setSearching(false))
  }, [debouncedQuery])

  const hasResults = artists.length > 0 || albums.length > 0 || tracks.length > 0

  return (
    <div>
      <div className="relative mb-6">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your library..."
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 md:px-4 py-2.5 pl-10 text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)]"
        />
        {searching && (
          <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[var(--color-text-muted)]" />
        )}
      </div>

      {!debouncedQuery && (
        <div className="text-center text-[var(--color-text-muted)] py-12">
          Search for artists, albums, or songs in your library
        </div>
      )}

      {debouncedQuery && !searching && !hasResults && (
        <div className="text-center text-[var(--color-text-muted)] py-12">
          No results found for "{debouncedQuery}"
        </div>
      )}

      {/* Artists */}
      {artists.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold">Artists</h3>
            {artists.length > 5 && (
              <button
                onClick={() => setShowAllArtists(!showAllArtists)}
                className="text-xs text-[var(--color-accent)] hover:underline"
              >
                {showAllArtists ? 'Show less' : 'See all'}
              </button>
            )}
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
            {(showAllArtists ? artists : artists.slice(0, 5)).map((a) => (
              <button
                key={a.artist}
                onClick={() => navigateToArtist(a.artist)}
                className="flex-shrink-0 w-24 group"
              >
                <div className="w-24 h-24 rounded-full bg-[var(--color-surface-2)] flex items-center justify-center mb-2 shadow-lg overflow-hidden mx-auto group-hover:ring-2 group-hover:ring-[var(--color-accent)] transition-all">
                  <User size={28} className="text-[var(--color-text-muted)] opacity-50" />
                </div>
                <p className="text-xs font-medium truncate text-center">{a.artist}</p>
                <p className="text-[10px] text-[var(--color-text-muted)] text-center">{a.track_count} tracks</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Albums */}
      {albums.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold">Albums</h3>
            {albums.length > 5 && (
              <button
                onClick={() => setShowAllAlbums(!showAllAlbums)}
                className="text-xs text-[var(--color-accent)] hover:underline"
              >
                {showAllAlbums ? 'Show less' : 'See all'}
              </button>
            )}
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
            {(showAllAlbums ? albums : albums.slice(0, 5)).map((a) => (
              <button
                key={`${a.artist}|||${a.album}`}
                onClick={() => navigateToAlbum(a.artist, a.album)}
                className="flex-shrink-0 w-32 group"
              >
                <div className="relative mb-2">
                  {a.album_art_url ? (
                    <img
                      src={a.album_art_url}
                      alt=""
                      className="w-32 h-32 rounded-lg object-cover bg-[var(--color-surface-2)] shadow-lg"
                    />
                  ) : (
                    <div className="w-32 h-32 rounded-lg bg-[var(--color-surface-2)] flex items-center justify-center shadow-lg">
                      <Disc3 size={28} className="text-[var(--color-text-muted)] opacity-50" />
                    </div>
                  )}
                  <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center shadow-lg">
                      <Play size={14} className="text-white ml-0.5" fill="white" />
                    </div>
                  </div>
                </div>
                <p className="text-xs font-medium truncate">{a.album}</p>
                <p className="text-[10px] text-[var(--color-text-muted)] truncate">{a.artist}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Songs */}
      {tracks.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold">Songs</h3>
            {tracks.length > 10 && (
              <button
                onClick={() => setShowAllTracks(!showAllTracks)}
                className="text-xs text-[var(--color-accent)] hover:underline"
              >
                {showAllTracks ? 'Show less' : `See all (${tracks.length})`}
              </button>
            )}
          </div>
          <div className="space-y-0.5">
            {(showAllTracks ? tracks : tracks.slice(0, 10)).map((t) => (
              <SwipeableTrackRow key={t.id} onSwipeRight={() => addToQueue(t)}>
                <button
                  onClick={() => playTrack(t, tracks)}
                  className="w-full flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-[var(--color-surface)] transition-colors text-left group"
                >
                  <img
                    src={`/api/stream/art/${t.id}`}
                    alt=""
                    className="w-10 h-10 rounded object-cover bg-[var(--color-surface-2)] flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.title}</p>
                    <p className="text-xs text-[var(--color-text-muted)] truncate">{t.artist} &middot; {t.album}</p>
                  </div>
                  <span className="text-xs text-[var(--color-text-muted)] flex-shrink-0 tabular-nums">
                    {formatDurationMs(t.duration_ms)}
                  </span>
                </button>
              </SwipeableTrackRow>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// --- Deezer Download View ---

function DeezerDownloadView() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DeezerResult[]>([])
  const [searching, setSearching] = useState(false)
  const [downloading, setDownloading] = useState<Record<number, 'downloading' | 'done' | 'error' | 'skipped'>>({})

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setDownloading({})
    try {
      const { results: r } = await searchDeezer(q)
      setResults(r)
    } catch (err) {
      console.error(err)
    } finally {
      setSearching(false)
    }
  }

  async function handleDownload(track: DeezerResult) {
    setDownloading(prev => ({ ...prev, [track.id]: 'downloading' }))
    try {
      const res = await downloadDeezerTrack(track)
      setDownloading(prev => ({ ...prev, [track.id]: res.skipped ? 'skipped' : 'done' }))
    } catch {
      setDownloading(prev => ({ ...prev, [track.id]: 'error' }))
    }
  }

  async function handleDownloadAll() {
    for (const track of results) {
      if (downloading[track.id] === 'done' || downloading[track.id] === 'skipped') continue
      await handleDownload(track)
    }
  }

  const allDone = results.length > 0 && results.every(r => downloading[r.id] === 'done' || downloading[r.id] === 'skipped')
  const anyDownloading = Object.values(downloading).some(s => s === 'downloading')

  return (
    <div>
      <form onSubmit={handleSearch} className="mb-4 md:mb-6 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Deezer to download..."
          className="flex-1 min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 md:px-4 py-2 text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="submit"
          disabled={searching}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
        >
          {searching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
        </button>
      </form>

      {results.length > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-muted)]">{results.length} results</span>
          <button
            onClick={handleDownloadAll}
            disabled={allDone || anyDownloading}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {allDone ? (
              <><Check size={14} /> All Downloaded</>
            ) : anyDownloading ? (
              <><Loader2 size={14} className="animate-spin" /> Downloading...</>
            ) : (
              <><Download size={14} /> Download All</>
            )}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {results.map((r) => {
          const status = downloading[r.id]
          return (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
            >
              {r.albumCoverUrl ? (
                <img src={r.albumCoverUrl} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded bg-[var(--color-surface-2)] flex items-center justify-center shrink-0">
                  <Music size={18} className="text-[var(--color-text-muted)]" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{r.title}</div>
                <div className="text-sm text-[var(--color-text-muted)] truncate">
                  {r.artist} &middot; {r.album} &middot; {formatDuration(r.duration)}
                </div>
              </div>
              <button
                onClick={() => handleDownload(r)}
                disabled={status === 'downloading' || status === 'done' || status === 'skipped'}
                className="shrink-0 rounded-lg border border-[var(--color-border)] p-2 hover:bg-[var(--color-surface-2)] transition-colors disabled:opacity-50"
                title={
                  status === 'done' ? 'Downloaded' :
                  status === 'skipped' ? 'Already in library' :
                  status === 'error' ? 'Failed — click to retry' :
                  'Download'
                }
              >
                {status === 'downloading' ? <Loader2 size={16} className="animate-spin" /> :
                 status === 'done' ? <Check size={16} className="text-[var(--color-success)]" /> :
                 status === 'skipped' ? <Check size={16} className="text-[var(--color-text-muted)]" /> :
                 status === 'error' ? <AlertCircle size={16} className="text-[var(--color-danger)]" /> :
                 <Download size={16} />}
              </button>
            </div>
          )
        })}
      </div>

      {results.length === 0 && !searching && (
        <div className="text-center text-[var(--color-text-muted)] py-12">
          Search Deezer to download music to your library
        </div>
      )}
    </div>
  )
}

// --- Main Search Page ---

export function SearchPage() {
  const [tab, setTab] = useState<SearchTab>('library')

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Search</h2>

      {/* Tab bar */}
      <div className="flex border-b border-[var(--color-border)] mb-4">
        <button
          onClick={() => setTab('library')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            tab === 'library'
              ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          Library
        </button>
        <button
          onClick={() => setTab('download')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            tab === 'download'
              ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          Download
        </button>
      </div>

      {tab === 'library' ? <LibrarySearchView /> : <DeezerDownloadView />}
    </div>
  )
}
