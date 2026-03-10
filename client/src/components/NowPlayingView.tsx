import { useState, useRef, useCallback } from 'react'
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  ChevronDown, ListMusic, X, AlignLeft, Trash2,
} from 'lucide-react'
import { usePlayerStore, type RepeatMode } from '../lib/player.ts'
import { useAppStore } from '../lib/store.ts'
import { SyncedLyrics } from './SyncedLyrics.tsx'

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function RepeatIcon({ mode }: { mode: RepeatMode }) {
  if (mode === 'one') return <Repeat1 size={20} />
  return <Repeat size={20} />
}

export function NowPlayingView() {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const shuffle = usePlayerStore((s) => s.shuffle)
  const repeat = usePlayerStore((s) => s.repeat)
  const queue = usePlayerStore((s) => s.queue)
  const queueIndex = usePlayerStore((s) => s.queueIndex)
  const isQueueVisible = usePlayerStore((s) => s.isQueueVisible)
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const next = usePlayerStore((s) => s.next)
  const previous = usePlayerStore((s) => s.previous)
  const seek = usePlayerStore((s) => s.seek)
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle)
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat)
  const setFullScreen = usePlayerStore((s) => s.setFullScreen)
  const setQueueVisible = usePlayerStore((s) => s.setQueueVisible)
  const playTrack = usePlayerStore((s) => s.playTrack)
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue)
  const clearQueue = usePlayerStore((s) => s.clearQueue)

  const navigateToArtist = useAppStore((s) => s.navigateToArtist)
  const navigateToAlbum = useAppStore((s) => s.navigateToAlbum)

  const [showLyrics, setShowLyrics] = useState(false)

  // Swipe state for album art
  const [artSwipeX, setArtSwipeX] = useState(0)
  const [artTransitioning, setArtTransitioning] = useState(false)
  const artStartX = useRef(0)
  const artStartY = useRef(0)
  const artSwiping = useRef(false)
  const artDecided = useRef(false)

  const handleArtTouchStart = useCallback((e: React.TouchEvent) => {
    if (artTransitioning) return
    artStartX.current = e.touches[0].clientX
    artStartY.current = e.touches[0].clientY
    artSwiping.current = false
    artDecided.current = false
  }, [artTransitioning])

  const handleArtTouchMove = useCallback((e: React.TouchEvent) => {
    if (artTransitioning) return
    const deltaX = e.touches[0].clientX - artStartX.current
    const deltaY = e.touches[0].clientY - artStartY.current

    if (!artDecided.current) {
      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) return
      artDecided.current = true
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        artSwiping.current = false
        return
      }
      artSwiping.current = true
    }

    if (!artSwiping.current) return
    setArtSwipeX(deltaX)
    e.preventDefault()
  }, [artTransitioning])

  const handleArtTouchEnd = useCallback(() => {
    if (!artSwiping.current) {
      setArtSwipeX(0)
      return
    }

    const THRESHOLD = 80
    if (artSwipeX < -THRESHOLD) {
      // Swiped left → next
      setArtTransitioning(true)
      setArtSwipeX(-300)
      setTimeout(() => {
        next()
        setArtSwipeX(0)
        setArtTransitioning(false)
      }, 200)
    } else if (artSwipeX > THRESHOLD) {
      // Swiped right → previous
      setArtTransitioning(true)
      setArtSwipeX(300)
      setTimeout(() => {
        previous()
        setArtSwipeX(0)
        setArtTransitioning(false)
      }, 200)
    } else {
      setArtTransitioning(true)
      setArtSwipeX(0)
      setTimeout(() => setArtTransitioning(false), 200)
    }

    artSwiping.current = false
    artDecided.current = false
  }, [artSwipeX, next, previous])

  function handleNavigateToArtist() {
    if (!currentTrack) return
    setFullScreen(false)
    navigateToArtist(currentTrack.album_artist || currentTrack.artist)
  }

  function handleNavigateToAlbum() {
    if (!currentTrack) return
    setFullScreen(false)
    navigateToAlbum(currentTrack.album_artist || currentTrack.artist, currentTrack.album)
  }

  if (!currentTrack) return null

  const upNext = queue.slice(queueIndex + 1)
  const artOpacity = 1 - Math.min(Math.abs(artSwipeX) / 200, 0.5)

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden">
      {/* Blurred album art background */}
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url(/api/stream/art/${currentTrack.id})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(60px) brightness(0.3)',
          transform: 'scale(1.2)',
        }}
      />
      {/* Dark overlay for readability */}
      <div className="absolute inset-0 z-0 bg-black/40" />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3 flex-shrink-0">
        <button
          onClick={() => setFullScreen(false)}
          className="p-2 text-white/60 hover:text-white transition-colors"
        >
          <ChevronDown size={24} />
        </button>
        <span className="text-xs text-white/50 uppercase tracking-wider font-medium">
          Now Playing
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowLyrics(!showLyrics); if (!showLyrics) setQueueVisible(false) }}
            className={`p-2 transition-colors ${showLyrics ? 'text-[var(--color-accent)]' : 'text-white/60 hover:text-white'}`}
          >
            <AlignLeft size={20} />
          </button>
          <button
            onClick={() => { setQueueVisible(!isQueueVisible); if (!isQueueVisible) setShowLyrics(false) }}
            className={`p-2 transition-colors ${isQueueVisible ? 'text-[var(--color-accent)]' : 'text-white/60 hover:text-white'}`}
          >
            <ListMusic size={22} />
          </button>
        </div>
      </div>

      {showLyrics && !isQueueVisible ? (
        /* Lyrics view */
        <div className="relative z-10 flex-1 min-h-0">
          <SyncedLyrics trackId={currentTrack.id} currentTime={currentTime} />
        </div>
      ) : isQueueVisible ? (
        /* Queue view */
        <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-4">
          <h3 className="text-lg font-bold text-white mb-3">Queue</h3>

          {/* Currently playing */}
          <div className="mb-4">
            <p className="text-xs text-white/50 uppercase tracking-wider mb-2">Now Playing</p>
            <div className="flex items-center gap-3 p-2 rounded-lg bg-white/10">
              <img
                src={`/api/stream/art/${currentTrack.id}`}
                alt=""
                className="w-10 h-10 rounded object-cover bg-white/5"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[var(--color-accent)] truncate">{currentTrack.title}</div>
                <button
                  onClick={handleNavigateToArtist}
                  className="text-xs text-white/50 truncate hover:text-white hover:underline transition-colors"
                >
                  {currentTrack.artist}
                </button>
              </div>
            </div>
          </div>

          {/* Up next */}
          {upNext.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-white/50 uppercase tracking-wider">Up Next</p>
                <button
                  onClick={clearQueue}
                  className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors"
                >
                  <Trash2 size={12} />
                  Clear
                </button>
              </div>
              <div className="space-y-1">
                {upNext.map((track, i) => (
                  <div
                    key={`${track.id}-${i}`}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 transition-colors group"
                  >
                    <button
                      onClick={() => playTrack(track, queue)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <img
                        src={`/api/stream/art/${track.id}`}
                        alt=""
                        className="w-10 h-10 rounded object-cover bg-white/5"
                      />
                      <div className="min-w-0">
                        <div className="text-sm text-white truncate">{track.title}</div>
                        <div className="text-xs text-white/50 truncate">{track.artist}</div>
                      </div>
                    </button>
                    <button
                      onClick={() => removeFromQueue(queueIndex + 1 + i)}
                      className="p-1 text-white/30 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {upNext.length === 0 && (
            <p className="text-sm text-white/40 text-center py-8">Queue is empty</p>
          )}
        </div>
      ) : (
        /* Main now-playing content */
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-8 pb-4 min-h-0">
          {/* Album art with swipe */}
          <div
            className="w-full max-w-[min(70vw,360px)] aspect-square mb-8 flex-shrink-0"
            onTouchStart={handleArtTouchStart}
            onTouchMove={handleArtTouchMove}
            onTouchEnd={handleArtTouchEnd}
          >
            <img
              src={`/api/stream/art/${currentTrack.id}`}
              alt={currentTrack.album}
              className="w-full h-full rounded-xl object-cover shadow-2xl bg-white/5"
              style={{
                transform: `translateX(${artSwipeX}px)`,
                opacity: artOpacity,
                transition: artTransitioning ? 'transform 0.2s ease-out, opacity 0.2s ease-out' : 'none',
                willChange: artSwiping.current ? 'transform, opacity' : 'auto',
              }}
              onError={(e) => {
                const img = e.target as HTMLImageElement
                img.style.background = 'rgba(255,255,255,0.05)'
              }}
            />
          </div>

          {/* Track info — clickable */}
          <div className="w-full max-w-[min(70vw,360px)] text-center mb-6">
            <button
              onClick={handleNavigateToAlbum}
              className="block w-full"
            >
              <h2 className="text-xl font-bold text-white truncate hover:underline decoration-white/30 transition-colors">
                {currentTrack.title}
              </h2>
            </button>
            <button
              onClick={handleNavigateToArtist}
              className="block w-full mt-1"
            >
              <p className="text-sm text-white/70 truncate hover:underline hover:text-white decoration-white/30 transition-colors">
                {currentTrack.artist}
              </p>
            </button>
            <button
              onClick={handleNavigateToAlbum}
              className="block w-full mt-0.5"
            >
              <p className="text-xs text-white/50 truncate hover:underline hover:text-white/70 decoration-white/20 transition-colors">
                {currentTrack.album}
              </p>
            </button>
          </div>
        </div>
      )}

      {/* Controls — always visible at bottom */}
      <div className="relative z-10 flex-shrink-0 px-8 pb-8 md:pb-6">
        {/* Seek bar */}
        <div className="w-full max-w-md mx-auto mb-4">
          <input
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={currentTime}
            onChange={(e) => seek(parseFloat(e.target.value))}
            className="w-full h-1 accent-[var(--color-accent)] cursor-pointer"
          />
          <div className="flex justify-between text-xs text-white/50 mt-1 tabular-nums">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Transport controls */}
        <div className="flex items-center justify-center gap-6 max-w-md mx-auto">
          <button
            onClick={toggleShuffle}
            className={`p-2 transition-colors ${shuffle ? 'text-[var(--color-accent)]' : 'text-white/50 hover:text-white'}`}
          >
            <Shuffle size={20} />
          </button>
          <button
            onClick={previous}
            className="p-2 text-white hover:scale-105 transition-transform"
          >
            <SkipBack size={28} fill="currentColor" />
          </button>
          <button
            onClick={togglePlay}
            className="p-4 rounded-full bg-white text-black hover:scale-105 transition-transform"
          >
            {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
          </button>
          <button
            onClick={next}
            className="p-2 text-white hover:scale-105 transition-transform"
          >
            <SkipForward size={28} fill="currentColor" />
          </button>
          <button
            onClick={cycleRepeat}
            className={`p-2 transition-colors ${repeat !== 'off' ? 'text-[var(--color-accent)]' : 'text-white/50 hover:text-white'}`}
          >
            <RepeatIcon mode={repeat} />
          </button>
        </div>
      </div>
    </div>
  )
}
