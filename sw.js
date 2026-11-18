// Offline support: keep a copy of the meter on the phone so it opens with no signal.
// The page is always served from the saved copy. Each time it is opened online, the files are fetched again
// in the background and replace the saved copy only if every file arrived. Google Fonts are saved as the page
// uses them (from the second visit on; the Japanese font comes in many small pieces, so not all of them up front).
// With no copy yet, the page falls back to the phone's own fonts.
const NAME = 'hibiki';
const FILES = ['./', 'index.html'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

async function fetchAll() {
  const tmp = NAME + '-next-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const next = await caches.open(tmp);
  try {
    await next.addAll(FILES.map((f) => new Request(f, { cache: 'no-cache' })));
    const main = await caches.open(NAME);
    for (const req of await next.keys()) await main.put(req, await next.match(req));
  } finally {
    await caches.delete(tmp);
  }
}

// wait a little after the page opens, so it finishes loading before its copy is replaced
let refreshing = null;
const refresh = () => (refreshing ||= new Promise((r) => setTimeout(r, 5000))
  .then(fetchAll).catch(() => {}).finally(() => { refreshing = null; }));

self.addEventListener('install', (e) => {
  e.waitUntil(fetchAll().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // the same site (adfreeapps.github.io) also hosts the other apps, so only touch this app's leftovers
    for (const k of await caches.keys()) if (k.startsWith(NAME + '-next-')) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const fonts = await caches.open(NAME + '-fonts');
      const hit = await fonts.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') fonts.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  if (url.origin !== location.origin) return;
  url.search = ''; url.hash = '';
  if (req.mode === 'navigate') e.waitUntil(refresh());
  e.respondWith((async () => {
    const main = await caches.open(NAME);
    const hit = await main.match(url.href);
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') { const page = await main.match(new URL('./', location.href).href); if (page) return page; }
      throw err;
    }
  })());
});
