import { useState, useEffect, useRef } from 'react'
import {
  ChevronLeft, Download, Music, Trash2, Loader2, Check, AlertCircle,
  CheckSquare, Square, Plus, Play, Shuffle, Pencil, X, ChevronUp, ChevronDown,
} from 'lucide-react'
import { useAppStore } from '../lib/store.ts'
import { usePlayerStore } from '../lib/player.ts'
import {
  getPlaylists, getPlaylistDetail, exportPlaylistM3U, deletePlaylist,
  downloadTrack, startBatchDownload, createPlaylist, renamePlaylist,
  removeTrackFromPlaylist, reorderPlaylistTracks,
  type PlaylistWithCount, type TrackRow,
} from '../lib/api.ts'

export function PlaylistsPage() {
  const selectedId = useAppStore((s) => s.selectedPlaylistId)
  const setSelectedId = useAppStore((s) => s.setSelectedPlaylistId)

  const [playlists, setPlaylists] = useState<PlaylistWithCount[]>([])
  const [tracks, setTracks] = useState<TrackRow[]>([])
  const [playlistName, setPlaylistName] = useState('')
  const [loading, setLoading] = useState(true)
  const [downloadingIds, setDownloadingIds] = useState<Set<number>>(new Set())
  const [selectedTracks, setSelectedTracks] = useState<Set<number>>(new Set())
  const [batchJobId, setBatchJobId] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState<{
    total: number; completed: number; failed: number; current: string; done: boolean
  } | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Create playlist state
  const [showCreate, setShowCreate] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')

  // Rename state
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    if (!selectedId) {
      setLoading(true)
      getPlaylists().then((r) => { setPlaylists(r.playlists); setLoading(false) }).catch(console.error)
    } else {
      loadPlaylistDetail()
    }
  }, [selectedId])

  // SSE for batch progress
  useEffect(() => {
    if (!batchJobId) return
    const es = new EventSource(`/api/download/progress/${batchJobId}`)
    eventSourceRef.current = es
    es.onmessage = (event) => {
      const data = JSON.parse(event.data)
      setBatchProgress(data)
      if (data.done) {
        es.close()
        setBatchJobId(null)
        setDownloadingIds(new Set())
        setSelectedTracks(new Set())
        if (selectedId) loadPlaylistDetail()
      }
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [batchJobId, selectedId])

  function loadPlaylistDetail() {
    if (!selectedId) return
    setLoading(true)
    getPlaylistDetail(selectedId).then((r) => {
      setPlaylistName(r.playlist.name)
      setTracks(r.tracks)
      setLoading(false)
    }).catch(console.error)
  }

  function formatDuration(ms: number) {
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  async function handleDownloadTrack(trackId: number) {
    setDownloadingIds((prev) => new Set(prev).add(trackId))
    try {
      await downloadTrack(trackId)
      loadPlaylistDetail()
    } catch (err) {
      console.error(err)
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev)
        next.delete(trackId)
        return next
      })
    }
  }

  async function handleDownloadSelected() {
    const ids = [...selectedTracks]
    if (ids.length === 0) return
    setDownloadingIds(new Set(ids))
    try {
      const result = await startBatchDownload(ids)
      if (result.jobId) {
        setBatchJobId(result.jobId)
        setBatchProgress({ total: result.total, completed: 0, failed: 0, current: 'Starting...', done: false })
      }
    } catch (err) {
      console.error(err)
      setDownloadingIds(new Set())
    }
  }

  function toggleTrackSelection(trackId: number) {
    setSelectedTracks((prev) => {
      const next = new Set(prev)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      return next
    })
  }

  function selectAllPending() {
    const pendingIds = tracks.filter((t) => t.download_status === 'pending' || t.download_status === 'failed').map((t) => t.id)
    if (pendingIds.every((id) => selectedTracks.has(id))) {
      setSelectedTracks(new Set())
    } else {
      setSelectedTracks(new Set(pendingIds))
    }
  }

  async function handleExport(id: number) {
    try {
      await exportPlaylistM3U(id)
      alert('M3U exported to your music directory')
    } catch (err) {
      console.error(err)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this playlist?')) return
    try {
      await deletePlaylist(id)
      setPlaylists((prev) => prev.filter((p) => p.id !== id))
      if (selectedId === id) setSelectedId(null)
    } catch (err) {
      console.error(err)
    }
  }

  async function handleCreatePlaylist() {
    if (!newPlaylistName.trim()) return
    try {
      await createPlaylist(newPlaylistName.trim())
      setNewPlaylistName('')
      setShowCreate(false)
      getPlaylists().then((r) => setPlaylists(r.playlists)).catch(console.error)
    } catch (err) {
      console.error(err)
    }
  }

  async function handleRename() {
    if (!selectedId || !renameValue.trim()) return
    try {
      await renamePlaylist(selectedId, renameValue.trim())
      setPlaylistName(renameValue.trim())
      setRenaming(false)
    } catch (err) {
      console.error(err)
    }
  }

  async function handleRemoveTrack(trackId: number) {
    if (!selectedId) return
    try {
      await removeTrackFromPlaylist(selectedId, trackId)
      setTracks((prev) => prev.filter((t) => t.id !== trackId))
    } catch (err) {
      console.error(err)
    }
  }

  async function handleMoveTrack(index: number, direction: 'up' | 'down') {
    if (!selectedId) return
    const newTracks = [...tracks]
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= newTracks.length) return
    ;[newTracks[index], newTracks[swapIndex]] = [newTracks[swapIndex], newTracks[index]]
    setTracks(newTracks)
    try {
      await reorderPlaylistTracks(selectedId, newTracks.map((t) => t.id))
    } catch (err) {
      console.error(err)
      loadPlaylistDetail() // revert on error
    }
  }

  // Player controls
  const playPlaylist = usePlayerStore((s) => s.playPlaylist)
  const playTrack = usePlayerStore((s) => s.playTrack)
  const currentTrack = usePlayerStore((s) => s.currentTrack)

  if (loading) return <p className="text-[var(--color-text-muted)]">Loading...</p>

  if (selectedId) {
    const pendingTracks = tracks.filter((t) => t.download_status === 'pending' || t.download_status === 'failed')
    const hasSelectable = pendingTracks.length > 0
    const playable = tracks.filter((t) => t.download_status === 'complete')

    return (
      <div>
        <button
          onClick={() => { setSelectedId(null); setSelectedTracks(new Set()); setRenaming(false) }}
          className="mb-4 flex items-center gap-1 text-sm text-[var(--color-accent)] hover:underline"
        >
          <ChevronLeft size={16} /> Back
        </button>

        {/* Playlist header */}
        <div className="mb-4">
          {renaming ? (
            <div className="flex items-center gap-2 mb-2">
              <input
                autoFocus
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-lg font-bold outline-none focus:border-[var(--color-accent)]"
              />
              <button onClick={handleRename} className="text-[var(--color-accent)] text-sm font-medium">Save</button>
              <button onClick={() => setRenaming(false)} className="text-[var(--color-text-muted)] text-sm">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xl font-bold">{playlistName}</h2>
              <button
                onClick={() => { setRenaming(true); setRenameValue(playlistName) }}
                className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                <Pencil size={14} />
              </button>
            </div>
          )}

          <p className="text-sm text-[var(--color-text-muted)] mb-3">
            {tracks.length} tracks &middot; {playable.length} downloaded
          </p>

          {/* Play/Shuffle buttons */}
          {playable.length > 0 && (
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => playPlaylist(playable)}
                className="flex items-center gap-2 rounded-full bg-[var(--color-accent)] px-6 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] transition-colors"
              >
                <Play size={18} fill="white" /> Play
              </button>
              <button
                onClick={() => {
                  const shuffled = [...playable].sort(() => Math.random() - 0.5)
                  playPlaylist(shuffled)
                }}
                className="flex items-center gap-2 rounded-full border border-[var(--color-border)] px-5 py-2.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
              >
                <Shuffle size={16} /> Shuffle
              </button>
            </div>
          )}

          {hasSelectable && (
            <div className="flex items-center gap-2">
              <button
                onClick={selectAllPending}
                className="text-sm text-[var(--color-accent)] hover:underline"
              >
                {pendingTracks.every((t) => selectedTracks.has(t.id)) ? 'Deselect All' : 'Select All Pending'}
              </button>
              {selectedTracks.size > 0 && (
                <button
                  onClick={handleDownloadSelected}
                  disabled={!!batchJobId}
                  className="rounded-lg bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
                >
                  Download {selectedTracks.size} Selected
                </button>
              )}
            </div>
          )}
        </div>

        {batchProgress && (
          <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="mb-2 h-2 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
              <div
                className="h-full bg-[var(--color-accent)] transition-all duration-300"
                style={{ width: `${((batchProgress.completed + batchProgress.failed) / batchProgress.total) * 100}%` }}
              />
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">
              {batchProgress.completed + batchProgress.failed} / {batchProgress.total}
              {batchProgress.failed > 0 && <span className="text-[var(--color-danger)]"> ({batchProgress.failed} failed)</span>}
            </p>
            {batchProgress.current && <p className="text-sm text-[var(--color-text-muted)] mt-1">Currently: {batchProgress.current}</p>}
            {batchProgress.done && <p className="text-sm text-[var(--color-success)] mt-1">Complete!</p>}
          </div>
        )}

        <div className="space-y-1">
          {tracks.map((t, i) => {
            const isPending = t.download_status === 'pending' || t.download_status === 'failed'
            const isDownloading = downloadingIds.has(t.id)
            const isComplete = t.download_status === 'complete'
            const isCurrent = currentTrack?.id === t.id

            return (
              <div
                key={t.id}
                className={`flex items-center gap-3 rounded-lg px-4 py-2 transition-colors group ${
                  isCurrent ? 'bg-[var(--color-accent-dim)]' : 'hover:bg-[var(--color-surface)]'
                }`}
              >
                {/* Selection checkbox for pending/failed tracks */}
                {isPending && !isDownloading ? (
                  <button onClick={() => toggleTrackSelection(t.id)} className="shrink-0">
                    {selectedTracks.has(t.id)
                      ? <CheckSquare size={16} className="text-[var(--color-accent)]" />
                      : <Square size={16} className="text-[var(--color-text-muted)]" />}
                  </button>
                ) : (
                  <span className="w-4" />
                )}

                <span className="w-6 text-right text-sm text-[var(--color-text-muted)]">{i + 1}</span>

                {/* Album art thumbnail */}
                {isComplete && (
                  <img
                    src={`/api/stream/art/${t.id}`}
                    alt=""
                    className="w-10 h-10 rounded object-cover bg-[var(--color-surface-2)] flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                {!isComplete && <Music size={16} className="text-[var(--color-text-muted)]" />}

                <button
                  onClick={() => isComplete && playTrack(t, playable)}
                  disabled={!isComplete}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className={`truncate text-sm ${isCurrent ? 'text-[var(--color-accent)] font-medium' : ''}`}>{t.title}</div>
                  <div className="text-xs text-[var(--color-text-muted)] truncate">{t.artist}</div>
                </button>

                {/* Status/action */}
                {isDownloading ? (
                  <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
                ) : isComplete ? (
                  <Check size={16} className="text-[var(--color-success)]" />
                ) : t.download_status === 'failed' ? (
                  <button
                    onClick={() => handleDownloadTrack(t.id)}
                    className="p-1 rounded hover:bg-[var(--color-surface-2)] transition-colors"
                    title={`Failed: ${t.error_message}. Click to retry.`}
                  >
                    <AlertCircle size={16} className="text-[var(--color-danger)]" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleDownloadTrack(t.id)}
                    className="p-1 rounded hover:bg-[var(--color-surface-2)] transition-colors"
                    title="Download this track"
                  >
                    <Download size={16} className="text-[var(--color-text-muted)]" />
                  </button>
                )}

                <span className="text-sm text-[var(--color-text-muted)] tabular-nums">{formatDuration(t.duration_ms)}</span>

                {/* Reorder buttons */}
                <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleMoveTrack(i, 'up')}
                    disabled={i === 0}
                    className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-20"
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    onClick={() => handleMoveTrack(i, 'down')}
                    disabled={i === tracks.length - 1}
                    className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-20"
                  >
                    <ChevronDown size={12} />
                  </button>
                </div>

                {/* Remove from playlist */}
                <button
                  onClick={() => handleRemoveTrack(t.id)}
                  className="p-1 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-danger)] transition-all"
                  title="Remove from playlist"
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Playlists</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          <Plus size={16} /> Create
        </button>
      </div>

      {/* Create playlist inline */}
      {showCreate && (
        <div className="flex items-center gap-2 mb-4">
          <input
            autoFocus
            type="text"
            value={newPlaylistName}
            onChange={(e) => setNewPlaylistName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreatePlaylist()}
            placeholder="Playlist name"
            className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <button
            onClick={handleCreatePlaylist}
            disabled={!newPlaylistName.trim()}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            Create
          </button>
          <button
            onClick={() => { setShowCreate(false); setNewPlaylistName('') }}
            className="text-sm text-[var(--color-text-muted)]"
          >
            Cancel
          </button>
        </div>
      )}

      {playlists.length === 0 ? (
        <p className="text-[var(--color-text-muted)]">No playlists yet. Create one or import from Spotify.</p>
      ) : (
        <div className="grid gap-2">
          {playlists.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
            >
              <button onClick={() => setSelectedId(p.id)} className="flex-1 text-left hover:text-[var(--color-accent)] transition-colors">
                <div className="font-medium">{p.name}</div>
                <div className="text-sm text-[var(--color-text-muted)]">{p.trackCount} tracks</div>
              </button>
              <button
                onClick={() => handleExport(p.id)}
                className="p-2 rounded hover:bg-[var(--color-surface-2)] transition-colors"
                title="Export M3U"
              >
                <Download size={16} className="text-[var(--color-text-muted)]" />
              </button>
              <button
                onClick={() => handleDelete(p.id)}
                className="p-2 rounded hover:bg-[var(--color-surface-2)] transition-colors"
                title="Delete playlist"
              >
                <Trash2 size={16} className="text-[var(--color-text-muted)]" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
