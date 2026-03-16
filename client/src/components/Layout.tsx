import type { ReactNode } from 'react'
import { Library, ListMusic, Home, LogOut, Download, Upload } from 'lucide-react'
import { useAppStore, type Page } from '../lib/store.ts'
import { usePlayerStore } from '../lib/player.ts'
import { NowPlayingBar } from './NowPlayingBar.tsx'
import { NowPlayingView } from './NowPlayingView.tsx'
import { logout as apiLogout } from '../lib/api.ts'

const navItems: { page: Page; label: string; icon: typeof Library }[] = [
  { page: 'home', label: 'Home', icon: Home },
  { page: 'library', label: 'Library', icon: Library },
  { page: 'downloads', label: 'Downloads', icon: Download },
  { page: 'import', label: 'Import', icon: Upload },
  { page: 'playlists', label: 'Playlists', icon: ListMusic },
]

export function Layout({ children }: { children: ReactNode }) {
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)
  const currentUser = useAppStore((s) => s.currentUser)
  const clearAuth = useAppStore((s) => s.clearAuth)
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const isFullScreen = usePlayerStore((s) => s.isFullScreen)
  const hasPlayer = currentTrack !== null

  async function handleLogout() {
    try { await apiLogout() } catch {}
    clearAuth()
  }

  return (
    <div className="flex h-[100dvh] flex-col md:flex-row overflow-hidden">
      {/* Desktop sidebar */}
      <nav className="hidden md:flex md:flex-col w-56 flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 overflow-y-auto">
        <div className="mb-6 flex items-center gap-2">
          <img src="/grumpy-cat.svg" alt="Grumpy Cat" className="w-8 h-8" />
          <h1 className="text-lg font-bold text-[var(--color-text)]">Music Library</h1>
        </div>
        <ul className="space-y-1 flex-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = page === item.page
            return (
              <li key={item.page}>
                <button
                  onClick={() => setPage(item.page)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent)]'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
                  }`}
                >
                  <Icon size={18} />
                  {item.label}
                </button>
              </li>
            )
          })}
        </ul>

        {/* User info + logout */}
        {currentUser && (
          <div className="border-t border-[var(--color-border)] pt-3 mt-3">
            <div className="flex items-center gap-3 px-2">
              <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {currentUser.displayName[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{currentUser.displayName}</p>
              </div>
              <button
                onClick={handleLogout}
                className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                title="Sign out"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Mobile header */}
      <div className="md:hidden flex items-center justify-center px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center gap-2">
          <img src="/grumpy-cat.svg" alt="" className="w-6 h-6" />
          <span className="font-bold text-sm">Music Library</span>
        </div>
      </div>

      {/* Main content */}
      <main className={`flex-1 min-h-0 p-4 md:p-6 overflow-y-auto ${hasPlayer ? 'pb-36 md:pb-20' : 'pb-20 md:pb-6'}`}>{children}</main>

      {/* Now playing bar */}
      {hasPlayer && (
        <div className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom))] md:bottom-0 left-0 right-0 md:left-56 h-12 bg-[var(--color-surface)] border-t border-[var(--color-border)] z-40">
          <NowPlayingBar />
        </div>
      )}

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 flex border-t border-[var(--color-border)] bg-[var(--color-surface)] z-50 pb-[env(safe-area-inset-bottom)]">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = page === item.page
          return (
            <button
              key={item.page}
              onClick={() => setPage(item.page)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
                active
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)]'
              }`}
            >
              <Icon size={20} />
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* Full-screen now-playing overlay */}
      {isFullScreen && <NowPlayingView />}
    </div>
  )
}
