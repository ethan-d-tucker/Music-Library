import { useAppStore } from './lib/store.ts'
import { Layout } from './components/Layout.tsx'
import { LibraryBrowser } from './components/LibraryBrowser.tsx'
import { ImportPage } from './components/ImportPage.tsx'
import { SearchPage } from './components/SearchPage.tsx'
import { PlaylistsPage } from './components/PlaylistsPage.tsx'
import { DownloadsPage } from './components/DownloadsPage.tsx'

export default function App() {
  const page = useAppStore((s) => s.page)

  return (
    <Layout>
      {page === 'library' && <LibraryBrowser />}
      {page === 'import' && <ImportPage />}
      {page === 'search' && <SearchPage />}
      {page === 'downloads' && <DownloadsPage />}
      {page === 'playlists' && <PlaylistsPage />}
    </Layout>
  )
}
