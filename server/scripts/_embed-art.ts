/**
 * Embed cover art into FLAC files that have cover.jpg on disk but not embedded.
 * Usage: cd server && npx tsx scripts/_embed-art.ts
 */
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { MUSIC_DIR, FFMPEG_DIR } from '../src/config.js'

const execFileAsync = promisify(execFile)
const ffmpegPath = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffmpeg').replace(/\\/g, '/') : 'ffmpeg'
const ffprobePath = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffprobe').replace(/\\/g, '/') : 'ffprobe'

async function hasEmbeddedArt(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', filePath
    ], { timeout: 10000 })
    const info = JSON.parse(stdout)
    return (info.streams || []).some((s: any) => s.codec_type === 'video')
  } catch {
    return false
  }
}

async function embedArtInFlac(filePath: string, artPath: string): Promise<void> {
  const tmpPath = filePath + '.artfix.' + Date.now() + '.flac'
  try {
    await execFileAsync(ffmpegPath, [
      '-y', '-i', filePath, '-i', artPath,
      '-map', '0:a', '-map', '1:0',
      '-c', 'copy',
      '-disposition:v', 'attached_pic',
      '-metadata:s:v', 'title=Album cover',
      '-metadata:s:v', 'comment=Cover (front)',
      tmpPath
    ], { timeout: 30000 })

    // Retry rename on EPERM (Navidrome lock)
    for (let i = 0; i < 3; i++) {
      try {
        fs.renameSync(tmpPath, filePath)
        return
      } catch (e: any) {
        if (e.code === 'EPERM' && i < 2) {
          await new Promise(r => setTimeout(r, 1000))
        } else {
          throw e
        }
      }
    }
  } catch (e) {
    try { fs.unlinkSync(tmpPath) } catch {}
    throw e
  }
}

async function main() {
  console.log('Embedding cover art into FLAC files...')
  console.log(`Library: ${MUSIC_DIR}\n`)

  let fixed = 0
  let skipped = 0
  let noArt = 0
  let errors = 0

  const topLevel = fs.readdirSync(MUSIC_DIR, { withFileTypes: true })
  for (const artistEntry of topLevel) {
    if (!artistEntry.isDirectory() || artistEntry.name === 'Playlists') continue
    const artistDir = path.join(MUSIC_DIR, artistEntry.name)
    let albumEntries: fs.Dirent[]
    try { albumEntries = fs.readdirSync(artistDir, { withFileTypes: true }) } catch { continue }

    for (const albumEntry of albumEntries) {
      if (!albumEntry.isDirectory()) continue
      const albumDir = path.join(artistDir, albumEntry.name)

      // Find cover art file
      const artNames = ['cover.jpg', 'cover.png', 'folder.jpg', 'front.jpg', 'artwork.jpg']
      let artPath: string | null = null
      for (const name of artNames) {
        const p = path.join(albumDir, name)
        if (fs.existsSync(p)) { artPath = p; break }
      }

      if (!artPath) {
        // Count FLAC files without art
        const flacs = fs.readdirSync(albumDir).filter(f => f.endsWith('.flac'))
        if (flacs.length > 0) noArt++
        continue
      }

      const flacFiles = fs.readdirSync(albumDir).filter(f => f.endsWith('.flac'))
      for (const file of flacFiles) {
        const filePath = path.join(albumDir, file).replace(/\\/g, '/')
        const hasArt = await hasEmbeddedArt(filePath)
        if (hasArt) { skipped++; continue }

        try {
          await embedArtInFlac(filePath, artPath)
          fixed++
          console.log(`  Embedded: ${artistEntry.name}/${albumEntry.name}/${file}`)
        } catch (e: any) {
          console.error(`  ERROR: ${filePath}: ${e.message}`)
          errors++
        }
      }
    }
  }

  console.log(`\nDone! Embedded art in ${fixed} files, ${skipped} already had art, ${errors} errors`)
  console.log(`${noArt} album folders have FLAC files but no cover art file on disk`)

  // Trigger Navidrome scan
  try {
    const resp = await fetch('http://localhost:4533/rest/startScan.view?u=admin&p=ADMIN&c=music-library&v=1.16.1&f=json')
    console.log('\nTriggered Navidrome scan:', resp.ok ? 'OK' : 'FAILED')
  } catch (e: any) {
    console.log('\nCould not trigger Navidrome scan:', e.message)
  }
}

main().catch(console.error)
