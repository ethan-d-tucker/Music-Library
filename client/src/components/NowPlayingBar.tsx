import { Play, Pause } from 'lucide-react'
import { usePlayerStore } from '../lib/player.ts'

export function NowPlayingBar() {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const seek = usePlayerStore((s) => s.seek)
  const setFullScreen = usePlayerStore((s) => s.setFullScreen)

  if (!currentTrack) return null

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <>
      {/* Progress bar */}
      <div
        className="absolute top-0 left-0 right-0 h-0.5 bg-[var(--color-surface-2)] cursor-pointer"
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
      </div>

      <div className="flex items-center h-full px-3 gap-3">
        <button
          onClick={() => setFullScreen(true)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <img
            src={`/api/stream/art/${currentTrack.id}`}
            alt=""
            className="w-8 h-8 rounded object-cover flex-shrink-0 bg-[var(--color-surface-2)]"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div className="min-w-0">
            <div className="text-xs font-medium text-[var(--color-text)] truncate">{currentTrack.title}</div>
            <div className="text-xs text-[var(--color-text-muted)] truncate">{currentTrack.artist}</div>
          </div>
        </button>

        <button
          onClick={togglePlay}
          className="p-1.5 rounded-full bg-white text-black hover:scale-105 transition-transform flex-shrink-0"
        >
          {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
      </div>
    </>
  )
}
