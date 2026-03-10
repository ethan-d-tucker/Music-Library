import { useState, useEffect } from 'react'
import { Disc3, Play, User } from 'lucide-react'
import { useAppStore } from '../lib/store.ts'
import { usePlayerStore } from '../lib/player.ts'
import { getHomeData, getPlaylists, type TrackRow, type PlaylistWithCount } from '../lib/api.ts'

// Horizontal scroll container (hides scrollbar)
function HScroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
      {children}
    </div>
  )
}

// Album art with fallback
function ArtImage({ src, alt = '', className = '' }: { src?: string; alt?: string; className?: string }) {
  if (!src) {
    return (
      <div className={`bg-[var(--color-surface-2)] flex items-center justify-center ${className}`}>
        <Disc3 size={32} className="text-[var(--color-text-muted)] opacity-50" />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      className={`object-cover bg-[var(--color-surface-2)] ${className}`}
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}

// Play button overlay for cards
function PlayOverlay({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const s = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10'
  const icon = size === 'sm' ? 14 : 18
  return (
    <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
      <div className={`${s} rounded-full bg-[var(--color-accent)] flex items-center justify-center shadow-lg`}>
        <Play size={icon} className="text-white ml-0.5" fill="white" />
      </div>
    </div>
  )
}

export function HomePage() {
  const setPage = useAppStore((s) => s.setPage)
  const setSelectedPlaylistId = useAppStore((s) => s.setSelectedPlaylistId)
  const navigateToAlbum = useAppStore((s) => s.navigateToAlbum)
  const navigateToArtist = useAppStore((s) => s.navigateToArtist)
  const currentUser = useAppStore((s) => s.currentUser)
  const playTrack = usePlayerStore((s) => s.playTrack)

  const [recentlyPlayed, setRecentlyPlayed] = useState<TrackRow[]>([])
  const [recentlyAdded, setRecentlyAdded] = useState<{ album: string; artist: string; album_art_url: string; track_id: number }[]>([])
  const [mostPlayed, setMostPlayed] = useState<TrackRow[]>([])
  const [topArtists, setTopArtists] = useState<{ artist: string; play_count: number }[]>([])
  const [randomAlbums, setRandomAlbums] = useState<{ album: string; artist: string; album_art_url: string }[]>([])
  const [playlists, setPlaylists] = useState<PlaylistWithCount[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      getHomeData(),
      getPlaylists(),
    ]).then(([home, pl]) => {
      setRecentlyPlayed(home.recentlyPlayed)
      setRecentlyAdded(home.recentlyAdded)
      setMostPlayed(home.mostPlayed)
      setTopArtists(home.topArtists)
      setRandomAlbums(home.randomAlbums)
      setPlaylists(pl.playlists)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  function navigateToPlaylist(id: number) {
    setPage('playlists')
    setSelectedPlaylistId(id)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-[var(--color-text-muted)]">Loading...</p>
      </div>
    )
  }

  // Build quick-play tiles: mix of recent tracks + top playlists
  const quickPlayItems: { type: 'track' | 'playlist'; track?: TrackRow; playlist?: PlaylistWithCount }[] = []
  const recentForQuick = recentlyPlayed.slice(0, 4)
  const playlistsForQuick = playlists.slice(0, 2)
  for (const t of recentForQuick) quickPlayItems.push({ type: 'track', track: t })
  for (const p of playlistsForQuick) quickPlayItems.push({ type: 'playlist', playlist: p })
  // Fill remaining to 6 from more recent tracks
  const remaining = recentlyPlayed.slice(4, 4 + (6 - quickPlayItems.length))
  for (const t of remaining) quickPlayItems.push({ type: 'track', track: t })

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold">
          {currentUser ? `Hey, ${currentUser.displayName}` : 'Welcome'}
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">What do you want to listen to?</p>
      </div>

      {/* 1. Quick-Play Grid */}
      {quickPlayItems.length > 0 && (
        <section>
          <div className="grid grid-cols-2 gap-2">
            {quickPlayItems.slice(0, 6).map((item, i) => {
              if (item.type === 'track' && item.track) {
                const t = item.track
                return (
                  <button
                    key={`qt-${t.id}-${i}`}
                    onClick={() => playTrack(t, recentlyPlayed)}
                    className="flex items-center gap-3 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)] transition-colors overflow-hidden h-14"
                  >
                    <img
                      src={`/api/stream/art/${t.id}`}
                      alt=""
                      className="w-14 h-14 object-cover bg-[var(--color-surface-2)] flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1 pr-3">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <p className="text-xs text-[var(--color-text-muted)] truncate">{t.artist}</p>
                    </div>
                  </button>
                )
              }
              if (item.type === 'playlist' && item.playlist) {
                const p = item.playlist
                return (
                  <button
                    key={`qp-${p.id}`}
                    onClick={() => navigateToPlaylist(p.id)}
                    className="flex items-center gap-3 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)] transition-colors overflow-hidden h-14"
                  >
                    <div className="w-14 h-14 bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-surface-2)] flex items-center justify-center flex-shrink-0">
                      <Disc3 size={24} className="text-white/80" />
                    </div>
                    <div className="min-w-0 flex-1 pr-3">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{p.trackCount} tracks</p>
                    </div>
                  </button>
                )
              }
              return null
            })}
          </div>
        </section>
      )}

      {/* 2. Recently Played */}
      {recentlyPlayed.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Recently Played</h2>
          <HScroll>
            {recentlyPlayed.map((t) => (
              <button
                key={t.id}
                onClick={() => playTrack(t, recentlyPlayed)}
                className="flex-shrink-0 w-36 group"
              >
                <div className="relative mb-2">
                  <img
                    src={`/api/stream/art/${t.id}`}
                    alt=""
                    className="w-36 h-36 rounded-lg object-cover bg-[var(--color-surface-2)] shadow-lg"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <PlayOverlay size="sm" />
                </div>
                <p className="text-sm font-medium truncate">{t.title}</p>
                <p className="text-xs text-[var(--color-text-muted)] truncate">{t.artist}</p>
              </button>
            ))}
          </HScroll>
        </section>
      )}

      {/* 3. Recently Added */}
      {recentlyAdded.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Recently Added</h2>
          <HScroll>
            {recentlyAdded.map((a) => (
              <button
                key={`${a.artist}|||${a.album}`}
                onClick={() => navigateToAlbum(a.artist, a.album)}
                className="flex-shrink-0 w-36 group"
              >
                <div className="relative mb-2">
                  <ArtImage
                    src={a.album_art_url || (a.track_id ? `/api/stream/art/${a.track_id}` : undefined)}
                    className="w-36 h-36 rounded-lg shadow-lg"
                  />
                  <PlayOverlay size="sm" />
                </div>
                <p className="text-sm font-medium truncate">{a.album}</p>
                <p className="text-xs text-[var(--color-text-muted)] truncate">{a.artist}</p>
              </button>
            ))}
          </HScroll>
        </section>
      )}

      {/* 4. Top Artists */}
      {topArtists.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Your Top Artists</h2>
          <HScroll>
            {topArtists.map((a) => (
              <button
                key={a.artist}
                onClick={() => navigateToArtist(a.artist)}
                className="flex-shrink-0 w-28 group"
              >
                <div className="w-28 h-28 rounded-full bg-[var(--color-surface-2)] flex items-center justify-center mb-2 shadow-lg overflow-hidden mx-auto group-hover:ring-2 group-hover:ring-[var(--color-accent)] transition-all">
                  <User size={32} className="text-[var(--color-text-muted)] opacity-50" />
                </div>
                <p className="text-sm font-medium truncate text-center">{a.artist}</p>
                <p className="text-xs text-[var(--color-text-muted)] text-center">{a.play_count} plays</p>
              </button>
            ))}
          </HScroll>
        </section>
      )}

      {/* 5. Most Played */}
      {mostPlayed.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Most Played</h2>
          <HScroll>
            {mostPlayed.map((t) => (
              <button
                key={t.id}
                onClick={() => playTrack(t, mostPlayed)}
                className="flex-shrink-0 w-36 group"
              >
                <div className="relative mb-2">
                  <img
                    src={`/api/stream/art/${t.id}`}
                    alt=""
                    className="w-36 h-36 rounded-lg object-cover bg-[var(--color-surface-2)] shadow-lg"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <PlayOverlay size="sm" />
                </div>
                <p className="text-sm font-medium truncate">{t.title}</p>
                <p className="text-xs text-[var(--color-text-muted)] truncate">{t.artist}</p>
              </button>
            ))}
          </HScroll>
        </section>
      )}

      {/* 6. Your Playlists */}
      {playlists.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Your Playlists</h2>
            <button
              onClick={() => setPage('playlists')}
              className="text-xs text-[var(--color-accent)] hover:underline"
            >
              See all
            </button>
          </div>
          <HScroll>
            {playlists.slice(0, 10).map((p) => (
              <button
                key={p.id}
                onClick={() => navigateToPlaylist(p.id)}
                className="flex-shrink-0 w-36 group"
              >
                <div className="relative w-36 h-36 rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-surface-2)] flex items-center justify-center shadow-lg mb-2">
                  <Disc3 size={40} className="text-white/80" />
                  <PlayOverlay size="sm" />
                </div>
                <p className="text-sm font-medium truncate">{p.name}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{p.trackCount} tracks</p>
              </button>
            ))}
          </HScroll>
        </section>
      )}

      {/* 7. Discover */}
      {randomAlbums.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Discover</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {randomAlbums.map((a) => (
              <button
                key={`${a.artist}|||${a.album}`}
                onClick={() => navigateToAlbum(a.artist, a.album)}
                className="group text-left rounded-lg p-3 hover:bg-[var(--color-surface)] transition-colors"
              >
                <div className="relative mb-2">
                  <ArtImage
                    src={a.album_art_url}
                    className="w-full aspect-square rounded-lg shadow-lg"
                  />
                  <PlayOverlay />
                </div>
                <p className="text-sm font-medium truncate">{a.album}</p>
                <p className="text-xs text-[var(--color-text-muted)] truncate">{a.artist}</p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
