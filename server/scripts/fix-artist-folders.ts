/**
 * Fix artist folders with semicolons — rename to primary artist only.
 * Also updates ID3/FLAC album_artist tags on affected files.
 *
 * Usage: cd server && npx tsx scripts/fix-artist-folders.ts [--execute]
 */
import fs from 'fs'
import path from 'path'
import NodeID3 from 'node-id3'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { MUSIC_DIR, FFMPEG_DIR } from '../src/config.js'

const execFileAsync = promisify(execFile)
const ffmpegPath = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffmpeg').replace(/\\/g, '/') : 'ffmpeg'
const ffprobePath = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffprobe').replace(/\\/g, '/') : 'ffprobe'

const dryRun = !process.argv.includes('--execute')
const musicDir = MUSIC_DIR

async function main() {
  console.log(`Fix Artist Folders`)
  console.log(`Library: ${musicDir}`)
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}\n`)

  const entries = fs.readdirSync(musicDir, { withFileTypes: true })
  let renamed = 0
  let merged = 0
  let filesFixed = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name.includes(';')) continue

    const primaryArtist = entry.name.split(';')[0].trim()
    const oldPath = path.join(musicDir, entry.name)
    const newPath = path.join(musicDir, primaryArtist)

    const targetExists = fs.existsSync(newPath)
    console.log(`${entry.name}`)
    console.log(`  → ${primaryArtist}${targetExists ? ' (merge into existing)' : ''}`)

    // Get all album subdirectories
    const albums = fs.readdirSync(oldPath, { withFileTypes: true })
    for (const album of albums) {
      if (!album.isDirectory()) continue
      const srcAlbumDir = path.join(oldPath, album.name)
      const dstAlbumDir = path.join(newPath, album.name)

      // Fix tags on all audio files in this album
      const files = fs.readdirSync(srcAlbumDir)
      for (const file of files) {
        const ext = path.extname(file).toLowerCase()
        if (ext !== '.mp3' && ext !== '.flac') continue
        const filePath = path.join(srcAlbumDir, file)

        if (ext === '.mp3') {
          try {
            const tags = NodeID3.read(filePath)
            const currentAlbumArtist = tags.performerInfo
            if (currentAlbumArtist && currentAlbumArtist.includes(';')) {
              console.log(`  tag fix: ${file} — albumArtist "${currentAlbumArtist}" → "${primaryArtist}"`)
              if (!dryRun) {
                NodeID3.update({ performerInfo: primaryArtist }, filePath)
              }
              filesFixed++
            }
          } catch {}
        } else if (ext === '.flac') {
          try {
            const { stdout } = await execFileAsync(ffprobePath, [
              '-v', 'quiet', '-print_format', 'json', '-show_format', filePath
            ], { timeout: 10000 })
            const info = JSON.parse(stdout)
            const tags = info.format?.tags || {}
            const currentAA = tags.ALBUMARTIST || tags.albumartist || tags.ALBUM_ARTIST || tags.album_artist
            if (currentAA && currentAA.includes(';')) {
              console.log(`  tag fix: ${file} — albumArtist "${currentAA}" → "${primaryArtist}"`)
              if (!dryRun) {
                const tmpPath = filePath + '.tmp.' + Date.now() + '.flac'
                const args = ['-y', '-i', filePath, '-map', '0', '-map_metadata', '-1', '-c', 'copy']
                for (const [k, v] of Object.entries(tags)) {
                  const key = k.toLowerCase()
                  if (key === 'albumartist' || key === 'album_artist' || key === 'album artist') {
                    args.push('-metadata', `${k}=${primaryArtist}`)
                  } else {
                    args.push('-metadata', `${k}=${v}`)
                  }
                }
                args.push(tmpPath)
                await execFileAsync(ffmpegPath, args, { timeout: 30000 })
                fs.renameSync(tmpPath, filePath)
              }
              filesFixed++
            }
          } catch {}
        }
      }

      // Move/merge album directory
      if (!dryRun) {
        if (!fs.existsSync(newPath)) {
          fs.mkdirSync(newPath, { recursive: true })
        }
        if (fs.existsSync(dstAlbumDir)) {
          // Merge: move individual files
          for (const file of files) {
            const src = path.join(srcAlbumDir, file)
            const dst = path.join(dstAlbumDir, file)
            if (!fs.existsSync(dst)) {
              fs.renameSync(src, dst)
            }
          }
          // Remove source album dir if empty
          try { fs.rmdirSync(srcAlbumDir) } catch {}
        } else {
          fs.renameSync(srcAlbumDir, dstAlbumDir)
        }
      }
    }

    // Remove the old semicolon folder if empty
    if (!dryRun) {
      try { fs.rmdirSync(oldPath) } catch {}
    }

    if (targetExists) merged++
    else renamed++
  }

  console.log(`\nDone: ${renamed} renamed, ${merged} merged, ${filesFixed} tags fixed`)
  if (dryRun) console.log('Run with --execute to apply changes')
}

main().catch(err => { console.error(err); process.exit(1) })
