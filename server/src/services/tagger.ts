import NodeID3 from 'node-id3'
import path from 'path'
import { writeFlacTags, normalizeArtist, normalizeArtistSeparators } from './normalizer.js'

export interface TagData {
  title: string
  artist: string
  album: string
  trackNumber: string
  partOfSet?: string
  albumArtUrl?: string
  albumArtist?: string
  lyrics?: string
}

export async function tagFile(filePath: string, tags: TagData): Promise<void> {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.flac') {
    await tagFlacFile(filePath, tags)
  } else {
    await tagMp3File(filePath, tags)
  }
}

async function tagMp3File(filePath: string, tags: TagData): Promise<void> {
  // Normalize artist: convert semicolons to " / " for Navidrome splitting, then apply alias fixes
  const normalizedArtist = normalizeArtist(normalizeArtistSeparators(tags.artist))
  const normalizedAlbumArtist = tags.albumArtist
    ? normalizeArtist(normalizeArtistSeparators(tags.albumArtist))
    : undefined

  const id3Tags: NodeID3.Tags = {
    title: tags.title,
    artist: normalizedArtist,
    album: tags.album,
    trackNumber: tags.trackNumber,
    partOfSet: tags.partOfSet || '1',
    performerInfo: normalizedAlbumArtist || undefined,
  }

  // Fetch and embed album art if URL provided
  if (tags.albumArtUrl) {
    try {
      const res = await fetch(tags.albumArtUrl)
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer())
        id3Tags.image = {
          mime: 'image/jpeg',
          type: { id: 3, name: 'front cover' },
          description: 'Cover',
          imageBuffer: buffer,
        }
      }
    } catch {
      // Album art fetch failed, skip it
    }
  }

  if (tags.lyrics) {
    id3Tags.unsynchronisedLyrics = {
      language: 'eng',
      text: tags.lyrics,
    }
  }

  const success = NodeID3.update(id3Tags, filePath)
  if (success !== true) {
    throw new Error(`Failed to write ID3 tags to ${filePath}`)
  }
}

async function tagFlacFile(filePath: string, tags: TagData): Promise<void> {
  const normalizedArtist = normalizeArtist(normalizeArtistSeparators(tags.artist))
  const normalizedAlbumArtist = tags.albumArtist
    ? normalizeArtist(normalizeArtistSeparators(tags.albumArtist))
    : undefined

  await writeFlacTags(filePath, {
    artist: normalizedArtist,
    album: tags.album,
    title: tags.title,
    trackNumber: parseInt(tags.trackNumber) || 0,
    albumArtist: normalizedAlbumArtist,
  })
}
