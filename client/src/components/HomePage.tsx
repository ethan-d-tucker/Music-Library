import { useState, useEffect } from 'react'
import { Disc3, Play } from 'lucide-react'
import { useAppStore } from '../lib/store.ts'
import { usePlayerStore } from '../lib/player.ts'
import { getHomeData, getPlaylists, type TrackRow, type PlaylistWithCount } from '../lib/api.ts'

export function HomePage() {
  const setPage = useAppStore((s) => s.setPage)
  const setSelectedPlaylistId = useAppStore((s) => s.setSelectedPlaylistId)
  const setSelectedArtist = useAppStore((s) => s.setSelectedArtist)
  const setSelectedAlbum = useAppStore((s) => s.setSelectedAlbum)
  const currentUser = useAppStore((s) => s.currentUser)
  const playTrack = usePlayerStore((s) => s.playTrack)

  const [recentlyPlayed, setRecentlyPlayed] = useState<TrackRow[]>([])
  const [randomAlbums, setRandomAlbums] = useState<{ album: string; artist: string; album_art_url: string }[]>([])
  const [playlists, setPlaylists] = useState<PlaylistWithCount[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      getHomeData(),
      getPlaylists(),
    ]).then(([home, pl]) => {
      setRecentlyPlayed(home.recentlyPlayed)
      setRandomAlbums(home.randomAlbums)
      setPlaylists(pl.playlists)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  function navigateToAlbum(artist: string, album: string) {
    setPage('library')
    setTimeout(() => {
      setSelectedArtist(artist)
      setTimeout(() => setSelectedAlbum(album), 50)
    }, 50)
  }

  function navigateToPlaylist(id: number) {
    setPage('playlists')
    setTimeout(() => setSelectedPlaylistId(id), 50)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-[var(--color-text-muted)]">Loading...</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">
          {currentUser ? `Hey, ${currentUser.displayName}` : 'Welcome'}
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">What do you want to listen to?</p>
      </div>

      {/* Recently Played */}
      {recentlyPlayed.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Recently Played</h2>
          <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
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
                  <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-9 h-9 rounded-full bg-[var(--color-accent)] flex items-center justify-center shadow-lg">
                      <Play size={16} className="text-white ml-0.5" fill="white" />
                    </div>
                  </div>
                </div>
                <p className="text-sm font-medium truncate">{t.title}</p>
                <p className="text-xs text-[var(--color-text-muted)] truncate">{t.artist}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Your Playlists */}
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
          <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
            {playlists.slice(0, 10).map((p) => (
              <button
                key={p.id}
                onClick={() => navigateToPlaylist(p.id)}
                className="flex-shrink-0 w-36"
              >
                <div className="w-36 h-36 rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-surface-2)] flex items-center justify-center shadow-lg mb-2">
                  <Disc3 size={40} className="text-white/80" />
                </div>
                <p className="text-sm font-medium truncate">{p.name}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{p.trackCount} tracks</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Suggested Albums */}
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
                  {a.album_art_url ? (
                    <img
                      src={a.album_art_url}
                      alt=""
                      className="w-full aspect-square rounded-lg object-cover bg-[var(--color-surface-2)] shadow-lg"
                    />
                  ) : (
                    <div className="w-full aspect-square rounded-lg bg-[var(--color-surface-2)] flex items-center justify-center shadow-lg">
                      <Disc3 size={40} className="text-[var(--color-text-muted)] opacity-50" />
                    </div>
                  )}
                  <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-10 h-10 rounded-full bg-[var(--color-accent)] flex items-center justify-center shadow-lg">
                      <Play size={18} className="text-white ml-0.5" fill="white" />
                    </div>
                  </div>
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
