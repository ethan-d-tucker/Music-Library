import { useState } from 'react'
import { Search, Download, Check, Loader2, AlertCircle, Music } from 'lucide-react'
import { searchDeezer, downloadDeezerTrack, type DeezerResult } from '../lib/api.ts'

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function SearchPage() {
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
      <h2 className="text-xl font-bold mb-4">Search & Download</h2>

      <form onSubmit={handleSearch} className="mb-4 md:mb-6 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for songs, artists, or albums..."
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
          Search for music to download from Deezer
        </div>
      )}
    </div>
  )
}
