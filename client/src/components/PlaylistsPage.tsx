import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, Download, Music, Trash2, Loader2, Check, AlertCircle, CheckSquare, Square } from 'lucide-react'
import { useAppStore } from '../lib/store.ts'
import { getPlaylists, getPlaylistDetail, exportPlaylistM3U, deletePlaylist, downloadTrack, startBatchDownload, type PlaylistWithCount, type TrackRow } from '../lib/api.ts'

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
        // Refresh track list to show updated statuses
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
      // Refresh to show updated status
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
    } catch (err) {
      console.error(err)
    }
  }

  if (loading) return <p className="text-[var(--color-text-muted)]">Loading...</p>

  if (selectedId) {
    const pendingTracks = tracks.filter((t) => t.download_status === 'pending' || t.download_status === 'failed')
    const hasSelectable = pendingTracks.length > 0

    return (
      <div>
        <button
          onClick={() => { setSelectedId(null); setSelectedTracks(new Set()) }}
          className="mb-4 flex items-center gap-1 text-sm text-[var(--color-accent)] hover:underline"
        >
          <ChevronLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-xl font-bold">{playlistName}</h2>
          {hasSelectable && (
            <div className="ml-auto flex items-center gap-2">
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

            return (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-lg px-4 py-2 hover:bg-[var(--color-surface)] transition-colors"
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
                <Music size={16} className="text-[var(--color-text-muted)]" />
                <div className="flex-1 min-w-0">
                  <div className="truncate">{t.title}</div>
                  <div className="text-sm text-[var(--color-text-muted)] truncate">{t.artist}</div>
                </div>

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

                <span className="text-sm text-[var(--color-text-muted)]">{formatDuration(t.duration_ms)}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Playlists</h2>
      {playlists.length === 0 ? (
        <p className="text-[var(--color-text-muted)]">No playlists yet. Import from Spotify to get started.</p>
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
