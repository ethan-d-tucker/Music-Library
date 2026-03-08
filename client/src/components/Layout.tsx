import type { ReactNode } from 'react'
import { Library, Download, Search, ListMusic, User, Disc3, Music } from 'lucide-react'
import { useAppStore, type Page, type LibraryTab } from '../lib/store.ts'

const navItems: { page: Page; label: string; icon: typeof Library }[] = [
  { page: 'library', label: 'Library', icon: Library },
  { page: 'import', label: 'Import', icon: Download },
  { page: 'search', label: 'Search', icon: Search },
  { page: 'playlists', label: 'Playlists', icon: ListMusic },
]

const libraryTabs: { tab: LibraryTab; label: string; icon: typeof Library }[] = [
  { tab: 'artists', label: 'Artists', icon: User },
  { tab: 'albums', label: 'Albums', icon: Disc3 },
  { tab: 'songs', label: 'Songs', icon: Music },
]

export function Layout({ children }: { children: ReactNode }) {
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)
  const libraryTab = useAppStore((s) => s.libraryTab)
  const setLibraryTab = useAppStore((s) => s.setLibraryTab)

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Desktop sidebar */}
      <nav className="hidden md:block w-56 flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h1 className="mb-6 text-lg font-bold text-[var(--color-text)]">Music Library</h1>
        <ul className="space-y-1">
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
                {item.page === 'library' && page === 'library' && (
                  <ul className="mt-1 ml-5 space-y-0.5">
                    {libraryTabs.map((sub) => {
                      const SubIcon = sub.icon
                      const subActive = libraryTab === sub.tab
                      return (
                        <li key={sub.tab}>
                          <button
                            onClick={() => setLibraryTab(sub.tab)}
                            className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                              subActive
                                ? 'text-[var(--color-accent)]'
                                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                            }`}
                          >
                            <SubIcon size={14} />
                            {sub.label}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Mobile: library sub-tabs */}
      {page === 'library' && (
        <div className="md:hidden flex border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          {libraryTabs.map((sub) => {
            const SubIcon = sub.icon
            const subActive = libraryTab === sub.tab
            return (
              <button
                key={sub.tab}
                onClick={() => setLibraryTab(sub.tab)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
                  subActive
                    ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)]'
                }`}
              >
                <SubIcon size={14} />
                {sub.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 p-4 md:p-6 overflow-auto pb-20 md:pb-6">{children}</main>

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
    </div>
  )
}
