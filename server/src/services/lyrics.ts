import { writeFileSync } from 'fs'

interface LyricsResult {
  plain: string
  synced: string
}

// Strip live/bonus/remix suffixes to match studio lyrics
function cleanTitle(title: string): string | null {
  const cleaned = title
    .replace(/\s*[-–—]\s*(live|recorded)\s.*/i, '')
    .replace(/\s*\((live|recorded)\s[^)]*\)/i, '')
    .replace(/\s*\[(live|recorded)\s[^]]*\]/i, '')
    .replace(/\s*\((live)\)/i, '')
    .replace(/\s*\[(live)\]/i, '')
    .replace(/\s*[-–—]\s*live$/i, '')
    .replace(/\s*\((bonus\s*track|deluxe|demo|acoustic)\)/i, '')
    .replace(/\s*\[(bonus\s*track|deluxe|demo|acoustic)\]/i, '')
    .trim()
  return cleaned !== title ? cleaned : null
}

// Strip live/deluxe suffixes from album names
function cleanAlbum(album: string): string {
  return album
    .replace(/\s*\((live|deluxe|bonus|expanded|remaster)[^)]*\)/i, '')
    .replace(/\s*\[(live|deluxe|bonus|expanded|remaster)[^]]*\]/i, '')
    .replace(/\s*[-–—]\s*(live|deluxe|bonus|expanded|remaster).*$/i, '')
    .trim()
}

async function queryLrclib(artist: string, title: string, album: string, durationSec: number): Promise<LyricsResult | null> {
  const url = new URL('https://lrclib.net/api/get')
  url.searchParams.set('artist_name', artist)
  url.searchParams.set('track_name', title)
  url.searchParams.set('album_name', album)
  url.searchParams.set('duration', String(durationSec))

  const res = await fetch(url, {
    headers: { 'User-Agent': 'MusicLibrary/1.0' },
  })

  if (!res.ok) return null

  const data = await res.json() as { plainLyrics?: string; syncedLyrics?: string }
  const plain = data.plainLyrics || ''
  const synced = data.syncedLyrics || ''

  if (!plain && !synced) return null
  return { plain, synced }
}

export async function fetchLyrics(params: {
  artist: string
  title: string
  album: string
  durationMs: number
}): Promise<LyricsResult | null> {
  try {
    const dur = Math.round(params.durationMs / 1000)

    // Try exact match first
    const exact = await queryLrclib(params.artist, params.title, params.album, dur)
    if (exact) return exact

    // Try with cleaned title (strip "Live at..." etc) and/or cleaned album
    const cleaned = cleanTitle(params.title)
    const cleanedAlbum = cleanAlbum(params.album)
    if (cleaned) {
      const result = await queryLrclib(params.artist, cleaned, cleanedAlbum, 0)
      if (result) return result
    } else if (cleanedAlbum !== params.album) {
      const result = await queryLrclib(params.artist, params.title, cleanedAlbum, dur)
      if (result) return result
    }

    return null
  } catch {
    return null
  }
}

export function writeLrcFile(mp3Path: string, syncedLyrics: string): void {
  const lrcPath = mp3Path.replace(/\.mp3$/i, '.lrc')
  writeFileSync(lrcPath, syncedLyrics, 'utf-8')
}
