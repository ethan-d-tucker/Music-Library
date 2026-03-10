import { create } from 'zustand'
import { recordPlay, type TrackRow } from './api.ts'

export type RepeatMode = 'off' | 'one' | 'all'

interface PlayerState {
  // Current track
  currentTrack: TrackRow | null
  // Queue
  queue: TrackRow[]
  queueIndex: number
  // Playback state
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  shuffle: boolean
  repeat: RepeatMode
  // UI state
  isFullScreen: boolean
  isQueueVisible: boolean

  // Actions
  playTrack: (track: TrackRow, queue?: TrackRow[]) => void
  playAlbum: (tracks: TrackRow[], startIndex?: number) => void
  playPlaylist: (tracks: TrackRow[], startIndex?: number) => void
  togglePlay: () => void
  next: () => void
  previous: () => void
  seek: (time: number) => void
  setVolume: (vol: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  addToQueue: (track: TrackRow) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
  setFullScreen: (open: boolean) => void
  setQueueVisible: (open: boolean) => void
}

// Singleton audio element — never rendered in React
let audio: HTMLAudioElement | null = null

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio()
    audio.preload = 'auto'
  }
  return audio
}

// Shuffle helper: Fisher-Yates
function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

function getArtUrl(track: TrackRow): string {
  return `/api/stream/art/${track.id}`
}

function updateMediaSession(track: TrackRow) {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: [
      { src: getArtUrl(track), sizes: '512x512', type: 'image/jpeg' },
    ],
  })
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  // Set up audio event listeners once
  const a = getAudio()

  a.addEventListener('timeupdate', () => {
    set({ currentTime: a.currentTime })
  })

  a.addEventListener('loadedmetadata', () => {
    set({ duration: a.duration })
  })

  a.addEventListener('ended', () => {
    const { repeat } = get()
    if (repeat === 'one') {
      a.currentTime = 0
      a.play()
      return
    }
    get().next()
  })

  a.addEventListener('play', () => set({ isPlaying: true }))
  a.addEventListener('pause', () => set({ isPlaying: false }))

  // MediaSession action handlers
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => get().togglePlay())
    navigator.mediaSession.setActionHandler('pause', () => get().togglePlay())
    navigator.mediaSession.setActionHandler('nexttrack', () => get().next())
    navigator.mediaSession.setActionHandler('previoustrack', () => get().previous())
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) get().seek(details.seekTime)
    })
  }

  function playIndex(index: number) {
    const { queue } = get()
    if (index < 0 || index >= queue.length) return
    const track = queue[index]
    a.src = `/api/stream/${track.id}`
    a.play()
    set({ currentTrack: track, queueIndex: index, currentTime: 0, duration: 0 })
    updateMediaSession(track)
    recordPlay(track.id).catch(() => {}) // fire-and-forget
  }

  return {
    currentTrack: null,
    queue: [],
    queueIndex: 0,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    isMuted: false,
    shuffle: false,
    repeat: 'off',
    isFullScreen: false,
    isQueueVisible: false,

    playTrack(track, queue) {
      const newQueue = queue || [track]
      const index = newQueue.findIndex((t) => t.id === track.id)
      set({ queue: newQueue, queueIndex: index >= 0 ? index : 0 })
      playIndex(index >= 0 ? index : 0)
    },

    playAlbum(tracks, startIndex = 0) {
      set({ queue: tracks })
      playIndex(startIndex)
    },

    playPlaylist(tracks, startIndex = 0) {
      const { shuffle } = get()
      if (shuffle) {
        const current = tracks[startIndex]
        const rest = tracks.filter((_, i) => i !== startIndex)
        const shuffled = [current, ...shuffleArray(rest)]
        set({ queue: shuffled })
        playIndex(0)
      } else {
        set({ queue: tracks })
        playIndex(startIndex)
      }
    },

    togglePlay() {
      if (a.paused) {
        a.play()
      } else {
        a.pause()
      }
    },

    next() {
      const { queueIndex, queue, repeat } = get()
      let nextIndex = queueIndex + 1
      if (nextIndex >= queue.length) {
        if (repeat === 'all') {
          nextIndex = 0
        } else {
          // End of queue, stop
          set({ isPlaying: false })
          return
        }
      }
      playIndex(nextIndex)
    },

    previous() {
      // If more than 3 seconds in, restart current track
      if (a.currentTime > 3) {
        a.currentTime = 0
        return
      }
      const { queueIndex, queue, repeat } = get()
      let prevIndex = queueIndex - 1
      if (prevIndex < 0) {
        if (repeat === 'all') {
          prevIndex = queue.length - 1
        } else {
          a.currentTime = 0
          return
        }
      }
      playIndex(prevIndex)
    },

    seek(time) {
      a.currentTime = time
      set({ currentTime: time })
    },

    setVolume(vol) {
      a.volume = vol
      set({ volume: vol, isMuted: vol === 0 })
    },

    toggleMute() {
      const { isMuted, volume } = get()
      if (isMuted) {
        a.volume = volume || 1
        set({ isMuted: false })
      } else {
        a.volume = 0
        set({ isMuted: true })
      }
    },

    toggleShuffle() {
      const { shuffle, queue, queueIndex, currentTrack } = get()
      if (!shuffle && currentTrack) {
        // Enable shuffle: keep current track at index 0, shuffle the rest
        const rest = queue.filter((_, i) => i !== queueIndex)
        const shuffled = [currentTrack, ...shuffleArray(rest)]
        set({ shuffle: true, queue: shuffled, queueIndex: 0 })
      } else {
        set({ shuffle: !shuffle })
      }
    },

    cycleRepeat() {
      const { repeat } = get()
      const modes: RepeatMode[] = ['off', 'all', 'one']
      const nextMode = modes[(modes.indexOf(repeat) + 1) % modes.length]
      set({ repeat: nextMode })
    },

    addToQueue(track) {
      set((s) => ({ queue: [...s.queue, track] }))
    },

    removeFromQueue(index) {
      const { queue, queueIndex } = get()
      const newQueue = queue.filter((_, i) => i !== index)
      let newIndex = queueIndex
      if (index < queueIndex) newIndex--
      else if (index === queueIndex) {
        // Removing current track, play next
        if (newQueue.length > 0) {
          newIndex = Math.min(queueIndex, newQueue.length - 1)
          set({ queue: newQueue, queueIndex: newIndex })
          playIndex(newIndex)
          return
        } else {
          a.pause()
          set({ queue: [], queueIndex: 0, currentTrack: null, isPlaying: false })
          return
        }
      }
      set({ queue: newQueue, queueIndex: newIndex })
    },

    clearQueue() {
      a.pause()
      a.src = ''
      set({
        queue: [],
        queueIndex: 0,
        currentTrack: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
      })
    },

    setFullScreen(open) {
      set({ isFullScreen: open })
    },

    setQueueVisible(open) {
      set({ isQueueVisible: open })
    },
  }
})
