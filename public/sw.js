// Network-first service worker: fresh deploys win when online, the cached
// app shell keeps the whole tool working offline in the practice room.
//
// Bump this on a release. It has to actually change for the activate handler
// to delete anything — pinned at one value it swept nothing, and every dead
// asset from every past deploy stayed in the box forever.
const CACHE = 'music-companion-v4';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only keep what came back whole. A 404 or an error cached here is
        // served in place of the real file on every later visit.
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        // The shell is only a sensible answer to "give me a page". Handing it
        // to a missing script returned HTML under a JavaScript content type,
        // which fails far more confusingly than simply failing.
        if (request.mode === 'navigate') {
          const shell = await caches.match('/');
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});
