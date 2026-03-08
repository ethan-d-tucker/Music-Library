import { searchYouTube, type SearchResult } from './ytdlp.js'

export interface MatchResult {
  result: SearchResult
  score: number
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean))
  const wordsB = new Set(b.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  let overlap = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++
  }
  return overlap / Math.max(wordsA.size, wordsB.size)
}

const PENALTY_WORDS = ['live', 'cover', 'remix', 'karaoke', 'instrumental', 'acoustic', 'concert', 'slowed', 'sped up', 'nightcore']

export function scoreResult(result: SearchResult, artist: string, title: string, expectedDurationMs: number): number {
  let score = 0
  const primaryArtist = artist.split(',')[0].trim().toLowerCase()
  const ytTitleLower = result.title.toLowerCase()
  const channelLower = result.channel.toLowerCase()
  const spotifyTitleLower = title.toLowerCase()

  // --- Source quality signals ---

  // "Topic" channel (YouTube Music auto-generated) — best possible source
  if (channelLower.endsWith(' - topic') && channelLower.includes(primaryArtist)) {
    score += 0.5
  }

  // VEVO channel — official music videos
  if (channelLower.includes('vevo')) {
    score += 0.3
  }

  // "Official Audio" or "Official Video" in title
  if (ytTitleLower.includes('official audio') || ytTitleLower.includes('official video') || ytTitleLower.includes('official music video')) {
    score += 0.2
  }

  // "Provided to YouTube" in description — label-uploaded content
  if (result.description.includes('Provided to YouTube')) {
    score += 0.15
  }

  // --- Duration match (0 to 0.5) ---
  if (expectedDurationMs > 0 && result.duration > 0) {
    const expectedSec = expectedDurationMs / 1000
    const ratio = Math.abs(result.duration - expectedSec) / expectedSec
    if (ratio <= 0.05) score += 0.5       // near-exact match
    else if (ratio <= 0.15) score += 0.35
    else if (ratio <= 0.30) score += 0.15
    // >30% difference gets nothing
  }

  // --- Title similarity (0 to 0.3) ---
  score += wordOverlap(result.title, title) * 0.3

  // --- Channel contains artist name (0 to 0.1) ---
  if (channelLower.includes(primaryArtist)) {
    score += 0.1
  }

  // --- Penalty for unwanted variants ---
  for (const word of PENALTY_WORDS) {
    if (ytTitleLower.includes(word) && !spotifyTitleLower.includes(word)) {
      score -= 0.25
      break
    }
  }

  return score
}

function cleanTitle(title: string): string {
  return title
    .replace(/\s*\(feat\..*?\)/gi, '')
    .replace(/\s*\[feat\..*?\]/gi, '')
    .replace(/\s*ft\..*$/gi, '')
    .trim()
}

function bestFromResults(results: SearchResult[], artist: string, title: string, durationMs: number): MatchResult | null {
  let best: MatchResult | null = null
  for (const result of results) {
    const score = scoreResult(result, artist, title, durationMs)
    if (!best || score > best.score) {
      best = { result, score }
    }
  }
  return best
}

export async function findBestMatch(artist: string, title: string, durationMs: number): Promise<MatchResult | null> {
  const primaryArtist = artist.split(',')[0].trim()
  const cleanedTitle = cleanTitle(title)

  // Pass 1: Target Topic channels (YouTube Music auto-generated — best quality)
  const topicQuery = `"${primaryArtist} - Topic" "${cleanedTitle}"`
  const topicResults = await searchYouTube(topicQuery, 5)
  const topicBest = bestFromResults(topicResults, artist, title, durationMs)
  if (topicBest && topicBest.score >= 0.5) {
    return topicBest
  }

  // Pass 2: Search for official audio
  const officialQuery = `"${primaryArtist}" "${cleanedTitle}" official audio`
  const officialResults = await searchYouTube(officialQuery, 5)
  const officialBest = bestFromResults(officialResults, artist, title, durationMs)
  if (officialBest && officialBest.score >= 0.4) {
    // If topic search also had a result, compare them
    if (topicBest && topicBest.score >= officialBest.score) return topicBest
    return officialBest
  }

  // Pass 3: Generic fallback
  const genericQuery = `"${primaryArtist}" "${cleanedTitle}"`
  const genericResults = await searchYouTube(genericQuery, 5)
  const genericBest = bestFromResults(genericResults, artist, title, durationMs)

  // Pick the best across all passes
  const candidates = [topicBest, officialBest, genericBest].filter((c): c is MatchResult => c !== null)
  candidates.sort((a, b) => b.score - a.score)

  if (candidates.length === 0 || candidates[0].score < 0.3) {
    return null
  }

  return candidates[0]
}
