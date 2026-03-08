import { useState, useEffect, useRef } from 'react'
import { Download, Check, AlertCircle, Play, ChevronDown, ChevronUp } from 'lucide-react'
import { useAppStore } from '../lib/store.ts'
import { startBatchDownload, getLibraryStats, type LibraryStats } from '../lib/api.ts'

interface BatchProgress {
  total: number
  completed: number
  failed: number
  current: string
  done: boolean
  errors: { trackId: number; title: string; error: string }[]
}

export function DownloadsPage() {
  const batchJobId = useAppStore((s) => s.batchJobId)
  const setBatchJobId = useAppStore((s) => s.setBatchJobId)
  const [progress, setProgress] = useState<BatchProgress | null>(null)
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [starting, setStarting] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Load library stats
  useEffect(() => {
    getLibraryStats().then(setStats).catch(console.error)
  }, [])

  // Refresh stats when download completes
  useEffect(() => {
    if (progress?.done) {
      getLibraryStats().then(setStats).catch(console.error)
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

  async function handleStartDownload() {
    setStarting(true)
    setProgress(null)
    try {
      const { jobId } = await startBatchDownload()
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
  }

  const isActive = batchJobId && (!progress || !progress.done)
  const isDone = progress?.done
  const pct = progress ? Math.round(((progress.completed + progress.failed) / progress.total) * 100) : 0

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Downloads</h2>

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
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 mb-4">
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

          {/* Current track */}
          {progress.current && !progress.done && (
            <p className="text-sm text-[var(--color-text-muted)] truncate mb-2">
              {progress.current}
            </p>
          )}

          {/* Stats line */}
          <div className="flex gap-4 text-sm text-[var(--color-text-muted)]">
            <span className="text-[var(--color-success)]">{progress.completed} completed</span>
            {progress.failed > 0 && (
              <span className="text-[var(--color-danger)]">{progress.failed} failed</span>
            )}
            <span>~{((progress.completed * 5) / 1024).toFixed(1)} GB</span>
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

          {/* Done actions */}
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

      {/* Start download button */}
      {!isActive && stats && stats.pending > 0 && (
        <button
          onClick={handleStartDownload}
          disabled={starting}
          className="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-6 py-3 font-medium text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
        >
          <Play size={18} />
          {starting ? 'Starting...' : `Download ${stats.pending} Pending Tracks`}
        </button>
      )}

      {/* Nothing to do */}
      {!isActive && !isDone && stats && stats.pending === 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-[var(--color-text-muted)]">
          <Check size={32} className="mx-auto mb-2 text-[var(--color-success)]" />
          <p>All tracks downloaded. Nothing pending.</p>
        </div>
      )}
    </div>
  )
}
