import NodeID3 from 'node-id3'

export interface TagData {
  title: string
  artist: string
  album: string
  trackNumber: string
  partOfSet?: string
  albumArtUrl?: string
  albumArtist?: string
}

export async function tagFile(filePath: string, tags: TagData): Promise<void> {
  const id3Tags: NodeID3.Tags = {
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    trackNumber: tags.trackNumber,
    partOfSet: tags.partOfSet || '1',
    performerInfo: tags.albumArtist || undefined,
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

  const success = NodeID3.update(id3Tags, filePath)
  if (success !== true) {
    throw new Error(`Failed to write ID3 tags to ${filePath}`)
  }
}
