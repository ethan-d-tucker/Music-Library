import { useState, useEffect } from 'react'
import { ChevronLeft, Music, Disc3, User, Search, Loader2 } from 'lucide-react'
import { useAppStore } from '../lib/store.ts'
import {
  getArtists, getAlbumsByArtist, getAlbumTracks, getLibraryStats,
  getAllLibraryAlbums, getAllTracks, searchLibrary,
  type TrackRow, type LibraryStats,
} from '../lib/api.ts'

function formatDuration(ms: number) {
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function StatusDot({ status }: { status: string }) {
  if (status === 'downloading') {
    return <Loader2 size={14} className="animate-spin text-[var(--color-accent)]" />
  }
  const color =
    status === 'complete' ? 'bg-[var(--color-success)]' :
    status === 'failed' ? 'bg-[var(--color-danger)]' :
    'bg-[var(--color-warning)]'
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} title={status} />
}

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

// --- Artists Tab (existing drill-down) ---

function ArtistsView() {
  const selectedArtist = useAppStore((s) => s.selectedArtist)
  const selectedAlbum = useAppStore((s) => s.selectedAlbum)
  const setSelectedArtist = useAppStore((s) => s.setSelectedArtist)
  const setSelectedAlbum = useAppStore((s) => s.setSelectedAlbum)

  const [artists, setArtists] = useState<{ artist: string; track_count: number }[]>([])
  const [albums, setAlbums] = useState<{ album: string; track_count: number; album_art_url: string }[]>([])
  const [tracks, setTracks] = useState<TrackRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    if (!selectedArtist) {
      getArtists().then((r) => { setArtists(r.artists); setLoading(false) }).catch(console.error)
    } else if (!selectedAlbum) {
      getAlbumsByArtist(selectedArtist).then((r) => { setAlbums(r.albums); setLoading(false) }).catch(console.error)
    } else {
      getAlbumTracks(selectedArtist, selectedAlbum).then((r) => { setTracks(r.tracks); setLoading(false) }).catch(console.error)
    }
  }, [selectedArtist, selectedAlbum])

  if (loading) return <p className="text-[var(--color-text-muted)]">Loading...</p>

  if ((selectedArtist || selectedAlbum)) {
    return (
      <div>
        <button
          onClick={() => selectedAlbum ? setSelectedAlbum(null) : setSelectedArtist(null)}
          className="mb-4 flex items-center gap-1 text-sm text-[var(--color-accent)] hover:underline"
        >
          <ChevronLeft size={16} /> Back
        </button>

        {!selectedAlbum ? (
          <div>
            <h3 className="text-lg font-semibold mb-3">{selectedArtist}</h3>
            <div className="grid gap-2">
              {albums.map((a) => (
                <button
                  key={a.album}
                  onClick={() => setSelectedAlbum(a.album)}
                  className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] transition-colors"
                >
                  {a.album_art_url ? (
                    <img src={a.album_art_url} alt="" className="w-10 h-10 rounded object-cover" />
                  ) : (
                    <Disc3 size={18} className="text-[var(--color-text-muted)]" />
                  )}
                  <span className="flex-1">{a.album || 'Singles'}</span>
                  <span className="text-sm text-[var(--color-text-muted)]">{a.track_count} tracks</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <h3 className="text-lg font-semibold mb-1">{selectedArtist}</h3>
            <h4 className="text-sm text-[var(--color-text-muted)] mb-4">{selectedAlbum}</h4>
            <div className="space-y-1">
              {tracks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 rounded-lg px-4 py-2 hover:bg-[var(--color-surface)] transition-colors">
                  <span className="w-6 text-right text-sm text-[var(--color-text-muted)]">{t.track_number || ''}</span>
                  <Music size={16} className="text-[var(--color-text-muted)]" />
                  <div className="flex-1 min-w-0">
                    <span className="block truncate">{t.title}</span>
                    {t.artist !== selectedArtist && (
                      <span className="block text-sm text-[var(--color-text-muted)] truncate">{t.artist}</span>
                    )}
                  </div>
                  <StatusDot status={t.download_status} />
                  <span className="text-sm text-[var(--color-text-muted)]">{formatDuration(t.duration_ms)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      {artists.length === 0 ? (
        <p className="text-[var(--color-text-muted)]">No music yet. Import from Spotify or search YouTube to get started.</p>
      ) : (
        artists.map((a) => (
          <button
            key={a.artist}
            onClick={() => setSelectedArtist(a.artist)}
            className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <User size={18} className="text-[var(--color-text-muted)]" />
            <span className="flex-1">{a.artist}</span>
            <span className="text-sm text-[var(--color-text-muted)]">{a.track_count} tracks</span>
          </button>
        ))
      )}
    </div>
  )
}

// --- Albums Tab ---

function AlbumsView() {
  const [filterQuery, setFilterQuery] = useState('')
  const debouncedQuery = useDebounce(filterQuery, 300)
  const [albums, setAlbums] = useState<{ album: string; artist: string; track_count: number; album_art_url: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedEntry, setSelectedEntry] = useState<{ artist: string; album: string } | null>(null)
  const [tracks, setTracks] = useState<TrackRow[]>([])
  const [tracksLoading, setTracksLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    getAllLibraryAlbums(debouncedQuery || undefined)
      .then((r) => { setAlbums(r.albums); setLoading(false) })
      .catch(console.error)
  }, [debouncedQuery])

  useEffect(() => {
    if (!selectedEntry) return
    setTracksLoading(true)
    getAlbumTracks(selectedEntry.artist, selectedEntry.album)
      .then((r) => { setTracks(r.tracks); setTracksLoading(false) })
      .catch(console.error)
  }, [selectedEntry])

  if (selectedEntry) {
    return (
      <div>
        <button
          onClick={() => setSelectedEntry(null)}
          className="mb-4 flex items-center gap-1 text-sm text-[var(--color-accent)] hover:underline"
        >
          <ChevronLeft size={16} /> Back
        </button>
        <h3 className="text-lg font-semibold mb-1">{selectedEntry.album}</h3>
        <h4 className="text-sm text-[var(--color-text-muted)] mb-4">{selectedEntry.artist}</h4>
        {tracksLoading ? (
          <p className="text-[var(--color-text-muted)]">Loading...</p>
        ) : (
          <div className="space-y-1">
            {tracks.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg px-4 py-2 hover:bg-[var(--color-surface)] transition-colors">
                <span className="w-6 text-right text-sm text-[var(--color-text-muted)]">{t.track_number || ''}</span>
                <Music size={16} className="text-[var(--color-text-muted)]" />
                <div className="flex-1 min-w-0">
                  <span className="block truncate">{t.title}</span>
                  {t.artist !== selectedEntry.artist && (
                    <span className="block text-sm text-[var(--color-text-muted)] truncate">{t.artist}</span>
                  )}
                </div>
                <StatusDot status={t.download_status} />
                <span className="text-sm text-[var(--color-text-muted)]">{formatDuration(t.duration_ms)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          type="text"
          placeholder="Filter albums..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      {loading ? (
        <p className="text-[var(--color-text-muted)]">Loading...</p>
      ) : albums.length === 0 ? (
        <p className="text-[var(--color-text-muted)]">{filterQuery ? 'No albums match your search.' : 'No albums yet.'}</p>
      ) : (
        <div className="grid gap-2 max-h-[70vh] overflow-y-auto">
          {albums.map((a) => (
            <button
              key={`${a.artist}|||${a.album}`}
              onClick={() => setSelectedEntry({ artist: a.artist, album: a.album })}
              className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] transition-colors"
            >
              {a.album_art_url ? (
                <img src={a.album_art_url} alt="" className="w-10 h-10 rounded object-cover" />
              ) : (
                <Disc3 size={18} className="text-[var(--color-text-muted)]" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{a.album}</div>
                <div className="text-sm text-[var(--color-text-muted)] truncate">{a.artist}</div>
              </div>
              <span className="text-sm text-[var(--color-text-muted)]">{a.track_count} tracks</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Songs Tab ---

function SongsView() {
  const [filterQuery, setFilterQuery] = useState('')
  const debouncedQuery = useDebounce(filterQuery, 300)
  const [tracks, setTracks] = useState<TrackRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const promise = debouncedQuery
      ? searchLibrary(debouncedQuery)
      : getAllTracks()
    promise
      .then((r) => { setTracks(r.tracks); setLoading(false) })
      .catch(console.error)
  }, [debouncedQuery])

  return (
    <div>
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          type="text"
          placeholder="Filter songs..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      {loading ? (
        <p className="text-[var(--color-text-muted)]">Loading...</p>
      ) : tracks.length === 0 ? (
        <p className="text-[var(--color-text-muted)]">{filterQuery ? 'No songs match your search.' : 'No songs yet.'}</p>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto">
          {/* Desktop header */}
          <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_3rem_3.5rem] gap-x-4 px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide border-b border-[var(--color-border)]">
            <span>Title</span>
            <span>Artist</span>
            <span>Album</span>
            <span className="text-center">Status</span>
            <span className="text-right">Duration</span>
          </div>
          <div className="space-y-0.5">
            {tracks.map((t) => (
              <div key={t.id} className="flex md:grid md:grid-cols-[2fr_1fr_1fr_3rem_3.5rem] gap-x-4 items-center rounded-lg px-3 md:px-4 py-2 hover:bg-[var(--color-surface)] transition-colors">
                <div className="flex-1 min-w-0 md:contents">
                  <div className="truncate">{t.title}</div>
                  <div className="text-sm text-[var(--color-text-muted)] truncate">{t.artist} <span className="md:hidden">· {t.album}</span></div>
                  <span className="hidden md:block truncate text-sm text-[var(--color-text-muted)]">{t.album}</span>
                </div>
                <span className="text-center shrink-0 mx-2 md:mx-0"><StatusDot status={t.download_status} /></span>
                <span className="text-sm text-[var(--color-text-muted)] text-right shrink-0">{formatDuration(t.duration_ms)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// --- Main Component ---

export function LibraryBrowser() {
  const libraryTab = useAppStore((s) => s.libraryTab)
  const [stats, setStats] = useState<LibraryStats | null>(null)

  useEffect(() => {
    getLibraryStats().then(setStats).catch(console.error)
  }, [])

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold">Library</h2>
        {stats && (
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {stats.downloaded} downloaded / {stats.artists} artists / {stats.albums} albums
            {stats.pending > 0 && <span className="text-[var(--color-warning)]"> / {stats.pending} pending</span>}
            {stats.failed > 0 && <span className="text-[var(--color-danger)]"> / {stats.failed} failed</span>}
          </p>
        )}
      </div>

      {libraryTab === 'artists' && <ArtistsView />}
      {libraryTab === 'albums' && <AlbumsView />}
      {libraryTab === 'songs' && <SongsView />}
    </div>
  )
}
