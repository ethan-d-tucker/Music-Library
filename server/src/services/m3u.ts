import path from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import { MUSIC_DIR } from '../config.js'
import type { TrackRow } from '../db/index.js'

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '').trim() || 'Untitled'
}

export function generateM3U(playlistName: string, tracks: TrackRow[]): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${playlistName}`]

  for (const track of tracks) {
    if (!track.file_path) continue
    const durationSec = Math.round(track.duration_ms / 1000)
    lines.push(`#EXTINF:${durationSec},${track.artist} - ${track.title}`)
    // Use relative path from Playlists/ dir to music files
    lines.push(`../${track.file_path}`)
  }

  return lines.join('\n') + '\n'
}

export function writeM3U(playlistName: string, tracks: TrackRow[]): string {
  const playlistDir = path.join(MUSIC_DIR, 'Playlists')
  mkdirSync(playlistDir, { recursive: true })

  const fileName = `${sanitize(playlistName)}.m3u`
  const filePath = path.join(playlistDir, fileName)
  const content = generateM3U(playlistName, tracks)
  writeFileSync(filePath, content, 'utf-8')

  return `Playlists/${fileName}`
}
