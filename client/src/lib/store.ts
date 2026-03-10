import { create } from 'zustand'

export type Page = 'home' | 'library' | 'search' | 'playlists' | 'settings'
export type LibraryTab = 'artists' | 'albums' | 'songs'
export type SettingsTab = 'manager' | 'import' | 'downloads'

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

  // Settings tab
  settingsTab: SettingsTab
  setSettingsTab: (tab: SettingsTab) => void

  // Import state
  batchJobId: string | null
  setBatchJobId: (id: string | null) => void

  // Selected playlist
  selectedPlaylistId: number | null
  setSelectedPlaylistId: (id: number | null) => void

  // Navigation helpers
  navigateToArtist: (artist: string) => void
  navigateToAlbum: (artist: string, album: string) => void

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

  settingsTab: 'manager',
  setSettingsTab: (tab) => set({ settingsTab: tab }),

  batchJobId: null,
  setBatchJobId: (id) => set({ batchJobId: id }),

  selectedPlaylistId: null,
  setSelectedPlaylistId: (id) => set({ selectedPlaylistId: id }),

  navigateToArtist: (artist) => set({
    page: 'library', libraryTab: 'artists', selectedArtist: artist, selectedAlbum: null, selectedPlaylistId: null,
  }),
  navigateToAlbum: (artist, album) => set({
    page: 'library', libraryTab: 'artists', selectedArtist: artist, selectedAlbum: album, selectedPlaylistId: null,
  }),

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
