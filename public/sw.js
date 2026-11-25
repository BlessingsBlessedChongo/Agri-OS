/*
 * Agri-OS depot service worker. Opens the depot app without a connection: the page and its static assets are kept
 * in a cache after the first visit. API calls are never cached (the outbox in IndexedDB handles offline work).
 */
const CACHE = 'agrios-depot-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/depot'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  // Hashed build assets never change: cache first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/__nextjs_font/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
            return response
          }),
      ),
    )
    return
  }

  // The depot page itself: network first, cached copy when offline.
  if (request.mode === 'navigate' && url.pathname.startsWith('/depot')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/depot'))),
    )
  }
})
