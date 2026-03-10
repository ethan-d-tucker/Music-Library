import { useState, useRef } from 'react'
import { X, Upload, Save, Loader2 } from 'lucide-react'
import { updateTrackMetadata, uploadTrackArt, type TrackRow } from '../lib/api.ts'

interface MetadataEditorProps {
  track: TrackRow
  onClose: () => void
  onSaved?: (updatedTrack: TrackRow) => void
}

export function MetadataEditor({ track, onClose, onSaved }: MetadataEditorProps) {
  const [title, setTitle] = useState(track.title)
  const [artist, setArtist] = useState(track.artist)
  const [album, setAlbum] = useState(track.album)
  const [albumArtist, setAlbumArtist] = useState(track.album_artist || '')
  const [trackNumber, setTrackNumber] = useState(track.track_number || 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [artPreview, setArtPreview] = useState<string | null>(null)
  const [artFile, setArtFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      // Upload art first if selected
      if (artFile) {
        await uploadTrackArt(track.id, artFile)
      }

      // Update metadata
      const result = await updateTrackMetadata(track.id, {
        title: title !== track.title ? title : undefined,
        artist: artist !== track.artist ? artist : undefined,
        album: album !== track.album ? album : undefined,
        album_artist: albumArtist !== (track.album_artist || '') ? albumArtist : undefined,
        track_number: trackNumber !== track.track_number ? trackNumber : undefined,
      })

      onSaved?.(result.track)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function handleArtSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setArtFile(file)
    setArtPreview(URL.createObjectURL(file))
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h3 className="font-bold text-lg">Edit Track</h3>
          <button onClick={onClose} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Cover art */}
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-lg bg-[var(--color-surface-2)] overflow-hidden flex-shrink-0">
              <img
                src={artPreview || `/api/stream/art/${track.id}`}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </div>
            <div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
              >
                <Upload size={14} /> Change Art
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleArtSelect}
                className="hidden"
              />
              {artFile && <p className="text-xs text-[var(--color-accent)] mt-1">{artFile.name}</p>}
            </div>
          </div>

          {/* Fields */}
          <Field label="Title" value={title} onChange={setTitle} />
          <Field label="Artist" value={artist} onChange={setArtist} />
          <Field label="Album" value={album} onChange={setAlbum} />
          <Field label="Album Artist" value={albumArtist} onChange={setAlbumArtist} placeholder="Leave empty to use artist" />
          <div className="w-24">
            <Field label="Track #" value={String(trackNumber)} onChange={(v) => setTrackNumber(parseInt(v) || 0)} type="number" />
          </div>

          {error && (
            <p className="text-sm text-[var(--color-danger)]">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[var(--color-border)]">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="block text-xs text-[var(--color-text-muted)] mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
      />
    </div>
  )
}
