import { useRef, useState, useCallback, type ReactNode } from 'react'
import { ListPlus, Check } from 'lucide-react'

interface SwipeableTrackRowProps {
  children: ReactNode
  onSwipeRight: () => void
  disabled?: boolean
}

export function SwipeableTrackRow({ children, onSwipeRight, disabled }: SwipeableTrackRowProps) {
  const [translateX, setTranslateX] = useState(0)
  const [transitioning, setTransitioning] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const swiping = useRef(false)
  const decided = useRef(false)

  const THRESHOLD = 80

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled || transitioning) return
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    swiping.current = false
    decided.current = false
    setConfirmed(false)
  }, [disabled, transitioning])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (disabled || transitioning) return
    const deltaX = e.touches[0].clientX - startX.current
    const deltaY = e.touches[0].clientY - startY.current

    // Decide direction in first 10px of movement
    if (!decided.current) {
      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) return
      decided.current = true
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        // Vertical scroll — bail out
        swiping.current = false
        return
      }
      swiping.current = true
    }

    if (!swiping.current) return

    // Only allow rightward swipe, with resistance after threshold
    const clamped = Math.max(0, deltaX)
    const dampened = clamped > THRESHOLD
      ? THRESHOLD + (clamped - THRESHOLD) * 0.3
      : clamped
    setTranslateX(dampened)

    // Prevent vertical scroll while swiping horizontally
    if (clamped > 10) {
      e.preventDefault()
    }
  }, [disabled, transitioning])

  const handleTouchEnd = useCallback(() => {
    if (disabled || !swiping.current) {
      setTranslateX(0)
      return
    }

    if (translateX >= THRESHOLD) {
      // Trigger action
      setConfirmed(true)
      onSwipeRight()
      setTransitioning(true)
      // Snap back after brief confirmation
      setTimeout(() => {
        setTranslateX(0)
        setTransitioning(false)
        setTimeout(() => setConfirmed(false), 300)
      }, 400)
    } else {
      // Snap back
      setTransitioning(true)
      setTranslateX(0)
      setTimeout(() => setTransitioning(false), 200)
    }

    swiping.current = false
    decided.current = false
  }, [disabled, translateX, onSwipeRight])

  const progress = Math.min(translateX / THRESHOLD, 1)
  const isOverThreshold = translateX >= THRESHOLD

  return (
    <div className="relative overflow-hidden rounded-md">
      {/* Background action revealed on swipe */}
      <div
        className={`absolute inset-0 flex items-center pl-4 transition-colors duration-150 ${
          confirmed ? 'bg-green-600' : isOverThreshold ? 'bg-green-500' : 'bg-green-500/70'
        }`}
        style={{ opacity: Math.min(progress * 1.5, 1) }}
      >
        {confirmed ? (
          <div className="flex items-center gap-2 text-white font-medium text-sm">
            <Check size={18} />
            <span>Added!</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-white font-medium text-sm"
            style={{ transform: `scale(${0.8 + progress * 0.2})` }}
          >
            <ListPlus size={18} />
            <span>{isOverThreshold ? 'Release to add' : 'Queue'}</span>
          </div>
        )}
      </div>

      {/* Foreground content */}
      <div
        style={{
          transform: `translateX(${translateX}px)`,
          transition: transitioning ? 'transform 0.2s ease-out' : 'none',
          willChange: swiping.current ? 'transform' : 'auto',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  )
}
