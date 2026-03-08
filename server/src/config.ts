import path from 'path'
import os from 'os'
import { existsSync, readdirSync, mkdirSync } from 'fs'
import { config } from 'dotenv'

config({ path: path.resolve(import.meta.dirname, '..', '..', '.env') })

function findBinary(name: string, searchDirs: string[]): string {
  const ext = process.platform === 'win32' ? '.exe' : ''
  for (const dir of searchDirs) {
    const fullPath = path.join(dir, `${name}${ext}`)
    if (existsSync(fullPath)) return fullPath
  }
  return name
}

const homeDir = process.env.USERPROFILE || process.env.HOME || os.homedir()
const wingetBase = path.join(homeDir, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages')

// Find yt-dlp
const ytdlpDirs: string[] = []
if (existsSync(wingetBase)) {
  for (const dir of readdirSync(wingetBase)) {
    if (dir.startsWith('yt-dlp.yt-dlp')) {
      ytdlpDirs.push(path.join(wingetBase, dir))
    }
  }
}

// Find ffmpeg
let ffmpegDir = ''
if (existsSync(wingetBase)) {
  for (const dir of readdirSync(wingetBase)) {
    if (dir.startsWith('yt-dlp.FFmpeg') || dir.startsWith('Gyan.FFmpeg')) {
      const pkgDir = path.join(wingetBase, dir)
      try {
        for (const sub of readdirSync(pkgDir)) {
          const binDir = path.join(pkgDir, sub, 'bin')
          const ffmpegExe = path.join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
          if (existsSync(ffmpegExe)) {
            ffmpegDir = binDir
            break
          }
        }
      } catch {}
      if (ffmpegDir) break
    }
  }
}

// Find Deno (required by yt-dlp for YouTube JS challenges)
const denoDirs: string[] = []
if (existsSync(wingetBase)) {
  for (const dir of readdirSync(wingetBase)) {
    if (dir.startsWith('DenoLand.Deno')) {
      denoDirs.push(path.join(wingetBase, dir))
    }
  }
}
const userDenoDir = path.join(homeDir, '.deno', 'bin')
if (existsSync(userDenoDir)) denoDirs.push(userDenoDir)

// Linux/macOS standard paths
if (process.platform !== 'win32') {
  for (const p of ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']) {
    ytdlpDirs.push(p)
    denoDirs.push(p)
  }
}

export const YTDLP_PATH = findBinary('yt-dlp', ytdlpDirs).replace(/\\/g, '/')
export const FFMPEG_DIR = ffmpegDir.replace(/\\/g, '/')
export const DENO_PATH = findBinary('deno', denoDirs).replace(/\\/g, '/')

export const MUSIC_DIR = (process.env.MUSIC_DIR || path.join(homeDir, 'Music', 'library')).replace(/\\/g, '/')
export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || ''
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || ''
export const PORT = parseInt(process.env.PORT || '3001', 10)

export const NAVIDROME_URL = process.env.NAVIDROME_URL || 'http://localhost:4533'
export const NAVIDROME_USER = process.env.NAVIDROME_USER || ''
export const NAVIDROME_PASS = process.env.NAVIDROME_PASS || ''

// Ensure music directory exists
mkdirSync(MUSIC_DIR, { recursive: true })
