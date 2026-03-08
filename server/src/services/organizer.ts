import path from 'path'
import { mkdirSync } from 'fs'
import { MUSIC_DIR } from '../config.js'

function sanitize(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\.\.\./g, '\u2026')
    .replace(/\.+$/, '')
    .trim()
    || 'Unknown'
}

export function getTrackPath(artist: string, album: string, trackNumber: number, title: string, albumArtist?: string): string {
  const folderArtist = albumArtist || artist.split(',')[0].trim()
  const safeArtist = sanitize(folderArtist)
  const safeAlbum = sanitize(album || 'Singles')
  const safeTitle = sanitize(title)
  const num = trackNumber > 0 ? `${String(trackNumber).padStart(2, '0')} ` : ''
  return path.join(safeArtist, safeAlbum, `${num}${safeTitle}.mp3`).replace(/\\/g, '/')
}

export function getAbsolutePath(relativePath: string): string {
  return path.join(MUSIC_DIR, relativePath)
}

export function ensureDirectories(relativePath: string): void {
  const absDir = path.dirname(getAbsolutePath(relativePath))
  mkdirSync(absDir, { recursive: true })
}
