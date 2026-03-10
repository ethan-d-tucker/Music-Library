import { Deezer, TrackFormats } from 'deezer-sdk'
import { Downloader, generateDownloadObject, DEFAULT_SETTINGS, type Listener } from '@karlincoder/deemix'
import type { Settings } from '@karlincoder/deemix'
import { DEEZER_ARL, MUSIC_DIR } from '../config.js'
import { normalizeForSearch } from './normalizer.js'

let dz: Deezer | null = null
let loginPromise: Promise<boolean> | null = null

async function getDeezer(): Promise<Deezer> {
  if (!DEEZER_ARL) throw new Error('DEEZER_ARL not configured')
  if (dz?.loggedIn) return dz

  if (loginPromise) {
    await loginPromise
    if (dz?.loggedIn) return dz
    throw new Error('Deezer login failed')
  }

  dz = new Deezer()
  loginPromise = dz.loginViaArl(DEEZER_ARL)
  const ok = await loginPromise
  loginPromise = null
  if (!ok) {
    dz = null
    throw new Error('Deezer login failed — check your ARL token')
  }
  return dz
}

export function isDeezerConfigured(): boolean {
  return !!DEEZER_ARL
}

// --- Search via free public API (no auth needed) ---

interface DeezerSearchResult {
  id: number
  title: string
  artist: string
  album: string
  duration: number // seconds
  albumCoverUrl: string
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean))
  const wordsB = new Set(b.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  let overlap = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++
  }
  return overlap / Math.max(wordsA.size, wordsB.size)
}

function scoreMatch(result: DeezerSearchResult, artist: string, title: string, durationMs: number): number {
  let score = 0
  const primaryArtist = normalizeForSearch(artist).toLowerCase()

  // Duration match (0 to 0.5)
  if (durationMs > 0 && result.duration > 0) {
    const expectedSec = durationMs / 1000
    const ratio = Math.abs(result.duration - expectedSec) / expectedSec
    if (ratio <= 0.03) score += 0.5       // near-exact
    else if (ratio <= 0.10) score += 0.4
    else if (ratio <= 0.20) score += 0.2
  }

  // Title similarity (0 to 0.3)
  score += wordOverlap(result.title, title) * 0.3

  // Artist match (0 to 0.2)
  if (result.artist.toLowerCase().includes(primaryArtist)) {
    score += 0.2
  }

  return score
}

export interface DeezerMatch {
  id: number
  title: string
  artist: string
  album: string
  duration: number
  albumCoverUrl: string
  score: number
}

// --- General search (for UI search page) ---

export interface DeezerTrackResult {
  id: number
  title: string
  artist: string
  album: string
  duration: number // seconds
  albumCoverUrl: string
  preview: string // 30s preview URL
}

export async function searchDeezerGeneral(query: string): Promise<DeezerTrackResult[]> {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=20`
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) return []

  const data = await res.json() as {
    data?: {
      id: number
      title: string
      artist: { name: string }
      album: { title: string; cover_xl: string; cover_big: string; cover_medium: string }
      duration: number
      preview: string
    }[]
  }

  if (!data.data?.length) return []

  return data.data.map(t => ({
    id: t.id,
    title: t.title,
    artist: t.artist.name,
    album: t.album.title,
    duration: t.duration,
    albumCoverUrl: t.album.cover_xl || t.album.cover_big || t.album.cover_medium || '',
    preview: t.preview || '',
  }))
}

export async function searchDeezer(artist: string, title: string, durationMs: number): Promise<DeezerMatch | null> {
  const primaryArtist = normalizeForSearch(artist)
  const cleanedTitle = title
    .replace(/\s*\(feat\..*?\)/gi, '')
    .replace(/\s*\[feat\..*?\]/gi, '')
    .replace(/\s*ft\..*$/gi, '')
    .trim()

  const query = `artist:"${primaryArtist}" track:"${cleanedTitle}"`
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=10`

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) return null

  const data = await res.json() as {
    data?: {
      id: number
      title: string
      artist: { name: string }
      album: { title: string; cover_xl: string; cover_big: string }
      duration: number
    }[]
  }

  if (!data.data?.length) {
    // Fallback: simpler query
    const fallbackUrl = `https://api.deezer.com/search?q=${encodeURIComponent(`${primaryArtist} ${cleanedTitle}`)}&limit=10`
    const fallbackRes = await fetch(fallbackUrl, { signal: AbortSignal.timeout(10000) })
    if (!fallbackRes.ok) return null
    const fallbackData = await fallbackRes.json() as typeof data
    if (!fallbackData.data?.length) return null
    data.data = fallbackData.data
  }

  const results: DeezerSearchResult[] = data.data.map(t => ({
    id: t.id,
    title: t.title,
    artist: t.artist.name,
    album: t.album.title,
    duration: t.duration,
    albumCoverUrl: t.album.cover_xl || t.album.cover_big || '',
  }))

  let best: DeezerMatch | null = null
  for (const r of results) {
    const score = scoreMatch(r, artist, title, durationMs)
    if (!best || score > best.score) {
      best = { ...r, score }
    }
  }

  // Minimum threshold
  if (!best || best.score < 0.3) return null
  return best
}

// --- Download via deemix (requires ARL) ---

export async function downloadDeezerTrack(
  deezerId: number,
  outputDir: string,
  format: 'flac' | 'mp3' = 'flac'
): Promise<string> {
  const dzInstance = await getDeezer()

  const bitrate = format === 'flac' ? TrackFormats.FLAC : TrackFormats.MP3_320

  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    downloadLocation: outputDir,
    maxBitrate: bitrate,
    fallbackBitrate: true,
    createAlbumFolder: false,
    createArtistFolder: false,
    createCDFolder: false,
    createStructurePlaylist: false,
    createSingleFolder: false,
    tracknameTemplate: '%tracknumber% %title%',
    albumTracknameTemplate: '%tracknumber% %title%',
    padTracks: true,
    paddingSize: 2,
    overwriteFile: 'y',
    tags: {
      ...DEFAULT_SETTINGS.tags,
      title: true,
      artist: true,
      album: true,
      cover: true,
      trackNumber: true,
      discNumber: true,
      albumArtist: true,
      genre: true,
      year: true,
      lyrics: true,
      syncedLyrics: true,
      isrc: true,
    },
  }

  const link = `https://www.deezer.com/track/${deezerId}`

  const errors: string[] = []
  const listener: Listener = {
    send: (key: string, data?: any) => {
      if (key === 'downloadFailed' || key === 'downloadError' || key === 'error') {
        errors.push(`${key}: ${JSON.stringify(data)}`)
      }
      if (key === 'downloadWarn') {
        errors.push(`warn: ${JSON.stringify(data)}`)
      }
    },
  }

  const downloadObj = await generateDownloadObject(dzInstance, link, bitrate, {}, listener)

  if (Array.isArray(downloadObj)) {
    throw new Error('Expected single track download object')
  }

  const downloader = new Downloader(dzInstance, downloadObj, settings, listener)
  await downloader.start()

  // Find the downloaded file (scan recursively in case deemix creates subdirs)
  const fs = await import('fs')
  const pathMod = await import('path')

  function findAudioFile(dir: string): string | null {
    if (!fs.existsSync(dir)) return null
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = pathMod.join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = findAudioFile(full)
        if (found) return found
      } else {
        const ext = pathMod.extname(entry.name).toLowerCase()
        if (ext === '.flac' || ext === '.mp3') return full
      }
    }
    return null
  }

  const downloadedPath = findAudioFile(outputDir)
  if (!downloadedPath) {
    // List what's actually in the directory for debugging
    let dirContents = '(empty or missing)'
    if (fs.existsSync(outputDir)) {
      const allFiles: string[] = []
      function listAll(d: string) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = pathMod.join(d, e.name)
          if (e.isDirectory()) listAll(f)
          else allFiles.push(pathMod.relative(outputDir, f))
        }
      }
      listAll(outputDir)
      dirContents = allFiles.length > 0 ? allFiles.join(', ') : '(empty)'
    }
    const errInfo = errors.length > 0 ? ` Errors: ${errors.join('; ')}` : ''
    throw new Error(`No audio file found in ${outputDir}. Contents: ${dirContents}.${errInfo}`)
  }

  return downloadedPath
}
