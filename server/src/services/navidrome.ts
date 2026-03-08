import { NAVIDROME_URL, NAVIDROME_USER, NAVIDROME_PASS } from '../config.js'

export async function triggerNavidromeScan(): Promise<void> {
  if (!NAVIDROME_USER || !NAVIDROME_PASS) {
    console.log('Navidrome not configured, skipping scan trigger')
    return
  }

  const params = new URLSearchParams({
    u: NAVIDROME_USER,
    p: NAVIDROME_PASS,
    c: 'music-library',
    v: '1.16.1',
    f: 'json',
  })

  try {
    const res = await fetch(`${NAVIDROME_URL}/rest/startScan.view?${params}`)
    const data = await res.json()
    console.log('Navidrome scan triggered:', data)
  } catch (err) {
    console.error('Failed to trigger Navidrome scan:', (err as Error).message)
  }
}
