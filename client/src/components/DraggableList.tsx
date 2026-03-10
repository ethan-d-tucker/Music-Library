import { useState, useRef, useCallback, type ReactNode } from 'react'
import { GripVertical } from 'lucide-react'

interface DraggableListProps<T> {
  items: T[]
  keyExtractor: (item: T) => string | number
  renderItem: (item: T, index: number, isDragging: boolean) => ReactNode
  onReorder: (items: T[]) => void
}

export function DraggableList<T>({ items, keyExtractor, renderItem, onReorder }: DraggableListProps<T>) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const startY = useRef(0)
  const currentY = useRef(0)

  const handleTouchStart = useCallback((index: number, e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY
    currentY.current = e.touches[0].clientY

    longPressTimer.current = setTimeout(() => {
      setDragIndex(index)
      setDropIndex(index)
      setIsDragging(true)
      // Vibrate for haptic feedback if available
      if (navigator.vibrate) navigator.vibrate(50)
    }, 300)
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const deltaY = Math.abs(e.touches[0].clientY - startY.current)

    // Cancel long press if user moves too much before it triggers
    if (!isDragging && deltaY > 10 && longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
      return
    }

    if (!isDragging || dragIndex === null || !containerRef.current) return

    e.preventDefault()
    currentY.current = e.touches[0].clientY

    // Calculate which item we're hovering over
    const container = containerRef.current
    const children = container.children
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      if (currentY.current < midY) {
        setDropIndex(i)
        return
      }
    }
    setDropIndex(children.length - 1)
  }, [isDragging, dragIndex])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }

    if (isDragging && dragIndex !== null && dropIndex !== null && dragIndex !== dropIndex) {
      const newItems = [...items]
      const [moved] = newItems.splice(dragIndex, 1)
      newItems.splice(dropIndex, 0, moved)
      onReorder(newItems)
    }

    setDragIndex(null)
    setDropIndex(null)
    setIsDragging(false)
  }, [isDragging, dragIndex, dropIndex, items, onReorder])

  // Desktop drag support
  const handleMouseDown = useCallback((index: number) => {
    setDragIndex(index)
    setDropIndex(index)
    setIsDragging(true)

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const children = containerRef.current.children
      for (let i = 0; i < children.length; i++) {
        const rect = children[i].getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        if (e.clientY < midY) {
          setDropIndex(i)
          return
        }
      }
      setDropIndex(children.length - 1)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      // Use a timeout to read the latest state
      setTimeout(() => {
        setIsDragging(false)
        setDragIndex(null)
        setDropIndex(null)
      }, 0)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [])

  // Handle reorder on state change for desktop drag
  const prevDragRef = useRef<{ dragIndex: number; dropIndex: number } | null>(null)
  if (!isDragging && prevDragRef.current) {
    const { dragIndex: di, dropIndex: dri } = prevDragRef.current
    prevDragRef.current = null
    if (di !== dri) {
      const newItems = [...items]
      const [moved] = newItems.splice(di, 1)
      newItems.splice(dri, 0, moved)
      // Schedule reorder for next tick
      setTimeout(() => onReorder(newItems), 0)
    }
  }
  if (isDragging && dragIndex !== null && dropIndex !== null) {
    prevDragRef.current = { dragIndex, dropIndex }
  }

  return (
    <div
      ref={containerRef}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="space-y-0.5"
    >
      {items.map((item, i) => {
        const key = keyExtractor(item)
        const isBeingDragged = dragIndex === i && isDragging
        const isDropTarget = dropIndex === i && isDragging && dragIndex !== i

        return (
          <div
            key={key}
            className={`flex items-center gap-1 transition-all duration-150 ${
              isBeingDragged ? 'opacity-50 scale-95' : ''
            } ${isDropTarget ? 'border-t-2 border-[var(--color-accent)]' : ''}`}
          >
            {/* Drag handle */}
            <button
              onTouchStart={(e) => handleTouchStart(i, e)}
              onMouseDown={() => handleMouseDown(i)}
              className="flex-shrink-0 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-grab active:cursor-grabbing touch-none"
            >
              <GripVertical size={16} />
            </button>
            <div className="flex-1 min-w-0">
              {renderItem(item, i, isBeingDragged)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
