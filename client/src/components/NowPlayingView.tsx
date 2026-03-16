import { Play, Pause, SkipBack, SkipForward, ChevronDown } from 'lucide-react'
import { usePlayerStore } from '../lib/player.ts'

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function NowPlayingView() {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const next = usePlayerStore((s) => s.next)
  const previous = usePlayerStore((s) => s.previous)
  const seek = usePlayerStore((s) => s.seek)
  const setFullScreen = usePlayerStore((s) => s.setFullScreen)

  if (!currentTrack) return null

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
        <div className="w-10" />
      </div>

      {/* Album art + track info */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-8 pb-4 min-h-0">
        <div className="w-full max-w-[min(70vw,360px)] aspect-square mb-8 flex-shrink-0">
          <img
            src={`/api/stream/art/${currentTrack.id}`}
            alt={currentTrack.album}
            className="w-full h-full rounded-xl object-cover shadow-2xl bg-white/5"
          />
        </div>

        <div className="w-full max-w-[min(70vw,360px)] text-center mb-6">
          <h2 className="text-xl font-bold text-white truncate">{currentTrack.title}</h2>
          <p className="text-sm text-white/70 truncate mt-1">{currentTrack.artist}</p>
          <p className="text-xs text-white/50 truncate mt-0.5">{currentTrack.album}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="relative z-10 flex-shrink-0 px-8 pb-8 md:pb-6">
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

        <div className="flex items-center justify-center gap-8 max-w-md mx-auto">
          <button onClick={previous} className="p-2 text-white hover:scale-105 transition-transform">
            <SkipBack size={28} fill="currentColor" />
          </button>
          <button onClick={togglePlay} className="p-4 rounded-full bg-white text-black hover:scale-105 transition-transform">
            {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
          </button>
          <button onClick={next} className="p-2 text-white hover:scale-105 transition-transform">
            <SkipForward size={28} fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  )
}
