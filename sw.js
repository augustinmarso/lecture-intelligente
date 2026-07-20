// =============================================================
// sw.js — Service worker : l'app fonctionne hors-ligne comme une
// vraie application installée. Stratégie réseau d'abord (le
// mécanisme de mise à jour d'update.js reste maître), avec repli
// sur le cache quand le réseau manque. Tout GET réussi (app,
// modules, sons, pdf.js du CDN) est mis en cache au passage.
// =============================================================

const CACHE = 'li-offline-v24';
const CORE = [
  'index.html', 'library.js', 'notes.js', 'epub-reader.js', 'chapter-detect.js',
  'vault.js', 'ambient.js', 'dashboard.js', 'backup.js', 'dictionary.js',
  'shelf.js', 'ai.js', 'anki.js', 'voice.js', 'update.js',
  'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/jszip.min.js',
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
  // Même origine uniquement (pdf.js/jszip sont auto-hébergés dans vendor/)
  if (url.origin !== location.origin) return;
  // Les APIs externes (Wiktionnaire, AnkiConnect…) ne passent pas ici

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

  // Navigation : renvoie le document AVEC l'isolation cross-origin
  // (COOP/COEP credentialless) → active le WASM multi-thread pour la dictée
  // vocale hors-ligne (voice.js), y compris sur GitHub Pages qui ne pose pas
  // ces en-têtes. credentialless = ne casse pas pdf.js/jszip du CDN.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      let resp;
      try {
        resp = await fetch(req);
        if (resp && resp.ok) { const copy = resp.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      } catch (_) {
        resp = (await caches.match(req)) || (await caches.match('index.html'));
      }
      if (!resp) return new Response('Hors-ligne', { status: 503, statusText: 'Offline' });
      const h = new Headers(resp.headers);
      h.set('Cross-Origin-Opener-Policy', 'same-origin');
      h.set('Cross-Origin-Embedder-Policy', 'credentialless');
      return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
    })());
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
      return new Response('Hors-ligne', { status: 503, statusText: 'Offline' });
    })
  );
});
