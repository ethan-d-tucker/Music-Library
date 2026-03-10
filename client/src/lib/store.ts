import { create } from 'zustand'

export type Page = 'home' | 'library' | 'import' | 'search' | 'playlists' | 'downloads'
export type LibraryTab = 'artists' | 'albums' | 'songs'

export interface AuthUser {
  id: number
  username: string
  displayName: string
}

interface AppState {
  page: Page
  setPage: (page: Page) => void

  // Library navigation
  libraryTab: LibraryTab
  setLibraryTab: (tab: LibraryTab) => void
  selectedArtist: string | null
  selectedAlbum: string | null
  setSelectedArtist: (artist: string | null) => void
  setSelectedAlbum: (album: string | null) => void

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
  setPage: (page) => set({ page, libraryTab: 'artists', selectedArtist: null, selectedAlbum: null, selectedPlaylistId: null }),

  libraryTab: 'artists',
  setLibraryTab: (tab) => set({ libraryTab: tab, selectedArtist: null, selectedAlbum: null }),

  selectedArtist: null,
  selectedAlbum: null,
  setSelectedArtist: (artist) => set({ selectedArtist: artist, selectedAlbum: null }),
  setSelectedAlbum: (album) => set({ selectedAlbum: album }),

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
