import { useAppStore, type SettingsTab } from '../lib/store.ts'
import { ImportPage } from './ImportPage.tsx'
import { DownloadsPage } from './DownloadsPage.tsx'
import { ManagerPage } from './ManagerPage.tsx'
import { Wrench, Download, ArrowDownToLine } from 'lucide-react'

const tabs: { tab: SettingsTab; label: string; icon: typeof Wrench }[] = [
  { tab: 'manager', label: 'Manager', icon: Wrench },
  { tab: 'import', label: 'Import', icon: Download },
  { tab: 'downloads', label: 'Downloads', icon: ArrowDownToLine },
]

export function SettingsPage() {
  const settingsTab = useAppStore((s) => s.settingsTab)
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Settings</h2>

      {/* Sub-tab bar */}
      <div className="flex border-b border-[var(--color-border)] mb-4">
        {tabs.map(({ tab, label, icon: Icon }) => (
          <button
            key={tab}
            onClick={() => setSettingsTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
              settingsTab === tab
                ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {settingsTab === 'manager' && <ManagerPage />}
      {settingsTab === 'import' && <ImportPage />}
      {settingsTab === 'downloads' && <DownloadsPage />}
    </div>
  )
}
