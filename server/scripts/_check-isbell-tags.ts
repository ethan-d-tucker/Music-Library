import fs from 'fs'
import path from 'path'
import NodeID3 from 'node-id3'
import { readFlacTags } from '../src/services/normalizer.js'

const base = 'D:/library/Jason Isbell'

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (fs.statSync(full).isDirectory()) files.push(...walk(full))
    else if (full.endsWith('.flac') || full.endsWith('.mp3')) files.push(full)
  }
  return files
}

// Check Jason Isbell solo folder
const soloFiles = walk(base)
console.log(`=== Jason Isbell solo: ${soloFiles.length} files ===`)
for (const fp of soloFiles) {
  const rel = path.relative(base, fp)
  if (fp.endsWith('.flac')) {
    const tags = await readFlacTags(fp)
    if (tags.artist?.includes('&') || tags.albumArtist?.includes('&') || tags.artist?.includes('400')) {
      console.log(rel, '| artist:', tags.artist, '| aa:', tags.albumArtist)
    }
  } else {
    const tags = NodeID3.read(fp)
    if (tags.artist?.includes('&') || tags.performerInfo?.includes('&') || tags.artist?.includes('400')) {
      console.log(rel, '| artist:', tags.artist, '| aa:', tags.performerInfo)
    }
  }
}

// Check Jason Isbell and the 400 Unit folder
const bandBase = 'D:/library/Jason Isbell and the 400 Unit'
const bandFiles = walk(bandBase)
console.log(`\n=== Jason Isbell and the 400 Unit: ${bandFiles.length} files ===`)
for (const fp of bandFiles) {
  const rel = path.relative(bandBase, fp)
  if (fp.endsWith('.flac')) {
    const tags = await readFlacTags(fp)
    if (tags.artist?.includes('&') || tags.albumArtist?.includes('&')) {
      console.log(rel, '| artist:', tags.artist, '| aa:', tags.albumArtist)
    }
  } else {
    const tags = NodeID3.read(fp)
    if (tags.artist?.includes('&') || tags.performerInfo?.includes('&')) {
      console.log(rel, '| artist:', tags.artist, '| aa:', tags.performerInfo)
    }
  }
}

console.log('\nDone')
