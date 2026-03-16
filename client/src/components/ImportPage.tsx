import { useState, useEffect } from 'react'
import { Link2, Check, Loader2, Music, Disc3, Heart, Search, ListMusic } from 'lucide-react'
import { useAppStore } from '../lib/store.ts'
import {
  getSpotifyStatus,
  getSpotifyAuthUrl,
  getSpotifyPlaylists,
  getSpotifyAlbums,
  getLikedSongsCount,
  importSpotifyPlaylists,
  importSpotifyAlbums,
  importLikedSongs,
  searchSpotify,
  startBatchDownload,
  type SpotifyPlaylist,
  type SpotifyAlbum,
  type ImportResult,
} from '../lib/api.ts'

type Tab = 'playlists' | 'albums' | 'liked'

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function ImportPage() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('playlists')
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([])
  const [albums, setAlbums] = useState<SpotifyAlbum[]>([])
  const [likedCount, setLikedCount] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedType, setSelectedType] = useState<'playlist' | 'album'>('album')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult[] | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const setPage = useAppStore((s) => s.setPage)
  const setBatchJobId = useAppStore((s) => s.setBatchJobId)

  // Spotify search
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 400)
  const [searchResults, setSearchResults] = useState<{ albums: SpotifyAlbum[]; playlists: SpotifyPlaylist[] } | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)

  // Spotify search effect
  useEffect(() => {
    if (!debouncedSearch || !connected) {
      setSearchResults(null)
      return
    }
    setSearchLoading(true)
    searchSpotify(debouncedSearch)
      .then(setSearchResults)
      .catch(console.error)
      .finally(() => setSearchLoading(false))
  }, [debouncedSearch, connected])

  useEffect(() => {
    getSpotifyStatus().then((r) => {
      setConnected(r.connected)
      if (r.connected) loadTab('playlists')
    }).catch(console.error)
  }, [])

  function loadTab(t: Tab) {
    setTab(t)
    setSelected(new Set())
    setImportResult(null)
    setImportError(null)
    setLoadError(null)
    setSearchQuery('')
    setSearchResults(null)
    if (t === 'playlists' && playlists.length === 0) {
      getSpotifyPlaylists().then((r) => setPlaylists(r.playlists)).catch((err) => {
        console.error(err)
        setLoadError((err as Error).message || 'Failed to load playlists')
      })
    } else if (t === 'albums' && albums.length === 0) {
      getSpotifyAlbums().then((r) => setAlbums(r.albums)).catch((err) => {
        console.error(err)
        setLoadError((err as Error).message || 'Failed to load albums')
      })
    } else if (t === 'liked' && likedCount === null) {
      getLikedSongsCount().then((r) => setLikedCount(r.count)).catch((err) => {
        console.error(err)
        setLoadError((err as Error).message || 'Failed to load liked songs count')
      })
    }
  }

  async function handleConnect() {
    const { url } = await getSpotifyAuthUrl()
    window.location.href = url
  }

  function toggle(id: string, type: 'playlist' | 'album') {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setSelectedType(type)
  }

  function selectAll() {
    const items = tab === 'playlists' ? playlists : albums
    if (selected.size === items.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(items.map((i) => i.id)))
    }
  }

  async function triggerDownloads() {
    try {
      const { jobId } = await startBatchDownload()
      setBatchJobId(jobId)
      setPage('downloads')
    } catch (err) {
      console.error('Failed to start downloads:', err)
    }
  }

  async function handleImport() {
    if (tab === 'liked' && !searchQuery) {
      setImporting(true)
      setImportResult(null)
      setImportError(null)
      try {
        const result = await importLikedSongs()
        setImportResult(result.results)
        triggerDownloads()
      } catch (err) {
        console.error(err)
        setImportError((err as Error).message || 'Import failed. Check your Spotify connection and try again.')
      } finally {
        setImporting(false)
      }
      return
    }

    if (selected.size === 0) return
    setImporting(true)
    setImportResult(null)
    setImportError(null)
    try {
      const ids = [...selected]
      // Determine if we're importing playlists or albums
      const isPlaylist = searchQuery ? selectedType === 'playlist' : tab === 'playlists'
      const result = isPlaylist
        ? await importSpotifyPlaylists(ids)
        : await importSpotifyAlbums(ids)
      setImportResult(result.results)
      triggerDownloads()
    } catch (err) {
      console.error(err)
      setImportError((err as Error).message || 'Import failed. Check your Spotify connection and try again.')
    } finally {
      setImporting(false)
    }
  }

  function resetImport() {
    setImportResult(null)
    setImportError(null)
    setSelected(new Set())
    setSearchQuery('')
    setSearchResults(null)
  }

  if (connected === null) {
    return <p className="text-[var(--color-text-muted)]">Checking Spotify connection...</p>
  }

  if (!connected) {
    return (
      <div>
        <h2 className="text-xl font-bold mb-4">Import from Spotify</h2>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
          <Link2 size={32} className="mx-auto mb-3 text-[var(--color-text-muted)]" />
          <p className="mb-4 text-[var(--color-text-muted)]">Connect your Spotify account to import playlists, albums, and liked songs</p>
          <button
            onClick={handleConnect}
            className="rounded-lg bg-[#1DB954] px-6 py-2 font-medium text-black hover:bg-[#1ed760] transition-colors"
          >
            Connect Spotify
          </button>
        </div>
      </div>
    )
  }

  // After import, show summary with option to import more
  if (importResult) {
    return (
      <div>
        <h2 className="text-xl font-bold mb-4">Import from Spotify</h2>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
            <Check size={20} className="text-[var(--color-success)]" /> Import Complete
          </h3>
          <div className="text-sm text-[var(--color-text-muted)] mb-4">
            {importResult.map((r) => (
              <p key={r.name}>{r.name}: {r.tracksImported} tracks</p>
            ))}
          </div>
          <p className="text-sm text-[var(--color-text-muted)] mb-4">Downloads started — check the Downloads page for progress.</p>
          <div className="flex gap-3">
            <button
              onClick={() => { setPage('downloads') }}
              className="rounded-lg bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              View Downloads
            </button>
            <button
              onClick={resetImport}
              className="rounded-lg border border-[var(--color-border)] px-5 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] transition-colors"
            >
              Import More
            </button>
          </div>
        </div>
      </div>
    )
  }

  // === Selection View ===
  const tabClass = (t: Tab) =>
    `flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
      tab === t && !searchQuery
        ? 'bg-[var(--color-accent)] text-white'
        : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]'
    }`

  const showSearchResults = searchQuery && searchResults

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Import from Spotify</h2>
      <span className="flex items-center gap-1 text-sm text-[var(--color-success)] mb-4">
        <Check size={16} /> Connected
      </span>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          type="text"
          placeholder="Search Spotify for albums, playlists..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        {searchLoading && (
          <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[var(--color-text-muted)]" />
        )}
      </div>

      {/* Tabs (hidden during search) */}
      {!showSearchResults && (
        <div className="flex gap-2 mb-4">
          <button onClick={() => loadTab('playlists')} className={tabClass('playlists')}>
            <Music size={16} /> Playlists
          </button>
          <button onClick={() => loadTab('albums')} className={tabClass('albums')}>
            <Disc3 size={16} /> Albums
          </button>
          <button onClick={() => loadTab('liked')} className={tabClass('liked')}>
            <Heart size={16} /> Liked Songs
          </button>
        </div>
      )}

      {/* Search results */}
      {showSearchResults && (
        <div>
          {searchResults.albums.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">Albums</h3>
              <div className="grid gap-2 mb-4">
                {searchResults.albums.map((a) => (
                  <label
                    key={a.id}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                      selected.has(a.id)
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-dim)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]'
                    }`}
                  >
                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id, 'album')} className="accent-[var(--color-accent)]" />
                    {a.imageUrl && <img src={a.imageUrl} alt="" className="w-10 h-10 rounded object-cover" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{a.name}</div>
                      <div className="text-sm text-[var(--color-text-muted)]">{a.artist} &middot; {a.trackCount} tracks</div>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
          {searchResults.playlists.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">Playlists</h3>
              <div className="grid gap-2 mb-4">
                {searchResults.playlists.map((p) => (
                  <label
                    key={p.id}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                      selected.has(p.id)
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-dim)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]'
                    }`}
                  >
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id, 'playlist')} className="accent-[var(--color-accent)]" />
                    {p.imageUrl && <img src={p.imageUrl} alt="" className="w-10 h-10 rounded object-cover" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="text-sm text-[var(--color-text-muted)]">{p.trackCount} tracks</div>
                    </div>
                    <ListMusic size={16} className="text-[var(--color-text-muted)]" />
                  </label>
                ))}
              </div>
            </>
          )}
          {!searchLoading && searchResults.albums.length === 0 && searchResults.playlists.length === 0 && (
            <p className="text-[var(--color-text-muted)]">No results found.</p>
          )}
        </div>
      )}

      {/* Browse tabs content (hidden during search) */}
      {!showSearchResults && (
        <>
          {/* Playlists tab */}
          {tab === 'playlists' && (
            <div>
              <div className="mb-3 flex items-center gap-3">
                <span className="text-sm text-[var(--color-text-muted)]">{playlists.length} playlists</span>
                {playlists.length > 0 && (
                  <button onClick={selectAll} className="ml-auto text-sm text-[var(--color-accent)] hover:underline">
                    {selected.size === playlists.length ? 'Deselect All' : 'Select All'}
                  </button>
                )}
              </div>
              <div className="grid gap-2 mb-4 max-h-[60vh] overflow-y-auto">
                {playlists.map((p) => (
                  <label
                    key={p.id}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                      selected.has(p.id)
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-dim)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]'
                    }`}
                  >
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id, 'playlist')} className="accent-[var(--color-accent)]" />
                    {p.imageUrl && <img src={p.imageUrl} alt="" className="w-10 h-10 rounded object-cover" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="text-sm text-[var(--color-text-muted)]">{p.trackCount} tracks</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Albums tab */}
          {tab === 'albums' && (
            <div>
              <div className="mb-3 flex items-center gap-3">
                <span className="text-sm text-[var(--color-text-muted)]">{albums.length} saved albums</span>
                {albums.length > 0 && (
                  <button onClick={selectAll} className="ml-auto text-sm text-[var(--color-accent)] hover:underline">
                    {selected.size === albums.length ? 'Deselect All' : 'Select All'}
                  </button>
                )}
              </div>
              <div className="grid gap-2 mb-4 max-h-[60vh] overflow-y-auto">
                {albums.map((a) => (
                  <label
                    key={a.id}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                      selected.has(a.id)
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-dim)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]'
                    }`}
                  >
                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id, 'album')} className="accent-[var(--color-accent)]" />
                    {a.imageUrl && <img src={a.imageUrl} alt="" className="w-10 h-10 rounded object-cover" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{a.name}</div>
                      <div className="text-sm text-[var(--color-text-muted)]">{a.artist} &middot; {a.trackCount} tracks</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Liked Songs tab */}
          {tab === 'liked' && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
              <div className="flex items-center gap-3 mb-4">
                <Heart size={24} className="text-[#1DB954]" />
                <div>
                  <div className="font-medium">Liked Songs</div>
                  <div className="text-sm text-[var(--color-text-muted)]">
                    {likedCount !== null ? `${likedCount} songs` : 'Loading...'}
                  </div>
                </div>
              </div>
              <p className="text-sm text-[var(--color-text-muted)] mb-4">
                Import all your liked songs. They will be saved to your library and added to a "Liked Songs" playlist.
              </p>
            </div>
          )}
        </>
      )}

      {/* Load error */}
      {loadError && (
        <div className="mb-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-surface)] p-4">
          <p className="text-sm text-[var(--color-danger)]">{loadError}</p>
        </div>
      )}

      {/* Import button */}
      {((tab === 'liked' && !searchQuery) || selected.size > 0) && (
        <button
          onClick={handleImport}
          disabled={importing}
          className="mt-4 rounded-lg bg-[var(--color-accent)] px-6 py-2 font-medium text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
        >
          {importing ? (
            <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Importing...</span>
          ) : tab === 'liked' && !searchQuery ? (
            `Import ${likedCount ?? ''} Liked Songs`
          ) : (
            `Import ${selected.size} Selected`
          )}
        </button>
      )}

      {/* Import error */}
      {importError && (
        <div className="mt-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-surface)] p-4">
          <p className="text-sm text-[var(--color-danger)]">{importError}</p>
        </div>
      )}
    </div>
  )
}
