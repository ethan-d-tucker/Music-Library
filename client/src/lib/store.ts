import { create } from 'zustand'

export type Page = 'home' | 'library' | 'downloads' | 'import' | 'playlists'

export interface AuthUser {
  id: number
  username: string
  displayName: string
}

interface AppState {
  page: Page
  setPage: (page: Page) => void

  // Import state
  batchJobId: string | null
  setBatchJobId: (id: string | null) => void

  // Selected playlist
  selectedPlaylistId: number | null
  setSelectedPlaylistId: (id: number | null) => void

  // Auth
  currentUser: AuthUser | null
  authToken: string | null
  setAuth: (user: AuthUser, token: string) => void
  clearAuth: () => void
  authLoading: boolean
  setAuthLoading: (loading: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  page: 'home',
  setPage: (page) => set({ page, selectedPlaylistId: null }),

  batchJobId: null,
  setBatchJobId: (id) => set({ batchJobId: id }),

  selectedPlaylistId: null,
  setSelectedPlaylistId: (id) => set({ selectedPlaylistId: id }),

  currentUser: null,
  authToken: localStorage.getItem('authToken'),
  setAuth: (user, token) => {
    localStorage.setItem('authToken', token)
    set({ currentUser: user, authToken: token })
  },
  clearAuth: () => {
    localStorage.removeItem('authToken')
    set({ currentUser: null, authToken: null })
  },
  authLoading: true,
  setAuthLoading: (loading) => set({ authLoading: loading }),
}))
