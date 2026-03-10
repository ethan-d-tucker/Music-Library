import { useState, useEffect, useRef } from 'react'
import { Download, Check, AlertCircle, Play, ChevronDown, ChevronUp, X, RotateCcw, Search, Loader2 } from 'lucide-react'
import { useAppStore } from '../lib/store.ts'
import {
  startBatchDownload, getLibraryStats, getPendingDownloads, getFailedDownloads,
  cancelPendingTrack, cancelAllPending, retryFailedDownloads,
  type LibraryStats, type TrackRow,
} from '../lib/api.ts'

interface BatchProgress {
  total: number
  completed: number
  failed: number
  current: string
  done: boolean
  errors: { trackId: number; title: string; error: string }[]
}

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function DownloadsPage() {
  const batchJobId = useAppStore((s) => s.batchJobId)
  const setBatchJobId = useAppStore((s) => s.setBatchJobId)
  const [progress, setProgress] = useState<BatchProgress | null>(null)
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [starting, setStarting] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Pending/failed track lists
  const [pendingTracks, setPendingTracks] = useState<TrackRow[]>([])
  const [failedTracks, setFailedTracks] = useState<TrackRow[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [filterQuery, setFilterQuery] = useState('')
  const debouncedFilter = useDebounce(filterQuery, 200)
  const [activeTab, setActiveTab] = useState<'pending' | 'failed'>('pending')
  const [loadingTracks, setLoadingTracks] = useState(false)

  // Load library stats
  useEffect(() => {
    getLibraryStats().then(setStats).catch(console.error)
  }, [])

  // Load pending/failed tracks
  useEffect(() => {
    loadTracks()
  }, [])

  function loadTracks() {
    setLoadingTracks(true)
    Promise.all([getPendingDownloads(), getFailedDownloads()])
      .then(([p, f]) => {
        setPendingTracks(p.tracks)
        setFailedTracks(f.tracks)
        setLoadingTracks(false)
      })
      .catch(console.error)
  }

  // Refresh stats when download completes
  useEffect(() => {
    if (progress?.done) {
      getLibraryStats().then(setStats).catch(console.error)
      loadTracks()
    }
  }, [progress?.done])

  // SSE for batch download progress
  useEffect(() => {
    if (!batchJobId) return
    const es = new EventSource(`/api/download/progress/${batchJobId}`)
    eventSourceRef.current = es
    es.onmessage = (event) => {
      const data = JSON.parse(event.data) as BatchProgress
      setProgress(data)
      if (data.done) {
        es.close()
      }
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [batchJobId])

  async function handleStartDownload(trackIds?: number[]) {
    setStarting(true)
    setProgress(null)
    try {
      const { jobId } = await startBatchDownload(trackIds)
      setBatchJobId(jobId)
    } catch (err) {
      console.error('Failed to start downloads:', err)
    } finally {
      setStarting(false)
    }
  }

  function handleReset() {
    setBatchJobId(null)
    setProgress(null)
    setShowErrors(false)
    getLibraryStats().then(setStats).catch(console.error)
    loadTracks()
  }

  async function handleCancelTrack(id: number) {
    await cancelPendingTrack(id)
    setPendingTracks((prev) => prev.filter((t) => t.id !== id))
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next })
    getLibraryStats().then(setStats).catch(console.error)
  }

  async function handleCancelAll() {
    await cancelAllPending()
    setPendingTracks([])
    setSelectedIds(new Set())
    getLibraryStats().then(setStats).catch(console.error)
  }

  async function handleCancelSelected() {
    const ids = Array.from(selectedIds)
    await Promise.all(ids.map(cancelPendingTrack))
    setPendingTracks((prev) => prev.filter((t) => !selectedIds.has(t.id)))
    setSelectedIds(new Set())
    getLibraryStats().then(setStats).catch(console.error)
  }

  async function handleRetryFailed() {
    const { retried } = await retryFailedDownloads()
    if (retried > 0) {
      loadTracks()
      getLibraryStats().then(setStats).catch(console.error)
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(filteredTracks.map((t) => t.id)))
  }

  function deselectAll() {
    setSelectedIds(new Set())
  }

  const isActive = batchJobId && (!progress || !progress.done)
  const isDone = progress?.done
  const pct = progress ? Math.round(((progress.completed + progress.failed) / progress.total) * 100) : 0

  const currentTracks = activeTab === 'pending' ? pendingTracks : failedTracks
  const filteredTracks = debouncedFilter
    ? currentTracks.filter((t) =>
        t.title.toLowerCase().includes(debouncedFilter.toLowerCase()) ||
        t.artist.toLowerCase().includes(debouncedFilter.toLowerCase()) ||
        t.album.toLowerCase().includes(debouncedFilter.toLowerCase())
      )
    : currentTracks

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Downloads</h2>

      {/* Stats overview */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
            <div className="text-2xl font-bold text-[var(--color-accent)]">{stats.downloaded}</div>
            <div className="text-xs text-[var(--color-text-muted)] mt-1">Downloaded</div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
            <div className="text-2xl font-bold text-[var(--color-warning)]">{stats.pending}</div>
            <div className="text-xs text-[var(--color-text-muted)] mt-1">Pending</div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
            <div className="text-2xl font-bold text-[var(--color-danger)]">{stats.failed}</div>
            <div className="text-xs text-[var(--color-text-muted)] mt-1">Failed</div>
          </div>
        </div>
      )}

      {/* Active download progress */}
      {(isActive || isDone) && progress && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 mb-6">
          <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
            {isActive ? (
              <><Download size={20} className="animate-pulse text-[var(--color-accent)]" /> Downloading...</>
            ) : (
              <><Check size={20} className="text-[var(--color-success)]" /> Download Complete</>
            )}
          </h3>

          {/* Progress bar */}
          <div className="mb-3">
            <div className="flex items-center justify-between text-sm mb-2">
              <span>{progress.completed + progress.failed} / {progress.total}</span>
              <span className="text-[var(--color-text-muted)]">{pct}%</span>
            </div>
            <div className="w-full h-3 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${pct}%`,
                  background: progress.failed > 0
                    ? `linear-gradient(90deg, var(--color-accent) ${(progress.completed / progress.total) * 100}%, var(--color-danger) 0%)`
                    : 'var(--color-accent)',
                }}
              />
            </div>
          </div>

          {progress.current && !progress.done && (
            <p className="text-sm text-[var(--color-text-muted)] truncate mb-2">{progress.current}</p>
          )}

          <div className="flex gap-4 text-sm text-[var(--color-text-muted)]">
            <span className="text-[var(--color-success)]">{progress.completed} completed</span>
            {progress.failed > 0 && (
              <span className="text-[var(--color-danger)]">{progress.failed} failed</span>
            )}
          </div>

          {/* Errors */}
          {progress.errors && progress.errors.length > 0 && progress.done && (
            <div className="mt-4">
              <button
                onClick={() => setShowErrors(!showErrors)}
                className="flex items-center gap-1 text-sm text-[var(--color-danger)] hover:underline"
              >
                <AlertCircle size={14} />
                {progress.errors.length} errors
                {showErrors ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showErrors && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                  {progress.errors.map((e, i) => (
                    <div key={i} className="text-xs text-[var(--color-text-muted)] mb-1">
                      <span className="text-[var(--color-text)]">{e.title}</span>: {e.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {isDone && (
            <button
              onClick={handleReset}
              className="mt-4 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] transition-colors"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      {!isActive && (
        <div className="flex flex-wrap gap-3 mb-6">
          {stats && stats.pending > 0 && (
            <button
              onClick={() => handleStartDownload()}
              disabled={starting}
              className="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
            >
              <Play size={16} />
              {starting ? 'Starting...' : `Download All (${stats.pending})`}
            </button>
          )}
          {selectedIds.size > 0 && (
            <>
              <button
                onClick={() => handleStartDownload(Array.from(selectedIds))}
                disabled={starting}
                className="flex items-center gap-2 rounded-lg border border-[var(--color-accent)] px-4 py-2.5 text-sm text-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] transition-colors disabled:opacity-50"
              >
                <Download size={16} /> Download Selected ({selectedIds.size})
              </button>
              {activeTab === 'pending' && (
                <button
                  onClick={handleCancelSelected}
                  className="flex items-center gap-2 rounded-lg border border-[var(--color-danger)] px-4 py-2.5 text-sm text-[var(--color-danger)] hover:bg-red-500/10 transition-colors"
                >
                  <X size={16} /> Cancel Selected
                </button>
              )}
            </>
          )}
          {failedTracks.length > 0 && (
            <button
              onClick={handleRetryFailed}
              className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
            >
              <RotateCcw size={16} /> Retry Failed ({failedTracks.length})
            </button>
          )}
        </div>
      )}

      {/* Nothing pending */}
      {!isActive && !isDone && stats && stats.pending === 0 && stats.failed === 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-[var(--color-text-muted)]">
          <Check size={32} className="mx-auto mb-2 text-[var(--color-success)]" />
          <p>All tracks downloaded. Nothing pending.</p>
        </div>
      )}

      {/* Pending/Failed track lists */}
      {(pendingTracks.length > 0 || failedTracks.length > 0) && (
        <div>
          {/* Tabs */}
          <div className="flex gap-1 mb-3">
            <button
              onClick={() => { setActiveTab('pending'); setSelectedIds(new Set()); setFilterQuery('') }}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                activeTab === 'pending'
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)] font-medium'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              Pending ({pendingTracks.length})
            </button>
            <button
              onClick={() => { setActiveTab('failed'); setSelectedIds(new Set()); setFilterQuery('') }}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                activeTab === 'failed'
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)] font-medium'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              Failed ({failedTracks.length})
            </button>
          </div>

          {/* Search + select all */}
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="text"
                placeholder="Filter tracks..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-accent)]"
              />
            </div>
            <button
              onClick={selectedIds.size === filteredTracks.length ? deselectAll : selectAll}
              className="text-xs text-[var(--color-accent)] hover:underline flex-shrink-0"
            >
              {selectedIds.size === filteredTracks.length && filteredTracks.length > 0 ? 'Deselect All' : 'Select All'}
            </button>
            {activeTab === 'pending' && pendingTracks.length > 0 && (
              <button
                onClick={handleCancelAll}
                className="text-xs text-[var(--color-danger)] hover:underline flex-shrink-0"
              >
                Cancel All
              </button>
            )}
          </div>

          {/* Track list */}
          {loadingTracks ? (
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-4">
              <Loader2 size={16} className="animate-spin" /> Loading tracks...
            </div>
          ) : filteredTracks.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] py-4">
              {debouncedFilter ? 'No tracks match your filter.' : `No ${activeTab} tracks.`}
            </p>
          ) : (
            <div className="max-h-[50vh] overflow-y-auto space-y-0.5">
              {filteredTracks.map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 transition-colors ${
                    selectedIds.has(t.id) ? 'bg-[var(--color-accent-dim)]' : 'hover:bg-[var(--color-surface)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(t.id)}
                    onChange={() => toggleSelect(t.id)}
                    className="w-4 h-4 rounded border-[var(--color-border)] accent-[var(--color-accent)] flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{t.title}</div>
                    <div className="text-xs text-[var(--color-text-muted)] truncate">{t.artist} &middot; {t.album}</div>
                  </div>
                  {activeTab === 'failed' && t.error_message && (
                    <span className="text-xs text-[var(--color-danger)] truncate max-w-[200px]" title={t.error_message}>
                      {t.error_message}
                    </span>
                  )}
                  {activeTab === 'pending' && (
                    <button
                      onClick={() => handleCancelTrack(t.id)}
                      className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors flex-shrink-0"
                      title="Cancel"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
