/**
 * Fix all Tyler Creator FLAC tag variants -> "Tyler, The Creator"
 * Scans ALL albums, not just Goblin.
 * Usage: cd server && npx tsx scripts/fix-tyler.ts
 */
import fs from 'fs'
import path from 'path'
import { MUSIC_DIR } from '../src/config.js'
import { readFlacTags, writeFlacTags } from '../src/services/normalizer.js'

const base = path.join(MUSIC_DIR, 'Tyler, The Creator')
const CORRECT = 'Tyler, The Creator'

async function main() {
  console.log(`Scanning: ${base}\n`)
  const albums = fs.readdirSync(base)
  let fixed = 0

  for (const album of albums) {
    const dir = path.join(base, album)
    if (!fs.statSync(dir).isDirectory()) continue
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.flac'))

    for (const f of files) {
      const fp = path.join(dir, f)
      const tags = await readFlacTags(fp)
      const artist = tags.artist || ''
      const albumArtist = tags.albumArtist || ''

      // Fix any variant that isn't exactly "Tyler, The Creator"
      const artistBad = artist && artist !== CORRECT && artist.toLowerCase().includes('tyler')
      const aaBad = albumArtist && albumArtist !== CORRECT && albumArtist.toLowerCase().includes('tyler')

      if (artistBad || aaBad) {
        console.log(`FIX: ${album}/${f}`)
        if (artistBad) console.log(`  artist: "${artist}" -> "${CORRECT}"`)
        if (aaBad) console.log(`  albumArtist: "${albumArtist}" -> "${CORRECT}"`)
        await writeFlacTags(fp, {
          artist: CORRECT,
          album: tags.album || '',
          title: tags.title || '',
          trackNumber: parseInt(tags.track || '0') || 0,
          albumArtist: CORRECT,
        })
        fixed++
      }
    }
  }

  console.log(`\nFixed ${fixed} files`)
}

main().catch(err => { console.error(err); process.exit(1) })
