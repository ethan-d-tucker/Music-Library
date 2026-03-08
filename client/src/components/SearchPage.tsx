import { useState } from 'react'
import { Search, Download, Check, Loader2, AlertCircle, List, X, ChevronRight } from 'lucide-react'
import { searchYouTube, searchYouTubePlaylists, expandPlaylist, downloadFromUrl, type SearchResult, type PlaylistSearchResult } from '../lib/api.ts'

function isPlaylistUrl(query: string): boolean {
  return /youtube\.com\/.*(list=|\/playlist)/.test(query) || /youtu\.be\//.test(query) && /list=/.test(query)
}

interface EditableTrack {
  result: SearchResult
  artist: string
  title: string
  album: string
}

function parseArtistTitle(result: SearchResult): { artist: string; title: string } {
  const parts = result.title.split(' - ')
  return {
    artist: parts.length > 1 ? parts[0].trim() : result.channel,
    title: parts.length > 1 ? parts.slice(1).join(' - ').trim() : result.title,
  }
}

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [playlistResults, setPlaylistResults] = useState<PlaylistSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [downloading, setDownloading] = useState<Record<string, 'downloading' | 'done' | 'error'>>({})

  // Editable track metadata (shown when user clicks download)
  const [editing, setEditing] = useState<string | null>(null)
  const [editData, setEditData] = useState<EditableTrack | null>(null)

  // Playlist mode (expanded playlist or URL)
  const [playlistTitle, setPlaylistTitle] = useState<string | null>(null)
  const [playlistAlbum, setPlaylistAlbum] = useState('')
  const [playlistArtist, setPlaylistArtist] = useState('')
  const [downloadingAll, setDownloadingAll] = useState(false)

  // Expanding a playlist from search results
  const [expandingId, setExpandingId] = useState<string | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setPlaylistTitle(null)
    setPlaylistAlbum('')
    setPlaylistArtist('')
    setEditing(null)
    setEditData(null)
    setDownloading({})
    setPlaylistResults([])

    try {
      if (isPlaylistUrl(q)) {
        const r = await expandPlaylist(q)
        setResults(r.tracks)
        setPlaylistTitle(r.title)
        const parts = r.title.split(' - ')
        if (parts.length > 1) {
          setPlaylistArtist(parts[0].trim())
          setPlaylistAlbum(parts.slice(1).join(' - ').trim())
        } else {
          setPlaylistAlbum(r.title)
        }
      } else {
        // Search videos and playlists in parallel
        const [videoRes, playlistRes] = await Promise.all([
          searchYouTube(q),
          searchYouTubePlaylists(q).catch(() => ({ playlists: [] })),
        ])
        setResults(videoRes.results)
        setPlaylistResults(playlistRes.playlists)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setSearching(false)
    }
  }

  async function handleExpandPlaylist(pl: PlaylistSearchResult) {
    setExpandingId(pl.id)
    try {
      const r = await expandPlaylist(pl.url)
      setResults(r.tracks)
      setPlaylistResults([])
      setPlaylistTitle(r.title)
      const parts = r.title.split(' - ')
      if (parts.length > 1) {
        setPlaylistArtist(parts[0].trim())
        setPlaylistAlbum(parts.slice(1).join(' - ').trim())
      } else {
        setPlaylistAlbum(r.title)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setExpandingId(null)
    }
  }

  function startEdit(result: SearchResult) {
    const { artist, title } = parseArtistTitle(result)
    setEditing(result.id)
    setEditData({ result, artist, title, album: '' })
  }

  function cancelEdit() {
    setEditing(null)
    setEditData(null)
  }

  async function confirmDownload() {
    if (!editData) return
    const { result, artist, title, album } = editData
    setDownloading((prev) => ({ ...prev, [result.id]: 'downloading' }))
    setEditing(null)
    setEditData(null)
    try {
      await downloadFromUrl(result.url, title, artist, album || undefined)
      setDownloading((prev) => ({ ...prev, [result.id]: 'done' }))
    } catch {
      setDownloading((prev) => ({ ...prev, [result.id]: 'error' }))
    }
  }

  async function handlePlaylistDownload(result: SearchResult) {
    const { artist, title } = parseArtistTitle(result)
    const finalArtist = playlistArtist || artist
    const finalAlbum = playlistAlbum
    setDownloading((prev) => ({ ...prev, [result.id]: 'downloading' }))
    try {
      await downloadFromUrl(result.url, title, finalArtist, finalAlbum || undefined)
      setDownloading((prev) => ({ ...prev, [result.id]: 'done' }))
    } catch {
      setDownloading((prev) => ({ ...prev, [result.id]: 'error' }))
    }
  }

  async function handleDownloadAll() {
    setDownloadingAll(true)
    for (const result of results) {
      if (downloading[result.id] === 'done') continue
      await handlePlaylistDownload(result)
      await new Promise(r => setTimeout(r, 500))
    }
    setDownloadingAll(false)
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Search YouTube</h2>

      <form onSubmit={handleSearch} className="mb-4 md:mb-6 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a song, or paste a YouTube playlist/album URL..."
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

      {/* Playlist search results */}
      {playlistResults.length > 0 && !playlistTitle && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">Albums & Playlists</h3>
          <div className="grid gap-2 mb-4">
            {playlistResults.map((pl) => (
              <button
                key={pl.id}
                onClick={() => handleExpandPlaylist(pl)}
                disabled={expandingId === pl.id}
                className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] transition-colors disabled:opacity-70"
              >
                {pl.thumbnail ? (
                  <img src={pl.thumbnail} alt="" className="w-12 h-12 rounded object-cover" />
                ) : (
                  <List size={18} className="text-[var(--color-text-muted)]" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{pl.title}</div>
                  <div className="text-sm text-[var(--color-text-muted)]">Playlist</div>
                </div>
                {expandingId === pl.id ? (
                  <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
                ) : (
                  <ChevronRight size={16} className="text-[var(--color-text-muted)]" />
                )}
              </button>
            ))}
          </div>
          {results.length > 0 && (
            <h3 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">Videos</h3>
          )}
        </div>
      )}

      {/* Playlist header with editable artist/album */}
      {playlistTitle && (
        <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <List size={18} className="text-[var(--color-accent)]" />
            <span className="font-semibold">{playlistTitle}</span>
            <span className="text-sm text-[var(--color-text-muted)]">{results.length} tracks</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
            <input
              type="text"
              value={playlistArtist}
              onChange={(e) => setPlaylistArtist(e.target.value)}
              placeholder="Artist"
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <input
              type="text"
              value={playlistAlbum}
              onChange={(e) => setPlaylistAlbum(e.target.value)}
              placeholder="Album"
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </div>
          <button
            onClick={handleDownloadAll}
            disabled={downloadingAll || results.every(r => downloading[r.id] === 'done')}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {downloadingAll ? (
              <><Loader2 size={14} className="animate-spin" /> Downloading...</>
            ) : results.every(r => downloading[r.id] === 'done') ? (
              <><Check size={14} /> All Downloaded</>
            ) : (
              <><Download size={14} /> Download All</>
            )}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {results.map((r) => {
          const status = downloading[r.id]
          const isEditing = editing === r.id
          return (
            <div key={r.id}>
              <div className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
                {r.thumbnail && (
                  <img src={r.thumbnail} alt="" className="w-16 h-12 rounded object-cover" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.title}</div>
                  <div className="text-sm text-[var(--color-text-muted)]">
                    {r.channel} / {r.durationFormatted}
                  </div>
                </div>
                {playlistTitle ? (
                  <button
                    onClick={() => handlePlaylistDownload(r)}
                    disabled={status === 'downloading' || status === 'done'}
                    className="shrink-0 rounded-lg border border-[var(--color-border)] p-2 hover:bg-[var(--color-surface-2)] transition-colors disabled:opacity-50"
                  >
                    {status === 'downloading' ? <Loader2 size={16} className="animate-spin" /> :
                     status === 'done' ? <Check size={16} className="text-[var(--color-success)]" /> :
                     status === 'error' ? <AlertCircle size={16} className="text-[var(--color-danger)]" /> :
                     <Download size={16} />}
                  </button>
                ) : (
                  <button
                    onClick={() => isEditing ? cancelEdit() : startEdit(r)}
                    disabled={status === 'downloading' || status === 'done'}
                    className="shrink-0 rounded-lg border border-[var(--color-border)] p-2 hover:bg-[var(--color-surface-2)] transition-colors disabled:opacity-50"
                    title={status === 'done' ? 'Downloaded' : status === 'error' ? 'Failed' : isEditing ? 'Cancel' : 'Download'}
                  >
                    {status === 'downloading' ? <Loader2 size={16} className="animate-spin" /> :
                     status === 'done' ? <Check size={16} className="text-[var(--color-success)]" /> :
                     status === 'error' ? <AlertCircle size={16} className="text-[var(--color-danger)]" /> :
                     isEditing ? <X size={16} /> :
                     <Download size={16} />}
                  </button>
                )}
              </div>

              {/* Editable metadata form (search mode only) */}
              {isEditing && editData && (
                <div className="ml-4 mt-1 mb-2 rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface)] p-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)]">Artist</label>
                      <input
                        type="text"
                        value={editData.artist}
                        onChange={(e) => setEditData({ ...editData, artist: e.target.value })}
                        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)]"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)]">Title</label>
                      <input
                        type="text"
                        value={editData.title}
                        onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)]"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)]">Album</label>
                      <input
                        type="text"
                        value={editData.album}
                        onChange={(e) => setEditData({ ...editData, album: e.target.value })}
                        placeholder="Optional"
                        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)]"
                      />
                    </div>
                  </div>
                  <button
                    onClick={confirmDownload}
                    className="rounded bg-[var(--color-accent)] px-3 py-1 text-sm text-white hover:bg-[var(--color-accent-hover)] transition-colors"
                  >
                    Download
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
