import { useEffect } from 'react'
import { useAppStore } from './lib/store.ts'
import { Layout } from './components/Layout.tsx'
import { HomePage } from './components/HomePage.tsx'
import { ManagerPage } from './components/ManagerPage.tsx'
import { DownloadsPage } from './components/DownloadsPage.tsx'
import { ImportPage } from './components/ImportPage.tsx'
import { PlaylistsPage } from './components/PlaylistsPage.tsx'
import { LoginPage } from './components/LoginPage.tsx'
import { getMe } from './lib/api.ts'

export default function App() {
  const page = useAppStore((s) => s.page)
  const currentUser = useAppStore((s) => s.currentUser)
  const authToken = useAppStore((s) => s.authToken)
  const authLoading = useAppStore((s) => s.authLoading)
  const setAuth = useAppStore((s) => s.setAuth)
  const clearAuth = useAppStore((s) => s.clearAuth)
  const setAuthLoading = useAppStore((s) => s.setAuthLoading)

  // Validate saved token on mount
  useEffect(() => {
    if (authToken && !currentUser) {
      getMe()
        .then((r) => setAuth(r.user, authToken))
        .catch(() => clearAuth())
        .finally(() => setAuthLoading(false))
    } else {
      setAuthLoading(false)
    }
  }, [])

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!currentUser) {
    return <LoginPage />
  }

  return (
    <Layout>
      {page === 'home' && <HomePage />}
      {page === 'library' && <ManagerPage />}
      {page === 'downloads' && <DownloadsPage />}
      {page === 'import' && <ImportPage />}
      {page === 'playlists' && <PlaylistsPage />}
    </Layout>
  )
}
