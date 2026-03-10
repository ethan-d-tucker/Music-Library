/**
 * Fix remaining concatenated/variant artist tags in the library.
 * Handles:
 * - Concatenated names like "Merle HaggardThe Strangers" -> proper separator
 * - ALBUMARTIST "Jason Isbell & The 400 Unit" -> "Jason Isbell and the 400 Unit"
 * - Folder renames for badly named directories
 *
 * Usage: cd server && npx tsx scripts/fix-concat-tags.ts
 *        cd server && npx tsx scripts/fix-concat-tags.ts --execute
 */
import fs from 'fs'
import path from 'path'
import NodeID3 from 'node-id3'
import { MUSIC_DIR } from '../src/config.js'
import { readFlacTags, writeFlacTags, writeMp3Tags } from '../src/services/normalizer.js'

const executeMode = process.argv.includes('--execute')

// Known concatenation fixes: bad name -> correct name
const CONCAT_FIXES: Record<string, string> = {
  'Merle HaggardThe Strangers': 'Merle Haggard and The Strangers',
  'Merle HaggardGeorge Jones': 'Merle Haggard & George Jones',
  'Merle HaggardJohnny Cash': 'Merle Haggard & Johnny Cash',
  'Merle HaggardToby Keith': 'Merle Haggard & Toby Keith',
  'Merle HaggardWillie Nelson': 'Merle Haggard & Willie Nelson',
  'Merle HaggardMerle HaggardThe Strangers': 'Merle Haggard and The Strangers',
  'Johnny CashMerle HaggardWillie Nelson': 'Johnny Cash, Merle Haggard & Willie Nelson',
  'Trampled by TurtlesLeAnn Rimes': 'Trampled by Turtles, LeAnn Rimes',
  'Trampled by TurtlesRich Mattson': 'Trampled by Turtles, Rich Mattson',
  'Jason Isbell & The 400 Unit': 'Jason Isbell and the 400 Unit',
  'Jason Isbell & the 400 Unit': 'Jason Isbell and the 400 Unit',
}

// Folder renames needed
const FOLDER_RENAMES: Record<string, string> = {
  'Merle HaggardGeorge Jones': 'Merle Haggard & George Jones',
  'Merle HaggardMerle HaggardThe Strangers': 'Merle Haggard and The Strangers',
}

function walk(dir: string): string[] {
  const files: string[] = []
  try {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry)
      try {
        if (fs.statSync(full).isDirectory()) files.push(...walk(full))
        else if (full.endsWith('.mp3') || full.endsWith('.flac')) files.push(full)
      } catch {}
    }
  } catch {}
  return files
}

async function main() {
  console.log('Scanning ' + MUSIC_DIR + '...\n')
  const files = walk(MUSIC_DIR)
  console.log('Found ' + files.length + ' audio files\n')

  // Phase 1: Folder renames (do first so file paths are correct for tag fixes)
  const folderFixes: { from: string; to: string }[] = []
  for (const [bad, good] of Object.entries(FOLDER_RENAMES)) {
    const badPath = path.join(MUSIC_DIR, bad)
    if (fs.existsSync(badPath)) {
      const goodPath = path.join(MUSIC_DIR, good)
      folderFixes.push({ from: bad, to: good })
      if (executeMode) {
        if (fs.existsSync(goodPath)) {
          // Merge: move albums from bad into good
          for (const entry of fs.readdirSync(badPath)) {
            const src = path.join(badPath, entry)
            const dst = path.join(goodPath, entry)
            if (!fs.existsSync(dst)) {
              fs.renameSync(src, dst)
              console.log('  Moved: ' + bad + '/' + entry + ' -> ' + good + '/' + entry)
            } else {
              console.log('  SKIP (exists): ' + good + '/' + entry)
            }
          }
          // Remove empty source dir
          try {
            const remaining = fs.readdirSync(badPath)
            if (remaining.length === 0) fs.rmdirSync(badPath)
          } catch {}
        } else {
          fs.renameSync(badPath, goodPath)
          console.log('  Renamed: ' + bad + ' -> ' + good)
        }
      }
    }
  }

  // Phase 2: Find and fix tag issues
  // Re-walk after folder renames
  const allFiles = executeMode ? walk(MUSIC_DIR) : files
  interface TagFix { file: string; field: string; from: string; to: string }
  const fixes: TagFix[] = []

  for (const fp of allFiles) {
    const ext = path.extname(fp).toLowerCase()
    if (ext === '.flac') {
      const tags = await readFlacTags(fp)
      const artist = tags.artist || ''
      const aa = tags.albumArtist || ''
      let needsFix = false
      let newArtist = artist
      let newAA = aa

      if (artist && CONCAT_FIXES[artist]) {
        newArtist = CONCAT_FIXES[artist]
        fixes.push({ file: path.relative(MUSIC_DIR, fp), field: 'artist', from: artist, to: newArtist })
        needsFix = true
      }
      if (aa && CONCAT_FIXES[aa]) {
        newAA = CONCAT_FIXES[aa]
        fixes.push({ file: path.relative(MUSIC_DIR, fp), field: 'albumArtist', from: aa, to: newAA })
        needsFix = true
      }

      if (needsFix && executeMode) {
        await writeFlacTags(fp, {
          artist: newArtist || artist,
          album: tags.album || '',
          title: tags.title || '',
          trackNumber: parseInt(tags.track || '0') || 0,
          albumArtist: newAA || aa || undefined,
        })
        console.log('  Fixed FLAC: ' + path.relative(MUSIC_DIR, fp))
      }
    } else if (ext === '.mp3') {
      const tags = NodeID3.read(fp)
      const artist = tags.artist || ''
      const aa = (tags as any).performerInfo || ''

      if (artist && CONCAT_FIXES[artist]) {
        const newArtist = CONCAT_FIXES[artist]
        fixes.push({ file: path.relative(MUSIC_DIR, fp), field: 'artist', from: artist, to: newArtist })
        if (executeMode) {
          writeMp3Tags(fp, { artist: newArtist })
          console.log('  Fixed MP3 artist: ' + path.relative(MUSIC_DIR, fp))
        }
      }
      if (aa && CONCAT_FIXES[aa]) {
        const newAA = CONCAT_FIXES[aa]
        fixes.push({ file: path.relative(MUSIC_DIR, fp), field: 'albumArtist', from: aa, to: newAA })
        if (executeMode) {
          writeMp3Tags(fp, { albumArtist: newAA })
          console.log('  Fixed MP3 albumArtist: ' + path.relative(MUSIC_DIR, fp))
        }
      }
    }
  }

  // Summary
  console.log('\n=== TAG FIXES ===')
  if (fixes.length === 0) {
    console.log('  No tag fixes needed')
  } else {
    for (const f of fixes) {
      console.log('  ' + f.file + ': ' + f.field + ' "' + f.from + '" -> "' + f.to + '"')
    }
    console.log('\n  Total: ' + fixes.length + ' tag fixes')
  }

  console.log('\n=== FOLDER RENAMES ===')
  if (folderFixes.length === 0) {
    console.log('  No folder renames needed')
  } else {
    for (const f of folderFixes) {
      console.log('  "' + f.from + '" -> "' + f.to + '"')
    }
  }

  if (!executeMode && (fixes.length > 0 || folderFixes.length > 0)) {
    console.log('\nRun with --execute to apply these fixes')
  } else if (executeMode) {
    console.log('\nApplied ' + fixes.length + ' tag fixes and ' + folderFixes.length + ' folder renames')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
