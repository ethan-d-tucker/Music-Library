import { spawn } from 'child_process'
import path from 'path'
import { existsSync } from 'fs'
import { YTDLP_PATH, FFMPEG_DIR, DENO_PATH } from '../config.js'

export interface SearchResult {
  id: string
  title: string
  channel: string
  description: string
  duration: number
  durationFormatted: string
  url: string
  thumbnail: string
}

function spawnEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>
  if (DENO_PATH && DENO_PATH !== 'deno') {
    const denoDir = path.dirname(DENO_PATH).replace(/\//g, '\\')
    env.PATH = `${denoDir}${path.delimiter}${env.PATH || ''}`
  }
  return env
}

export async function searchYouTube(query: string, limit = 5): Promise<SearchResult[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_PATH, [
      `ytsearch${limit}:${query}`,
      '--dump-json',
      '--no-download',
      '--flat-playlist',
    ], { env: spawnEnv() })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Search failed: ${stderr}`))
        return
      }
      try {
        const results: SearchResult[] = stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const item = JSON.parse(line)
            const dur = item.duration || 0
            const mins = Math.floor(dur / 60)
            const secs = Math.floor(dur % 60)
            return {
              id: item.id,
              title: item.title || 'Unknown',
              channel: item.channel || item.uploader || 'Unknown',
              description: item.description || '',
              duration: dur,
              durationFormatted: `${mins}:${secs.toString().padStart(2, '0')}`,
              url: `https://www.youtube.com/watch?v=${item.id}`,
              thumbnail: item.thumbnail || item.thumbnails?.[0]?.url || '',
            }
          })
        // Sort by duration descending so albums appear before singles
        results.sort((a, b) => b.duration - a.duration)
        resolve(results)
      } catch {
        reject(new Error('Failed to parse search results'))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}`))
    })

    setTimeout(() => {
      proc.kill()
      reject(new Error('Search timed out'))
    }, 30_000)
  })
}

export interface PlaylistResult {
  title: string
  tracks: SearchResult[]
}

export async function expandPlaylist(url: string): Promise<PlaylistResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_PATH, [
      url,
      '--dump-json',
      '--no-download',
      '--flat-playlist',
    ], { env: spawnEnv() })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Playlist expansion failed: ${stderr}`))
        return
      }
      try {
        const lines = stdout.trim().split('\n').filter(Boolean)
        let playlistTitle = ''
        const tracks: SearchResult[] = lines.map((line) => {
          const item = JSON.parse(line)
          if (!playlistTitle && item.playlist_title) playlistTitle = item.playlist_title
          const dur = item.duration || 0
          const mins = Math.floor(dur / 60)
          const secs = Math.floor(dur % 60)
          return {
            id: item.id,
            title: item.title || 'Unknown',
            channel: item.channel || item.uploader || 'Unknown',
            description: item.description || '',
            duration: dur,
            durationFormatted: `${mins}:${secs.toString().padStart(2, '0')}`,
            url: `https://www.youtube.com/watch?v=${item.id}`,
            thumbnail: item.thumbnail || item.thumbnails?.[0]?.url || '',
          }
        })
        resolve({ title: playlistTitle || 'Unknown Playlist', tracks })
      } catch {
        reject(new Error('Failed to parse playlist results'))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}`))
    })

    setTimeout(() => {
      proc.kill()
      reject(new Error('Playlist expansion timed out'))
    }, 60_000)
  })
}

export interface PlaylistSearchResult {
  id: string
  title: string
  url: string
  thumbnail: string
}

export async function searchYouTubePlaylists(query: string, limit = 10): Promise<PlaylistSearchResult[]> {
  return new Promise((resolve, reject) => {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAw%3D%3D`
    const proc = spawn(YTDLP_PATH, [
      searchUrl,
      '--dump-json',
      '--no-download',
      '--flat-playlist',
      '--playlist-end', String(limit),
    ], { env: spawnEnv() })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        // Non-fatal: just return empty results
        resolve([])
        return
      }
      try {
        const results: PlaylistSearchResult[] = stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const item = JSON.parse(line)
            return {
              id: item.id,
              title: item.title || 'Unknown Playlist',
              url: item.url || `https://www.youtube.com/playlist?list=${item.id}`,
              thumbnail: item.thumbnails?.[0]?.url || '',
            }
          })
        resolve(results)
      } catch {
        resolve([])
      }
    })

    proc.on('error', () => resolve([]))

    setTimeout(() => {
      proc.kill()
      resolve([]) // Don't fail the whole search if playlists time out
    }, 15_000)
  })
}

export async function downloadAudio(url: string, outputPath: string): Promise<void> {
  const args = [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--no-playlist',
    '--restrict-filenames',
    '-o', outputPath,
  ]

  if (FFMPEG_DIR) {
    args.push('--ffmpeg-location', FFMPEG_DIR)
  }

  args.push(url)

  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_PATH, args, { env: spawnEnv() })

    let stderr = ''
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`))
        return
      }
      if (!existsSync(outputPath)) {
        reject(new Error(`Download completed but file not found at ${outputPath}`))
        return
      }
      resolve()
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}`))
    })

    setTimeout(() => {
      proc.kill()
      reject(new Error('Download timed out after 3 minutes'))
    }, 180_000)
  })
}
