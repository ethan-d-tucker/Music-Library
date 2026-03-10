import { useState, useEffect, useRef, useCallback } from 'react'

interface LyricLine {
  time: number
  text: string
}

function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const line of lrc.split('\n')) {
    const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/)
    if (match) {
      const minutes = parseInt(match[1])
      const seconds = parseInt(match[2])
      const ms = match[3].length === 2 ? parseInt(match[3]) * 10 : parseInt(match[3])
      const time = minutes * 60 + seconds + ms / 1000
      const text = match[4].trim()
      if (text) lines.push({ time, text })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}

interface SyncedLyricsProps {
  trackId: number
  currentTime: number
}

export function SyncedLyrics({ trackId, currentTime }: SyncedLyricsProps) {
  const [syncedLines, setSyncedLines] = useState<LyricLine[] | null>(null)
  const [plainText, setPlainText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const activeRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    setSyncedLines(null)
    setPlainText(null)
    fetch(`/api/library/tracks/${trackId}/lyrics`)
      .then(r => r.json())
      .then((data: { plain: string; synced: string }) => {
        if (data.synced) {
          const parsed = parseLRC(data.synced)
          if (parsed.length > 0) {
            setSyncedLines(parsed)
          } else if (data.plain) {
            setPlainText(data.plain)
          }
        } else if (data.plain) {
          setPlainText(data.plain)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [trackId])

  // Find active line index
  const activeIndex = syncedLines
    ? syncedLines.reduce((acc, line, i) => (currentTime >= line.time ? i : acc), -1)
    : -1

  // Scroll to active line
  const lastScrolledIndex = useRef(-1)
  const scrollToActive = useCallback(() => {
    if (activeRef.current && lastScrolledIndex.current !== activeIndex) {
      lastScrolledIndex.current = activeIndex
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeIndex])

  useEffect(() => {
    scrollToActive()
  }, [scrollToActive])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--color-text-muted)] text-sm">Loading lyrics...</p>
      </div>
    )
  }

  if (syncedLines) {
    return (
      <div ref={containerRef} className="flex-1 overflow-y-auto px-6 py-8 scroll-smooth" style={{ scrollbarWidth: 'none' }}>
        <div className="min-h-[30vh]" />
        {syncedLines.map((line, i) => {
          const isActive = i === activeIndex
          return (
            <div
              key={i}
              ref={isActive ? activeRef : undefined}
              className={`py-2 transition-all duration-300 ${
                isActive
                  ? 'text-[var(--color-text)] text-xl font-bold'
                  : 'text-[var(--color-text-muted)] text-lg font-medium opacity-40'
              }`}
            >
              {line.text}
            </div>
          )
        })}
        <div className="min-h-[30vh]" />
      </div>
    )
  }

  if (plainText) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-8" style={{ scrollbarWidth: 'none' }}>
        <div className="text-[var(--color-text-muted)] text-sm whitespace-pre-wrap leading-relaxed">
          {plainText}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-[var(--color-text-muted)] text-sm">No lyrics available</p>
    </div>
  )
}
