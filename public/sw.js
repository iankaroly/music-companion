// Network-first service worker: fresh deploys win when online, the cached
// app shell keeps the whole tool working offline in the practice room.
//
// One cache per build, and nobody has to remember to bump it.
//
// The app registers this script as /sw.js?v=<build>, so the version is written
// on the worker's own URL: a deploy is a new script, a new script is a new
// cache, and the activate handler below sweeps every older one. Pinned at a
// constant it swept nothing — every dead asset from every past deploy stayed
// in the box forever, and a home-screen app had no way to notice a release at
// all.
const BUILD = new URL(self.location.href).searchParams.get('v') || 'v4';
const CACHE = `music-companion-${BUILD}`;

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
