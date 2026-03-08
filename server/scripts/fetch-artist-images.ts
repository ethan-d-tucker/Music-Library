/**
 * For albums missing cover art, download an artist image as a fallback.
 * Uses Navidrome's artist image URLs (sourced from Spotify/Deezer).
 *
 * Usage: cd server && npx tsx scripts/fetch-artist-images.ts
 */
import fs from 'fs'
import path from 'path'
import { MUSIC_DIR, NAVIDROME_URL, NAVIDROME_USER, NAVIDROME_PASS } from '../src/config.js'

const musicDir = process.argv[2] || MUSIC_DIR

async function main() {
  if (!NAVIDROME_USER || !NAVIDROME_PASS) {
    console.log('Navidrome credentials not configured in .env')
    return
  }

  const params = new URLSearchParams({
    u: NAVIDROME_USER, p: NAVIDROME_PASS,
    v: '1.16.1', c: 'musiclib-artfetch', f: 'json',
  })

  // 1. Find albums missing cover art on disk
  console.log(`Scanning ${musicDir} for albums without cover art...\n`)
  const missing: { artist: string; album: string; dir: string }[] = []

  const topLevel = fs.readdirSync(musicDir, { withFileTypes: true })
  for (const artistEntry of topLevel) {
    if (!artistEntry.isDirectory() || artistEntry.name === 'Playlists') continue
    const artistDir = path.join(musicDir, artistEntry.name)
    let albumEntries: fs.Dirent[]
    try { albumEntries = fs.readdirSync(artistDir, { withFileTypes: true }) } catch { continue }
    for (const albumEntry of albumEntries) {
      if (!albumEntry.isDirectory()) continue
      const albumDir = path.join(artistDir, albumEntry.name)
      let files: string[]
      try { files = fs.readdirSync(albumDir) } catch { continue }
      const hasAudio = files.some(f => /\.(mp3|flac|m4a|ogg|opus)$/i.test(f))
      const hasArt = files.some(f => /^(cover|folder|album|front|artwork)\.(jpg|jpeg|png|webp)$/i.test(f))
      if (hasAudio && !hasArt) {
        missing.push({ artist: artistEntry.name, album: albumEntry.name, dir: albumDir })
      }
    }
  }

  console.log(`Found ${missing.length} albums without cover art\n`)
  if (missing.length === 0) return

  // 2. Get artist image URLs from Navidrome
  const artistImageCache = new Map<string, string>() // artist name -> image URL

  const res = await fetch(`${NAVIDROME_URL}/rest/getArtists?${params}`, {
    signal: AbortSignal.timeout(10000),
  })
  const data = await res.json() as {
    'subsonic-response': {
      artists?: {
        index: { artist: { id: string; name: string; artistImageUrl?: string }[] }[]
      }
    }
  }

  for (const idx of data['subsonic-response'].artists?.index || []) {
    for (const artist of idx.artist) {
      if (artist.artistImageUrl) {
        artistImageCache.set(artist.name.toLowerCase(), artist.artistImageUrl)
      }
    }
  }

  // Also try getArtistInfo2 for artists that don't have images in the list
  const uniqueArtists = [...new Set(missing.map(m => m.artist))]
  for (const artistName of uniqueArtists) {
    if (artistImageCache.has(artistName.toLowerCase())) continue

    // Search for the artist in Navidrome
    try {
      const searchRes = await fetch(
        `${NAVIDROME_URL}/rest/search3?${params}&query=${encodeURIComponent(artistName)}&artistCount=1&albumCount=0&songCount=0`,
        { signal: AbortSignal.timeout(5000) }
      )
      const searchData = await searchRes.json() as {
        'subsonic-response': {
          searchResult3?: { artist?: { id: string; name: string }[] }
        }
      }
      const artist = searchData['subsonic-response'].searchResult3?.artist?.[0]
      if (!artist) continue

      const infoRes = await fetch(
        `${NAVIDROME_URL}/rest/getArtistInfo2?${params}&id=${artist.id}`,
        { signal: AbortSignal.timeout(5000) }
      )
      const infoData = await infoRes.json() as {
        'subsonic-response': {
          artistInfo2?: { largeImageUrl?: string; mediumImageUrl?: string; smallImageUrl?: string }
        }
      }
      const info = infoData['subsonic-response'].artistInfo2
      const imgUrl = info?.largeImageUrl || info?.mediumImageUrl || info?.smallImageUrl
      if (imgUrl) {
        artistImageCache.set(artistName.toLowerCase(), imgUrl)
      }
    } catch {}
  }

  console.log(`Found artist images for ${artistImageCache.size} artists\n`)

  // 3. Download artist images for missing albums
  let fetched = 0
  let noImage = 0

  for (const { artist, album, dir } of missing) {
    const imgUrl = artistImageCache.get(artist.toLowerCase())
    if (!imgUrl) {
      console.log(`  ${artist} / ${album} — no artist image available`)
      noImage++
      continue
    }

    process.stdout.write(`  ${artist} / ${album}... `)
    try {
      const imgRes = await fetch(imgUrl, {
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      })
      if (!imgRes.ok) {
        console.log(`failed (${imgRes.status})`)
        noImage++
        continue
      }

      const buffer = Buffer.from(await imgRes.arrayBuffer())
      if (buffer.length < 1000) {
        console.log('too small, skipping')
        noImage++
        continue
      }

      const contentType = imgRes.headers.get('content-type') || ''
      const ext = contentType.includes('png') ? 'png' : 'jpg'
      fs.writeFileSync(path.join(dir, `cover.${ext}`), buffer)
      console.log(`downloaded (${(buffer.length / 1024).toFixed(0)}KB)`)
      fetched++
    } catch (err) {
      console.log(`error: ${(err as Error).message}`)
      noImage++
    }
  }

  console.log(`\nArtist images: ${fetched} downloaded, ${noImage} unavailable`)
}

main().catch(err => { console.error(err); process.exit(1) })
