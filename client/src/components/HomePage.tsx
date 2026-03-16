import { useState, useEffect } from 'react'
import { Search, Download, Loader2, AlertCircle, Check, Music, Disc3, Users, Clock } from 'lucide-react'
import { useAppStore } from '../lib/store.ts'
import {
  searchDeezer, downloadDeezerTrack, getLibraryStats, getPendingDownloads, getFailedDownloads,
  retryFailedDownloads, getHomeData,
  type DeezerResult, type LibraryStats,
} from '../lib/api.ts'

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// --- Search Results ---

function DeezerResultRow({ result }: { result: DeezerResult }) {
  const [status, setStatus] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle')

  async function handleDownload() {
    setStatus('downloading')
    try {
      const r = await downloadDeezerTrack(result)
      setStatus(r.skipped ? 'done' : 'done')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--color-surface)] transition-colors">
      <img src={result.albumCoverUrl} alt="" className="w-10 h-10 rounded object-cover bg-[var(--color-surface-2)] flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{result.title}</p>
        <p className="text-xs text-[var(--color-text-muted)] truncate">{result.artist} &middot; {result.album} &middot; {formatDuration(result.duration)}</p>
      </div>
      <button
        onClick={handleDownload}
        disabled={status === 'downloading' || status === 'done'}
        className="p-2 rounded-lg transition-colors flex-shrink-0 disabled:opacity-50"
      >
        {status === 'idle' && <Download size={16} className="text-[var(--color-accent)]" />}
        {status === 'downloading' && <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />}
        {status === 'done' && <Check size={16} className="text-green-500" />}
        {status === 'error' && <AlertCircle size={16} className="text-[var(--color-danger)]" />}
      </button>
    </div>
  )
}

// --- Main ---

export function HomePage() {
  const setPage = useAppStore((s) => s.setPage)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 400)
  const [results, setResults] = useState<DeezerResult[]>([])
  const [searching, setSearching] = useState(false)
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [recentlyAdded, setRecentlyAdded] = useState<{ album: string; artist: string; album_art_url: string; track_id: number }[]>([])
  const [retrying, setRetrying] = useState(false)

  // Load dashboard data
  useEffect(() => {
    getLibraryStats().then(setStats).catch(console.error)
    getPendingDownloads().then(r => setPendingCount(r.tracks.length)).catch(console.error)
    getFailedDownloads().then(r => setFailedCount(r.tracks.length)).catch(console.error)
    getHomeData().then(r => setRecentlyAdded(r.recentlyAdded)).catch(console.error)
  }, [])

  // Search Deezer
  useEffect(() => {
    const q = debouncedQuery.trim()
    if (!q) { setResults([]); return }
    setSearching(true)
    searchDeezer(q)
      .then(r => setResults(r.results))
      .catch(console.error)
      .finally(() => setSearching(false))
  }, [debouncedQuery])

  async function handleRetryFailed() {
    setRetrying(true)
    try {
      await retryFailedDownloads()
      setFailedCount(0)
      const pending = await getPendingDownloads()
      setPendingCount(pending.tracks.length)
    } catch { }
    setRetrying(false)
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Search bar */}
      <div className="relative mb-6">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for music to download..."
          className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 pl-10 text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)] text-sm"
          autoFocus
        />
        {searching && (
          <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[var(--color-text-muted)]" />
        )}
      </div>

      {/* Search results */}
      {results.length > 0 && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
            <p className="text-xs font-medium text-[var(--color-text-muted)]">{results.length} results from Deezer</p>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {results.map(r => (
              <DeezerResultRow key={r.id} result={r} />
            ))}
          </div>
        </div>
      )}

      {/* Dashboard cards — only show when not searching */}
      {!debouncedQuery.trim() && (
        <div className="space-y-4">
          {/* Stats row */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={Music} label="Tracks" value={stats.tracks.toLocaleString()} />
              <StatCard icon={Users} label="Artists" value={stats.artists.toLocaleString()} />
              <StatCard icon={Disc3} label="Albums" value={stats.albums.toLocaleString()} />
              <StatCard icon={Download} label="Downloaded" value={stats.downloaded.toLocaleString()} />
            </div>
          )}

          {/* Pending / Failed row */}
          {(pendingCount > 0 || failedCount > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pendingCount > 0 && (
                <button
                  onClick={() => setPage('downloads')}
                  className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)] transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-[var(--color-accent-dim)] flex items-center justify-center flex-shrink-0">
                    <Download size={18} className="text-[var(--color-accent)]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{pendingCount} pending downloads</p>
                    <p className="text-xs text-[var(--color-text-muted)]">Tap to view and start downloading</p>
                  </div>
                </button>
              )}
              {failedCount > 0 && (
                <button
                  onClick={handleRetryFailed}
                  disabled={retrying}
                  className="flex items-center gap-3 rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-surface)] p-4 hover:border-[var(--color-danger)] transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                    {retrying ? <Loader2 size={18} className="animate-spin text-[var(--color-danger)]" /> : <AlertCircle size={18} className="text-[var(--color-danger)]" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{failedCount} failed downloads</p>
                    <p className="text-xs text-[var(--color-text-muted)]">Tap to retry all failed</p>
                  </div>
                </button>
              )}
            </div>
          )}

          {/* Recently added */}
          {recentlyAdded.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-3 flex items-center gap-2">
                <Clock size={14} /> Recently Added
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {recentlyAdded.slice(0, 8).map((a, i) => (
                  <div key={i} className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden">
                    {a.album_art_url ? (
                      <img src={a.album_art_url.startsWith('/') ? a.album_art_url : `/api/stream/art/${a.track_id}`} alt="" className="w-full aspect-square object-cover bg-[var(--color-surface-2)]" />
                    ) : (
                      <div className="w-full aspect-square bg-[var(--color-surface-2)] flex items-center justify-center">
                        <Disc3 size={24} className="text-[var(--color-text-muted)] opacity-50" />
                      </div>
                    )}
                    <div className="p-2">
                      <p className="text-xs font-medium truncate">{a.album}</p>
                      <p className="text-xs text-[var(--color-text-muted)] truncate">{a.artist}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Music; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className="text-[var(--color-text-muted)]" />
        <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      </div>
      <p className="text-xl font-bold">{value}</p>
    </div>
  )
}
