import { useState, useEffect, useRef } from 'react'
import { Search, ChevronRight, ChevronDown, Trash2, ArrowRight, Disc3, User, Music, Loader2, X, Upload } from 'lucide-react'
import {
  getArtists, getAllLibraryAlbums, getAlbumTracks, getAllTracks, getAlbumsByArtist,
  deleteTrack, moveTrack, reorderAlbumTracks, uploadTrackArt,
  type TrackRow,
} from '../lib/api.ts'
import { MetadataEditor } from './MetadataEditor.tsx'
import { DraggableList } from './DraggableList.tsx'

type ManagerScope = 'artists' | 'albums' | 'songs'
type SortMode = 'az' | 'za' | 'tracks' | 'recent'

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

// --- Confirmation Dialog ---

function ConfirmDialog({ message, onConfirm, onCancel }: {
  message: string; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl p-5" onClick={e => e.stopPropagation()}>
        <p className="text-sm mb-4">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm bg-[var(--color-danger)] text-white rounded-lg hover:opacity-90">Delete</button>
        </div>
      </div>
    </div>
  )
}

// --- Move Track Modal ---

function MoveTrackModal({ track, onClose, onMoved }: {
  track: TrackRow; onClose: () => void; onMoved: () => void
}) {
  const [artist, setArtist] = useState(track.artist)
  const [album, setAlbum] = useState(track.album)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleMove() {
    setSaving(true)
    setError('')
    try {
      await moveTrack(track.id, artist, album)
      onMoved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h3 className="font-bold">Move Track</h3>
          <button onClick={onClose} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><X size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-[var(--color-text-muted)]">Moving: <strong>{track.title}</strong></p>
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">Artist</label>
            <input value={artist} onChange={e => setArtist(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]" />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">Album</label>
            <input value={album} onChange={e => setAlbum(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]" />
          </div>
          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-[var(--color-border)]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--color-text-muted)]">Cancel</button>
          <button onClick={handleMove} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 text-sm bg-[var(--color-accent)] text-white rounded-lg disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            Move
          </button>
        </div>
      </div>
    </div>
  )
}

// --- Album Art Upload Button ---

function AlbumArtUpload({ trackId, onUploaded }: { trackId: number; onUploaded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await uploadTrackArt(trackId, file)
      onUploaded()
    } catch (err) {
      console.error('Art upload failed:', err)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors disabled:opacity-50"
      >
        {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
        {uploading ? 'Uploading...' : 'Upload Art'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </>
  )
}

// --- Albums Manager ---

function AlbumsManager() {
  const [filterQuery, setFilterQuery] = useState('')
  const debouncedQuery = useDebounce(filterQuery, 300)
  const [albums, setAlbums] = useState<{ album: string; artist: string; track_count: number; album_art_url: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedAlbum, setExpandedAlbum] = useState<{ artist: string; album: string } | null>(null)
  const [albumTracks, setAlbumTracks] = useState<TrackRow[]>([])
  const [tracksLoading, setTracksLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<TrackRow | null>(null)
  const [movingTrack, setMovingTrack] = useState<TrackRow | null>(null)
  const [editingTrack, setEditingTrack] = useState<TrackRow | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('az')

  useEffect(() => {
    setLoading(true)
    getAllLibraryAlbums(debouncedQuery || undefined)
      .then(r => {
        setAlbums(r.albums)
        setLoading(false)
      })
      .catch(console.error)
  }, [debouncedQuery])

  const sortedAlbums = [...albums].sort((a, b) => {
    if (sortMode === 'az') return a.album.localeCompare(b.album)
    if (sortMode === 'za') return b.album.localeCompare(a.album)
    if (sortMode === 'tracks') return b.track_count - a.track_count
    return 0
  })

  function loadAlbumTracks(artist: string, album: string) {
    if (expandedAlbum?.artist === artist && expandedAlbum?.album === album) {
      setExpandedAlbum(null)
      return
    }
    setExpandedAlbum({ artist, album })
    setTracksLoading(true)
    getAlbumTracks(artist, album)
      .then(r => { setAlbumTracks(r.tracks); setTracksLoading(false) })
      .catch(console.error)
  }

  function refreshAlbumTracks() {
    if (!expandedAlbum) return
    getAlbumTracks(expandedAlbum.artist, expandedAlbum.album)
      .then(r => setAlbumTracks(r.tracks))
      .catch(console.error)
    getAllLibraryAlbums(debouncedQuery || undefined)
      .then(r => setAlbums(r.albums))
      .catch(console.error)
  }

  async function handleDeleteTrack(track: TrackRow) {
    await deleteTrack(track.id)
    setConfirmDelete(null)
    refreshAlbumTracks()
  }

  async function handleReorder(newTracks: TrackRow[]) {
    if (!expandedAlbum) return
    setAlbumTracks(newTracks)
    await reorderAlbumTracks(expandedAlbum.artist, expandedAlbum.album, newTracks.map(t => t.id))
  }

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="text" placeholder="Filter albums..." value={filterQuery}
            onChange={e => setFilterQuery(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <select
          value={sortMode} onChange={e => setSortMode(e.target.value as SortMode)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none"
        >
          <option value="az">A-Z</option>
          <option value="za">Z-A</option>
          <option value="tracks">Track Count</option>
        </select>
      </div>

      {loading ? (
        <p className="text-[var(--color-text-muted)]">Loading...</p>
      ) : (
        <div className="space-y-1">
          {sortedAlbums.map(a => {
            const isExpanded = expandedAlbum?.artist === a.artist && expandedAlbum?.album === a.album
            return (
              <div key={`${a.artist}|||${a.album}`}>
                <button
                  onClick={() => loadAlbumTracks(a.artist, a.album)}
                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--color-surface)] transition-colors text-left"
                >
                  {a.album_art_url ? (
                    <img src={a.album_art_url} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-[var(--color-surface-2)] flex items-center justify-center flex-shrink-0">
                      <Disc3 size={16} className="text-[var(--color-text-muted)]" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{a.album}</p>
                    <p className="text-xs text-[var(--color-text-muted)] truncate">{a.artist} &middot; {a.track_count} tracks</p>
                  </div>
                  {isExpanded ? <ChevronDown size={16} className="text-[var(--color-text-muted)]" /> : <ChevronRight size={16} className="text-[var(--color-text-muted)]" />}
                </button>

                {isExpanded && (
                  <div className="ml-4 mr-2 mt-1 mb-3 border-l-2 border-[var(--color-border)] pl-3">
                    {/* Album header with art upload */}
                    <div className="flex items-center gap-3 mb-2 py-2">
                      <div className="w-16 h-16 rounded-lg bg-[var(--color-surface-2)] overflow-hidden flex-shrink-0">
                        {a.album_art_url ? (
                          <img src={a.album_art_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Disc3 size={24} className="text-[var(--color-text-muted)]" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{a.album}</p>
                        <p className="text-xs text-[var(--color-text-muted)] truncate">{a.artist}</p>
                        <div className="mt-1.5">
                          {albumTracks.length > 0 && (
                            <AlbumArtUpload trackId={albumTracks[0].id} onUploaded={refreshAlbumTracks} />
                          )}
                        </div>
                      </div>
                    </div>

                    {tracksLoading ? (
                      <p className="text-xs text-[var(--color-text-muted)] py-2">Loading tracks...</p>
                    ) : (
                      <DraggableList
                        items={albumTracks}
                        keyExtractor={t => t.id}
                        onReorder={handleReorder}
                        renderItem={(t) => (
                          <div className="flex items-center gap-2 py-1.5 group">
                            <button
                              onClick={() => setEditingTrack(t)}
                              className="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-[var(--color-accent)] transition-colors"
                            >
                              <span className="w-6 text-xs text-[var(--color-text-muted)] text-center flex-shrink-0">
                                {t.track_number || '-'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm truncate">{t.title}</p>
                                <p className="text-xs text-[var(--color-text-muted)] truncate">{t.artist}</p>
                              </div>
                            </button>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={(e) => { e.stopPropagation(); setMovingTrack(t) }} title="Move to album"
                                className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                                <ArrowRight size={12} />
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(t) }} title="Delete"
                                className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        )}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editingTrack && (
        <MetadataEditor
          track={editingTrack}
          onClose={() => setEditingTrack(null)}
          onSaved={() => { setEditingTrack(null); refreshAlbumTracks() }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.title}" by ${confirmDelete.artist}? This will permanently remove the file from disk.`}
          onConfirm={() => handleDeleteTrack(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {movingTrack && (
        <MoveTrackModal
          track={movingTrack}
          onClose={() => setMovingTrack(null)}
          onMoved={refreshAlbumTracks}
        />
      )}
    </div>
  )
}

// --- Artists Manager ---

function ArtistsManager() {
  const [artists, setArtists] = useState<{ artist: string; track_count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [filterQuery, setFilterQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('az')
  const [expandedArtist, setExpandedArtist] = useState<string | null>(null)
  const [artistAlbums, setArtistAlbums] = useState<{ album: string; track_count: number; album_art_url: string }[]>([])
  const [albumsLoading, setAlbumsLoading] = useState(false)
  const [expandedAlbum, setExpandedAlbum] = useState<string | null>(null)
  const [albumTracks, setAlbumTracks] = useState<TrackRow[]>([])
  const [tracksLoading, setTracksLoading] = useState(false)
  const [editingTrack, setEditingTrack] = useState<TrackRow | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TrackRow | null>(null)
  const [movingTrack, setMovingTrack] = useState<TrackRow | null>(null)

  useEffect(() => {
    getArtists().then(r => { setArtists(r.artists); setLoading(false) }).catch(console.error)
  }, [])

  const filtered = artists.filter(a =>
    !filterQuery || a.artist.toLowerCase().includes(filterQuery.toLowerCase())
  )

  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === 'az') return a.artist.localeCompare(b.artist)
    if (sortMode === 'za') return b.artist.localeCompare(a.artist)
    if (sortMode === 'tracks') return b.track_count - a.track_count
    return 0
  })

  function toggleArtist(artist: string) {
    if (expandedArtist === artist) {
      setExpandedArtist(null)
      setExpandedAlbum(null)
      return
    }
    setExpandedArtist(artist)
    setExpandedAlbum(null)
    setAlbumsLoading(true)
    getAlbumsByArtist(artist)
      .then(r => { setArtistAlbums(r.albums); setAlbumsLoading(false) })
      .catch(console.error)
  }

  function toggleAlbum(artist: string, album: string) {
    if (expandedAlbum === album) {
      setExpandedAlbum(null)
      return
    }
    setExpandedAlbum(album)
    setTracksLoading(true)
    getAlbumTracks(artist, album)
      .then(r => { setAlbumTracks(r.tracks); setTracksLoading(false) })
      .catch(console.error)
  }

  function refreshTracks() {
    if (!expandedArtist || !expandedAlbum) return
    getAlbumTracks(expandedArtist, expandedAlbum)
      .then(r => setAlbumTracks(r.tracks))
      .catch(console.error)
  }

  async function handleDeleteTrack(track: TrackRow) {
    await deleteTrack(track.id)
    setConfirmDelete(null)
    refreshTracks()
    getArtists().then(r => setArtists(r.artists)).catch(console.error)
  }

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="text" placeholder="Filter artists..." value={filterQuery}
            onChange={e => setFilterQuery(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <select
          value={sortMode} onChange={e => setSortMode(e.target.value as SortMode)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none"
        >
          <option value="az">A-Z</option>
          <option value="za">Z-A</option>
          <option value="tracks">Track Count</option>
        </select>
      </div>

      {loading ? (
        <p className="text-[var(--color-text-muted)]">Loading...</p>
      ) : (
        <div className="space-y-0.5">
          {sorted.map(a => (
            <div key={a.artist}>
              <button
                onClick={() => toggleArtist(a.artist)}
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--color-surface)] transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-full bg-[var(--color-surface-2)] flex items-center justify-center flex-shrink-0">
                  <User size={16} className="text-[var(--color-text-muted)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.artist}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{a.track_count} tracks</p>
                </div>
                {expandedArtist === a.artist
                  ? <ChevronDown size={16} className="text-[var(--color-text-muted)]" />
                  : <ChevronRight size={16} className="text-[var(--color-text-muted)]" />
                }
              </button>

              {expandedArtist === a.artist && (
                <div className="ml-4 mr-2 mt-1 mb-3 border-l-2 border-[var(--color-border)] pl-3">
                  {albumsLoading ? (
                    <p className="text-xs text-[var(--color-text-muted)] py-2">Loading albums...</p>
                  ) : (
                    <div className="space-y-0.5">
                      {artistAlbums.map(alb => (
                        <div key={alb.album}>
                          <button
                            onClick={() => toggleAlbum(a.artist, alb.album)}
                            className="w-full flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--color-surface)] transition-colors text-left"
                          >
                            {alb.album_art_url ? (
                              <img src={alb.album_art_url} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-8 h-8 rounded bg-[var(--color-surface-2)] flex items-center justify-center flex-shrink-0">
                                <Disc3 size={12} className="text-[var(--color-text-muted)]" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm truncate">{alb.album}</p>
                              <p className="text-xs text-[var(--color-text-muted)]">{alb.track_count} tracks</p>
                            </div>
                            {expandedAlbum === alb.album
                              ? <ChevronDown size={14} className="text-[var(--color-text-muted)]" />
                              : <ChevronRight size={14} className="text-[var(--color-text-muted)]" />
                            }
                          </button>

                          {expandedAlbum === alb.album && (
                            <div className="ml-3 border-l-2 border-[var(--color-border)] pl-3 mt-1 mb-2">
                              {/* Album art upload */}
                              <div className="flex items-center gap-2 mb-2">
                                {albumTracks.length > 0 && (
                                  <AlbumArtUpload trackId={albumTracks[0].id} onUploaded={refreshTracks} />
                                )}
                              </div>

                              {tracksLoading ? (
                                <p className="text-xs text-[var(--color-text-muted)] py-2">Loading tracks...</p>
                              ) : (
                                <div className="space-y-0.5">
                                  {albumTracks.map(t => (
                                    <div key={t.id} className="flex items-center gap-2 py-1.5 group">
                                      <button
                                        onClick={() => setEditingTrack(t)}
                                        className="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-[var(--color-accent)] transition-colors"
                                      >
                                        <span className="w-5 text-xs text-[var(--color-text-muted)] text-center flex-shrink-0">
                                          {t.track_number || '-'}
                                        </span>
                                        <p className="text-sm truncate flex-1">{t.title}</p>
                                      </button>
                                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => setMovingTrack(t)} title="Move"
                                          className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                                          <ArrowRight size={12} />
                                        </button>
                                        <button onClick={() => setConfirmDelete(t)} title="Delete"
                                          className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]">
                                          <Trash2 size={12} />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                      {artistAlbums.length === 0 && (
                        <p className="text-xs text-[var(--color-text-muted)] py-2">No albums found</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editingTrack && (
        <MetadataEditor
          track={editingTrack}
          onClose={() => setEditingTrack(null)}
          onSaved={() => { setEditingTrack(null); refreshTracks() }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.title}" by ${confirmDelete.artist}?`}
          onConfirm={() => handleDeleteTrack(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {movingTrack && (
        <MoveTrackModal
          track={movingTrack}
          onClose={() => setMovingTrack(null)}
          onMoved={() => { refreshTracks(); getArtists().then(r => setArtists(r.artists)).catch(console.error) }}
        />
      )}
    </div>
  )
}

// --- Songs Manager ---

function SongsManager() {
  const [tracks, setTracks] = useState<TrackRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filterQuery, setFilterQuery] = useState('')
  const debouncedQuery = useDebounce(filterQuery, 300)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<TrackRow | null>(null)
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false)
  const [editingTrack, setEditingTrack] = useState<TrackRow | null>(null)

  useEffect(() => {
    setLoading(true)
    getAllTracks().then(r => { setTracks(r.tracks); setLoading(false) }).catch(console.error)
  }, [])

  function refreshTracks() {
    getAllTracks().then(r => setTracks(r.tracks)).catch(console.error)
  }

  const filtered = tracks.filter(t => {
    if (!debouncedQuery) return true
    const q = debouncedQuery.toLowerCase()
    return t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q)
  }).sort((a, b) => a.title.localeCompare(b.title))

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(t => t.id)))
    }
  }

  async function handleDeleteTrack(track: TrackRow) {
    await deleteTrack(track.id)
    setTracks(prev => prev.filter(t => t.id !== track.id))
    setSelected(prev => { const next = new Set(prev); next.delete(track.id); return next })
    setConfirmDelete(null)
  }

  async function handleBatchDelete() {
    for (const id of selected) {
      await deleteTrack(id)
    }
    setTracks(prev => prev.filter(t => !selected.has(t.id)))
    setSelected(new Set())
    setConfirmBatchDelete(false)
  }

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="text" placeholder="Filter songs..." value={filterQuery}
            onChange={e => setFilterQuery(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
          <span className="text-sm text-[var(--color-text-muted)]">{selected.size} selected</span>
          <button
            onClick={() => setConfirmBatchDelete(true)}
            className="flex items-center gap-1 text-sm text-[var(--color-danger)] hover:opacity-80"
          >
            <Trash2 size={14} /> Delete Selected
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] ml-auto"
          >
            Clear
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-[var(--color-text-muted)]">Loading...</p>
      ) : (
        <div>
          {filtered.length > 0 && (
            <div className="flex items-center gap-2 mb-2 px-3">
              <input
                type="checkbox"
                checked={selected.size === filtered.length && filtered.length > 0}
                onChange={toggleSelectAll}
                className="rounded accent-[var(--color-accent)]"
              />
              <span className="text-xs text-[var(--color-text-muted)]">{filtered.length} songs</span>
            </div>
          )}
          <div className="space-y-0.5">
            {filtered.map(t => (
              <div key={t.id} className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-[var(--color-surface)] transition-colors group">
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggleSelect(t.id)}
                  className="rounded accent-[var(--color-accent)] flex-shrink-0"
                />
                <button
                  onClick={() => setEditingTrack(t)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-[var(--color-accent)] transition-colors"
                >
                  <img src={`/api/stream/art/${t.id}`} alt="" className="w-8 h-8 rounded object-cover bg-[var(--color-surface-2)] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{t.title}</p>
                    <p className="text-xs text-[var(--color-text-muted)] truncate">{t.artist} &middot; {t.album}</p>
                  </div>
                </button>
                <button
                  onClick={() => setConfirmDelete(t)}
                  className="p-1 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-danger)] transition-all flex-shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {editingTrack && (
        <MetadataEditor
          track={editingTrack}
          onClose={() => setEditingTrack(null)}
          onSaved={() => { setEditingTrack(null); refreshTracks() }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.title}" by ${confirmDelete.artist}? This will permanently remove the file from disk.`}
          onConfirm={() => handleDeleteTrack(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmBatchDelete && (
        <ConfirmDialog
          message={`Delete ${selected.size} selected tracks? This will permanently remove the files from disk.`}
          onConfirm={handleBatchDelete}
          onCancel={() => setConfirmBatchDelete(false)}
        />
      )}
    </div>
  )
}

// --- Main Manager Page ---

export function ManagerPage() {
  const [scope, setScope] = useState<ManagerScope>('albums')

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Library</h1>

      {/* Scope selector */}
      <div className="flex gap-2 mb-4 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {([
          { key: 'artists', label: 'Artists', icon: User },
          { key: 'albums', label: 'Albums', icon: Disc3 },
          { key: 'songs', label: 'Songs', icon: Music },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setScope(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex-shrink-0 ${
              scope === key
                ? 'bg-[var(--color-accent)] text-white'
                : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {scope === 'artists' && <ArtistsManager />}
      {scope === 'albums' && <AlbumsManager />}
      {scope === 'songs' && <SongsManager />}
    </div>
  )
}
