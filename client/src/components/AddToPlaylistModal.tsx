import { useState, useEffect } from 'react'
import { X, Plus, Check, Loader2 } from 'lucide-react'
import { getPlaylists, createPlaylist, addTrackToPlaylist, type PlaylistWithCount } from '../lib/api.ts'

interface AddToPlaylistModalProps {
  trackId: number
  onClose: () => void
}

export function AddToPlaylistModal({ trackId, onClose }: AddToPlaylistModalProps) {
  const [playlists, setPlaylists] = useState<PlaylistWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [addedTo, setAddedTo] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    getPlaylists()
      .then((r) => { setPlaylists(r.playlists); setLoading(false) })
      .catch(console.error)
  }, [])

  async function handleAdd(playlistId: number) {
    setAdding(true)
    try {
      await addTrackToPlaylist(playlistId, trackId)
      setAddedTo(playlistId)
      setTimeout(() => onClose(), 600)
    } catch (err) {
      console.error(err)
    } finally {
      setAdding(false)
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return
    setAdding(true)
    try {
      const { id } = await createPlaylist(newName.trim())
      await addTrackToPlaylist(id, trackId)
      setAddedTo(id)
      setTimeout(() => onClose(), 600)
    } catch (err) {
      console.error(err)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h3 className="font-bold text-lg">Add to Playlist</h3>
          <button onClick={onClose} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {/* Create new playlist */}
          {creating ? (
            <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--color-border)]">
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Playlist name"
                className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || adding}
                className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
              >
                Create
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-3 px-5 py-3 text-sm text-[var(--color-accent)] hover:bg-[var(--color-surface-2)] transition-colors border-b border-[var(--color-border)]"
            >
              <Plus size={18} /> New Playlist
            </button>
          )}

          {/* Playlist list */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-[var(--color-text-muted)]" />
            </div>
          ) : playlists.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-8">No playlists yet</p>
          ) : (
            playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => handleAdd(p.id)}
                disabled={adding}
                className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-[var(--color-surface-2)] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{p.trackCount} tracks</div>
                </div>
                {addedTo === p.id && <Check size={16} className="text-[var(--color-accent)]" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
