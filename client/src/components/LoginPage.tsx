import { useState, useEffect } from 'react'
import { Music, Plus, ArrowLeft, Loader2 } from 'lucide-react'
import { useAppStore } from '../lib/store.ts'
import { getUsers, login, register } from '../lib/api.ts'

type Mode = 'pick' | 'pin' | 'create'

export function LoginPage() {
  const setAuth = useAppStore((s) => s.setAuth)
  const [mode, setMode] = useState<Mode>('pick')
  const [users, setUsers] = useState<{ id: number; username: string; display_name: string }[]>([])
  const [selectedUser, setSelectedUser] = useState<string>('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Create form
  const [newUsername, setNewUsername] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')

  useEffect(() => {
    getUsers()
      .then((r) => {
        setUsers(r.users)
        // If no users exist, go straight to create mode
        if (r.users.length === 0) setMode('create')
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load users:', err)
        // If server doesn't have auth routes yet, go to create mode
        setMode('create')
        setLoading(false)
      })
  }, [])

  async function handleLogin() {
    if (!pin) return
    setError('')
    setSubmitting(true)
    try {
      const result = await login(selectedUser, pin)
      setAuth(result.user, result.token)
    } catch (err) {
      setError((err as Error).message || 'Login failed')
      setPin('')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRegister() {
    if (!newUsername.trim() || !newDisplayName.trim() || !newPin) return
    if (newPin !== confirmPin) {
      setError('PINs do not match')
      return
    }
    if (newPin.length < 4) {
      setError('PIN must be at least 4 characters')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const result = await register(newUsername.trim(), newDisplayName.trim(), newPin)
      setAuth(result.user, result.token)
    } catch (err) {
      setError((err as Error).message || 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <Music size={48} className="text-[var(--color-accent)] animate-pulse" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-[var(--color-accent)] flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Music size={40} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold">Music Library</h1>
        </div>

        {mode === 'pick' && (
          <div>
            <p className="text-center text-sm text-[var(--color-text-muted)] mb-6">Who's listening?</p>

            <div className="grid gap-3 mb-4">
              {users.map((u) => (
                <button
                  key={u.id}
                  onClick={() => { setSelectedUser(u.username); setMode('pin'); setError('') }}
                  className="flex items-center gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 hover:border-[var(--color-accent)] transition-colors"
                >
                  <div className="w-12 h-12 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white font-bold text-lg">
                    {u.display_name[0].toUpperCase()}
                  </div>
                  <div className="text-left">
                    <div className="font-medium">{u.display_name}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">@{u.username}</div>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => { setMode('create'); setError('') }}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-border)] px-5 py-4 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors"
            >
              <Plus size={18} /> Add Profile
            </button>
          </div>
        )}

        {mode === 'pin' && (
          <div>
            <button
              onClick={() => { setMode('pick'); setPin(''); setError('') }}
              className="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] mb-6 transition-colors"
            >
              <ArrowLeft size={16} /> Back
            </button>

            <p className="text-center text-sm text-[var(--color-text-muted)] mb-6">
              Enter PIN for <span className="text-[var(--color-text)] font-medium">{selectedUser}</span>
            </p>

            <input
              autoFocus
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="Enter PIN"
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:border-[var(--color-accent)] transition-colors"
            />

            {error && <p className="text-sm text-[var(--color-danger)] text-center mt-3">{error}</p>}

            <button
              onClick={handleLogin}
              disabled={!pin || submitting}
              className="w-full mt-4 rounded-xl bg-[var(--color-accent)] px-6 py-3 font-medium text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
            >
              {submitting ? <Loader2 size={20} className="animate-spin mx-auto" /> : 'Sign In'}
            </button>
          </div>
        )}

        {mode === 'create' && (
          <div>
            {users.length > 0 && (
              <button
                onClick={() => { setMode('pick'); setError('') }}
                className="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] mb-6 transition-colors"
              >
                <ArrowLeft size={16} /> Back
              </button>
            )}

            <p className="text-center text-sm text-[var(--color-text-muted)] mb-6">
              {users.length === 0 ? 'Create your first profile to get started' : 'Create your profile'}
            </p>

            <div className="space-y-3">
              <input
                autoFocus
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="Username (lowercase, no spaces)"
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
              />
              <input
                type="text"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="Display Name"
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
              />
              <input
                type="password"
                inputMode="numeric"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder="PIN (4+ digits)"
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
              />
              <input
                type="password"
                inputMode="numeric"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                placeholder="Confirm PIN"
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
              />
            </div>

            {error && <p className="text-sm text-[var(--color-danger)] text-center mt-3">{error}</p>}

            <button
              onClick={handleRegister}
              disabled={!newUsername.trim() || !newDisplayName.trim() || !newPin || !confirmPin || submitting}
              className="w-full mt-4 rounded-xl bg-[var(--color-accent)] px-6 py-3 font-medium text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
            >
              {submitting ? <Loader2 size={20} className="animate-spin mx-auto" /> : 'Create Profile'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
