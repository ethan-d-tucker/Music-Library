import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { usePlayerStore } from '../lib/player.ts'

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function NowPlayingBar() {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const volume = usePlayerStore((s) => s.volume)
  const isMuted = usePlayerStore((s) => s.isMuted)
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const next = usePlayerStore((s) => s.next)
  const previous = usePlayerStore((s) => s.previous)
  const seek = usePlayerStore((s) => s.seek)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const toggleMute = usePlayerStore((s) => s.toggleMute)
  const setFullScreen = usePlayerStore((s) => s.setFullScreen)

  if (!currentTrack) return null

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <>
      {/* Progress bar — thin line above the bar */}
      <div
        className="absolute top-0 left-0 right-0 h-1 bg-[var(--color-surface-2)] cursor-pointer group"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const pct = (e.clientX - rect.left) / rect.width
          seek(pct * duration)
        }}
      >
        <div
          className="h-full bg-[var(--color-accent)] transition-[width] duration-150"
          style={{ width: `${progress}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `${progress}%`, transform: `translate(-50%, -50%)` }}
        />
      </div>

      {/* Bar content */}
      <div className="flex items-center h-full px-3 md:px-4 gap-3">
        {/* Track info — clickable to open full screen */}
        <button
          onClick={() => setFullScreen(true)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <img
            src={`/api/stream/art/${currentTrack.id}`}
            alt=""
            className="w-10 h-10 rounded object-cover flex-shrink-0 bg-[var(--color-surface-2)]"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--color-text)] truncate">
              {currentTrack.title}
            </div>
            <div className="text-xs text-[var(--color-text-muted)] truncate">
              {currentTrack.artist}
            </div>
          </div>
        </button>

        {/* Controls */}
        <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
          <button
            onClick={previous}
            className="hidden md:flex p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <SkipBack size={18} />
          </button>
          <button
            onClick={togglePlay}
            className="p-2 rounded-full bg-white text-black hover:scale-105 transition-transform"
          >
            {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button
            onClick={next}
            className="hidden md:flex p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <SkipForward size={18} />
          </button>
        </div>

        {/* Desktop: time + volume */}
        <div className="hidden md:flex items-center gap-3 flex-shrink-0 ml-2">
          <span className="text-xs text-[var(--color-text-muted)] tabular-nums w-20 text-center">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <button
            onClick={toggleMute}
            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={isMuted ? 0 : volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-20 h-1 accent-[var(--color-accent)]"
          />
        </div>
      </div>
    </>
  )
}
