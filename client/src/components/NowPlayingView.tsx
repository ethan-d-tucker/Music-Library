import { useState } from 'react'
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  ChevronDown, ListMusic, X, AlignLeft,
} from 'lucide-react'
import { usePlayerStore, type RepeatMode } from '../lib/player.ts'
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

  const [showLyrics, setShowLyrics] = useState(false)

  if (!currentTrack) return null

  const upNext = queue.slice(queueIndex + 1)

  return (
    <div className="fixed inset-0 z-[100] bg-[var(--color-bg)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <button
          onClick={() => setFullScreen(false)}
          className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          <ChevronDown size={24} />
        </button>
        <span className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-medium">
          Now Playing
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowLyrics(!showLyrics); if (!showLyrics) setQueueVisible(false) }}
            className={`p-2 transition-colors ${showLyrics ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
          >
            <AlignLeft size={20} />
          </button>
          <button
            onClick={() => { setQueueVisible(!isQueueVisible); if (!isQueueVisible) setShowLyrics(false) }}
            className={`p-2 transition-colors ${isQueueVisible ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
          >
            <ListMusic size={22} />
          </button>
        </div>
      </div>

      {showLyrics && !isQueueVisible ? (
        /* Lyrics view */
        <SyncedLyrics trackId={currentTrack.id} currentTime={currentTime} />
      ) : isQueueVisible ? (
        /* Queue view */
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <h3 className="text-lg font-bold text-[var(--color-text)] mb-3">Queue</h3>

          {/* Currently playing */}
          <div className="mb-4">
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Now Playing</p>
            <div className="flex items-center gap-3 p-2 rounded-lg bg-[var(--color-surface)]">
              <img
                src={`/api/stream/art/${currentTrack.id}`}
                alt=""
                className="w-10 h-10 rounded object-cover bg-[var(--color-surface-2)]"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[var(--color-accent)] truncate">{currentTrack.title}</div>
                <div className="text-xs text-[var(--color-text-muted)] truncate">{currentTrack.artist}</div>
              </div>
            </div>
          </div>

          {/* Up next */}
          {upNext.length > 0 && (
            <div>
              <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Up Next</p>
              <div className="space-y-1">
                {upNext.map((track, i) => (
                  <div
                    key={`${track.id}-${i}`}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--color-surface)] transition-colors group"
                  >
                    <button
                      onClick={() => playTrack(track, queue)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <img
                        src={`/api/stream/art/${track.id}`}
                        alt=""
                        className="w-10 h-10 rounded object-cover bg-[var(--color-surface-2)]"
                      />
                      <div className="min-w-0">
                        <div className="text-sm text-[var(--color-text)] truncate">{track.title}</div>
                        <div className="text-xs text-[var(--color-text-muted)] truncate">{track.artist}</div>
                      </div>
                    </button>
                    <button
                      onClick={() => removeFromQueue(queueIndex + 1 + i)}
                      className="p-1 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-danger)] transition-all"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {upNext.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-8">Queue is empty</p>
          )}
        </div>
      ) : (
        /* Main now-playing content */
        <div className="flex-1 flex flex-col items-center justify-center px-8 pb-4 min-h-0">
          {/* Album art */}
          <div className="w-full max-w-[min(70vw,360px)] aspect-square mb-8 flex-shrink-0">
            <img
              src={`/api/stream/art/${currentTrack.id}`}
              alt={currentTrack.album}
              className="w-full h-full rounded-xl object-cover shadow-2xl bg-[var(--color-surface-2)]"
              onError={(e) => {
                const img = e.target as HTMLImageElement
                img.style.background = 'var(--color-surface-2)'
              }}
            />
          </div>

          {/* Track info */}
          <div className="w-full max-w-[min(70vw,360px)] text-center mb-6">
            <h2 className="text-xl font-bold text-[var(--color-text)] truncate">{currentTrack.title}</h2>
            <p className="text-sm text-[var(--color-text-muted)] truncate mt-1">{currentTrack.artist}</p>
            <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">{currentTrack.album}</p>
          </div>
        </div>
      )}

      {/* Controls — always visible at bottom */}
      <div className="flex-shrink-0 px-8 pb-8 md:pb-6">
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
          <div className="flex justify-between text-xs text-[var(--color-text-muted)] mt-1 tabular-nums">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Transport controls */}
        <div className="flex items-center justify-center gap-6 max-w-md mx-auto">
          <button
            onClick={toggleShuffle}
            className={`p-2 transition-colors ${shuffle ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
          >
            <Shuffle size={20} />
          </button>
          <button
            onClick={previous}
            className="p-2 text-[var(--color-text)] hover:scale-105 transition-transform"
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
            className="p-2 text-[var(--color-text)] hover:scale-105 transition-transform"
          >
            <SkipForward size={28} fill="currentColor" />
          </button>
          <button
            onClick={cycleRepeat}
            className={`p-2 transition-colors ${repeat !== 'off' ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
          >
            <RepeatIcon mode={repeat} />
          </button>
        </div>
      </div>
    </div>
  )
}
