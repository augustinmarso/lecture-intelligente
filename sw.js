// =============================================================
// sw.js — Service worker : l'app fonctionne hors-ligne comme une
// vraie application installée. Stratégie réseau d'abord (le
// mécanisme de mise à jour d'update.js reste maître), avec repli
// sur le cache quand le réseau manque. Tout GET réussi (app,
// modules, sons, pdf.js du CDN) est mis en cache au passage.
// =============================================================

const CACHE = 'li-offline-v4';
const CORE = [
  'index.html', 'library.js', 'notes.js', 'epub-reader.js', 'chapter-detect.js',
  'vault.js', 'ambient.js', 'dashboard.js', 'backup.js', 'dictionary.js',
  'shelf.js', 'ai.js', 'anki.js', 'cloud.js', 'update.js',
  'manifest.webmanifest', 'icon.svg', 'fonts/fonts.css'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(CORE).catch(() => {})) // best effort : offline partiel vaut mieux que rien
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Même origine + CDN pdf.js/jszip (nécessaires au lecteur hors-ligne)
  if (url.origin !== location.origin && url.origin !== 'https://cdnjs.cloudflare.com') return;
  // Les APIs externes (Wiktionnaire, Supabase, AnkiConnect…) ne passent pas ici

  // Polices : cache d'abord, et requête GET propre (les requêtes de police
  // portent parfois un en-tête Range que le relais SW fait échouer)
  if (req.destination === 'font' || url.pathname.includes('/fonts/')) {
    e.respondWith(
      caches.match(url.href).then(hit => hit || fetch(url.href).then(resp => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(url.href, copy)).catch(() => {});
        }
        return resp;
      }))
    );
    return;
  }

  e.respondWith(
    fetch(req).then(resp => {
      if (resp && resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return resp;
    }).catch(async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      // Navigation hors-ligne → coquille de l'app
      if (req.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      return new Response('Hors-ligne', { status: 503, statusText: 'Offline' });
    })
  );
});
