const CACHE_NAME = 'music-library-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  // Network-first for everything — don't cache audio or API calls
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  )
})
