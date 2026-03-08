import { create } from 'zustand'

export type Page = 'library' | 'import' | 'search' | 'playlists'
export type LibraryTab = 'artists' | 'albums' | 'songs'

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
}

export const useAppStore = create<AppState>((set) => ({
  page: 'library',
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
}))
