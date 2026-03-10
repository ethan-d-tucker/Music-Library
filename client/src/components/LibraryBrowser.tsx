import { useState, useEffect } from 'react'
import { ChevronLeft, Disc3, User, Search, Loader2, Play, Shuffle, MoreHorizontal, Pencil, ListPlus, ListMusic } from 'lucide-react'
import { useAppStore } from '../lib/store.ts'
import { usePlayerStore } from '../lib/player.ts'
import { MetadataEditor } from './MetadataEditor.tsx'
import { AddToPlaylistModal } from './AddToPlaylistModal.tsx'
import { SwipeableTrackRow } from './SwipeableTrackRow.tsx'
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
  if (status === 'complete') return null
  const color = status === 'failed' ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-warning)]'
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

// --- Album Art Component ---

function AlbumArt({ url, trackId, size = 'md', className = '' }: {
  url?: string; trackId?: number; size?: 'sm' | 'md' | 'lg'; className?: string
}) {
  const sizeClass = size === 'sm' ? 'w-10 h-10' : size === 'md' ? 'w-full aspect-square' : 'w-full aspect-square'
  const src = trackId ? `/api/stream/art/${trackId}` : url
  if (!src) {
    return (
      <div className={`${sizeClass} rounded-md bg-[var(--color-surface-2)] flex items-center justify-center ${className}`}>
        <Disc3 size={size === 'sm' ? 18 : 40} className="text-[var(--color-text-muted)] opacity-50" />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      className={`${sizeClass} rounded-md object-cover bg-[var(--color-surface-2)] ${className}`}
      onError={(e) => {
        const img = e.target as HTMLImageElement
        img.style.display = 'none'
        img.parentElement?.classList.add('art-fallback')
      }}
    />
  )
}

// --- Artists Tab ---

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

  // Album detail view
  if (selectedArtist && selectedAlbum) {
    return (
      <AlbumDetailView
        artist={selectedArtist}
        album={selectedAlbum}
        tracks={tracks}
        onBack={() => setSelectedAlbum(null)}
      />
    )
  }

  // Artist detail view — album grid
  if (selectedArtist) {
    return (
      <div>
        <button
          onClick={() => setSelectedArtist(null)}
          className="mb-4 flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          <ChevronLeft size={16} /> Back
        </button>

        <h2 className="text-2xl font-bold mb-6">{selectedArtist}</h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {albums.map((a) => (
            <button
              key={a.album}
              onClick={() => setSelectedAlbum(a.album)}
              className="group text-left rounded-lg p-3 hover:bg-[var(--color-surface)] transition-colors"
            >
              <div className="relative mb-3">
                <AlbumArt url={a.album_art_url} className="shadow-lg" />
                <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-10 h-10 rounded-full bg-[var(--color-accent)] flex items-center justify-center shadow-lg">
                    <Play size={18} className="text-white ml-0.5" fill="white" />
                  </div>
                </div>
              </div>
              <p className="font-medium text-sm truncate">{a.album || 'Singles'}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{a.track_count} tracks</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // Artist grid
  return (
    <div>
      {artists.length === 0 ? (
        <p className="text-[var(--color-text-muted)]">No music yet. Import from Spotify or search to get started.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {artists.map((a) => (
            <button
              key={a.artist}
              onClick={() => setSelectedArtist(a.artist)}
              className="group text-left rounded-lg p-3 hover:bg-[var(--color-surface)] transition-colors"
            >
              <div className="w-full aspect-square rounded-full bg-[var(--color-surface-2)] flex items-center justify-center mb-3 shadow-lg overflow-hidden">
                <User size={40} className="text-[var(--color-text-muted)] opacity-50" />
              </div>
              <p className="font-medium text-sm truncate text-center">{a.artist}</p>
              <p className="text-xs text-[var(--color-text-muted)] text-center mt-0.5">{a.track_count} tracks</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Album Detail View ---

function AlbumDetailView({ artist, album, tracks, onBack }: {
  artist: string; album: string; tracks: TrackRow[]; onBack: () => void
}) {
  const playAlbum = usePlayerStore((s) => s.playAlbum)

  const playable = tracks.filter((t) => t.download_status === 'complete')
  const artTrack = tracks.find((t) => t.album_art_url || t.download_status === 'complete')
  const totalDuration = tracks.reduce((sum, t) => sum + t.duration_ms, 0)
  const totalMins = Math.floor(totalDuration / 60000)

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        <ChevronLeft size={16} /> Back
      </button>

      {/* Album header */}
      <div className="flex flex-col sm:flex-row gap-6 mb-6">
        <div className="w-48 h-48 sm:w-56 sm:h-56 flex-shrink-0 mx-auto sm:mx-0">
          <AlbumArt
            url={artTrack?.album_art_url}
            trackId={artTrack?.id}
            size="lg"
            className="shadow-2xl rounded-lg"
          />
        </div>
        <div className="flex flex-col justify-end">
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Album</p>
          <h2 className="text-2xl md:text-3xl font-bold mb-2">{album}</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            {artist} &middot; {tracks.length} songs &middot; {totalMins} min
          </p>
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={() => playAlbum(playable)}
              disabled={playable.length === 0}
              className="flex items-center gap-2 rounded-full bg-[var(--color-accent)] px-6 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
            >
              <Play size={18} fill="white" /> Play
            </button>
            <button
              onClick={() => {
                const shuffled = [...playable].sort(() => Math.random() - 0.5)
                playAlbum(shuffled)
              }}
              disabled={playable.length === 0}
              className="flex items-center gap-2 rounded-full border border-[var(--color-border)] px-5 py-2.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors disabled:opacity-50"
            >
              <Shuffle size={16} /> Shuffle
            </button>
          </div>
        </div>
      </div>

      {/* Track list */}
      <TrackList tracks={tracks} contextArtist={artist} />
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
    if (tracksLoading) return <p className="text-[var(--color-text-muted)]">Loading...</p>
    return (
      <AlbumDetailView
        artist={selectedEntry.artist}
        album={selectedEntry.album}
        tracks={tracks}
        onBack={() => setSelectedEntry(null)}
      />
    )
  }

  return (
    <div>
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          type="text"
          placeholder="Search albums..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      {loading ? (
        <p className="text-[var(--color-text-muted)]">Loading...</p>
      ) : albums.length === 0 ? (
        <p className="text-[var(--color-text-muted)]">{filterQuery ? 'No albums match your search.' : 'No albums yet.'}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {albums.map((a) => (
            <button
              key={`${a.artist}|||${a.album}`}
              onClick={() => setSelectedEntry({ artist: a.artist, album: a.album })}
              className="group text-left rounded-lg p-3 hover:bg-[var(--color-surface)] transition-colors"
            >
              <div className="relative mb-3">
                <AlbumArt url={a.album_art_url} className="shadow-lg" />
                <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-10 h-10 rounded-full bg-[var(--color-accent)] flex items-center justify-center shadow-lg">
                    <Play size={18} className="text-white ml-0.5" fill="white" />
                  </div>
                </div>
              </div>
              <p className="font-medium text-sm truncate">{a.album}</p>
              <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">{a.artist}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Shared Track List with play support ---

function TrackList({ tracks, contextArtist }: { tracks: TrackRow[]; contextArtist?: string }) {
  const playTrack = usePlayerStore((s) => s.playTrack)
  const addToQueue = usePlayerStore((s) => s.addToQueue)
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const [editingTrack, setEditingTrack] = useState<TrackRow | null>(null)
  const [menuTrackId, setMenuTrackId] = useState<number | null>(null)
  const [addToPlaylistTrackId, setAddToPlaylistTrackId] = useState<number | null>(null)

  const playable = tracks.filter((t) => t.download_status === 'complete')

  function handlePlay(track: TrackRow) {
    if (track.download_status !== 'complete') return
    playTrack(track, playable)
  }

  return (
    <>
      <div className="space-y-0.5">
        {tracks.map((t, i) => {
          const isCurrent = currentTrack?.id === t.id
          const canPlay = t.download_status === 'complete'
          return (
            <SwipeableTrackRow key={t.id} onSwipeRight={() => canPlay && addToQueue(t)} disabled={!canPlay}>
            <div
              className={`flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors group ${
                isCurrent ? 'bg-[var(--color-accent-dim)]' : 'hover:bg-[var(--color-surface)]'
              } ${!canPlay ? 'opacity-40' : ''}`}
            >
              {/* Track number / play button */}
              <button
                onClick={() => handlePlay(t)}
                disabled={!canPlay}
                className="w-6 text-center text-sm text-[var(--color-text-muted)] flex-shrink-0"
              >
                {isCurrent && isPlaying ? (
                  <span className="text-[var(--color-accent)] text-xs">&#9835;</span>
                ) : canPlay ? (
                  <>
                    <span className="group-hover:hidden">{t.track_number || i + 1}</span>
                    <Play size={14} fill="currentColor" className="hidden group-hover:inline text-white" />
                  </>
                ) : (
                  t.track_number || i + 1
                )}
              </button>

              {/* Title and artist — clickable to play */}
              <button
                onClick={() => handlePlay(t)}
                disabled={!canPlay}
                className="flex-1 min-w-0 text-left"
              >
                <span className={`block text-sm truncate ${isCurrent ? 'text-[var(--color-accent)] font-medium' : 'text-[var(--color-text)]'}`}>
                  {t.title}
                </span>
                {t.artist !== contextArtist && (
                  <span className="block text-xs text-[var(--color-text-muted)] truncate">{t.artist}</span>
                )}
              </button>

              <StatusDot status={t.download_status} />
              <span className="text-xs text-[var(--color-text-muted)] flex-shrink-0 tabular-nums">{formatDuration(t.duration_ms)}</span>

              {/* Three-dot menu */}
              <div className="relative flex-shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuTrackId(menuTrackId === t.id ? null : t.id) }}
                  className="p-1 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-text)] transition-all"
                >
                  <MoreHorizontal size={16} />
                </button>
                {menuTrackId === t.id && (
                  <div className="absolute right-0 top-8 z-50 w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl py-1">
                    <button
                      onClick={() => { setEditingTrack(t); setMenuTrackId(null) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
                    >
                      <Pencil size={14} /> Edit Metadata
                    </button>
                    {canPlay && (
                      <>
                        <button
                          onClick={() => { addToQueue(t); setMenuTrackId(null) }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
                        >
                          <ListPlus size={14} /> Add to Queue
                        </button>
                        <button
                          onClick={() => { setAddToPlaylistTrackId(t.id); setMenuTrackId(null) }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
                        >
                          <ListMusic size={14} /> Add to Playlist
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            </SwipeableTrackRow>
          )
        })}
      </div>

      {editingTrack && (
        <MetadataEditor
          track={editingTrack}
          onClose={() => setEditingTrack(null)}
        />
      )}

      {addToPlaylistTrackId !== null && (
        <AddToPlaylistModal
          trackId={addToPlaylistTrackId}
          onClose={() => setAddToPlaylistTrackId(null)}
        />
      )}
    </>
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
          placeholder="Search songs..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      {loading ? (
        <p className="text-[var(--color-text-muted)]">Loading...</p>
      ) : tracks.length === 0 ? (
        <p className="text-[var(--color-text-muted)]">{filterQuery ? 'No songs match.' : 'No songs yet.'}</p>
      ) : (
        <TrackList tracks={tracks} />
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
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Library</h2>
        {stats && (
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {stats.downloaded.toLocaleString()} songs &middot; {stats.artists} artists &middot; {stats.albums} albums
            {stats.pending > 0 && <span className="text-[var(--color-warning)]"> &middot; {stats.pending} pending</span>}
          </p>
        )}
      </div>

      {libraryTab === 'artists' && <ArtistsView />}
      {libraryTab === 'albums' && <AlbumsView />}
      {libraryTab === 'songs' && <SongsView />}
    </div>
  )
}
