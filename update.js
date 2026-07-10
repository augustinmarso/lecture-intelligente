// =============================================================
// update.js — Mise à jour automatique : GitHub Pages met en cache
// les fichiers ~10 min et le navigateur garde d'anciennes versions.
// À chaque ouverture, on compare l'index.html frais (no-store) à la
// version connue ; s'il a changé, on rafraîchit le cache HTTP de
// tous les modules puis on recharge la page une fois.
// =============================================================

(async () => {
  try {
    const resp = await fetch('index.html', { cache: 'no-store' });
    if (!resp.ok) return;
    const text = await resp.text();
    let h = 0;
    for (let i = 0; i < text.length; i++) { h = (h * 31 + text.charCodeAt(i)) | 0; }
    const sig = h + ':' + text.length;
    const prev = localStorage.getItem('li-version');

    if (prev && prev !== sig && !sessionStorage.getItem('li-updating')) {
      sessionStorage.setItem('li-updating', '1'); // évite toute boucle de rechargement
      const files = ['index.html', 'library.js', 'notes.js', 'epub-reader.js', 'chapter-detect.js',
        'vault.js', 'ambient.js', 'dashboard.js', 'backup.js',
        'shelf.js', 'ai.js', 'anki.js', 'cloud.js', 'update.js', 'manifest.webmanifest'];
      await Promise.all(files.map(f => fetch(f, { cache: 'reload' }).catch(() => {})));
      localStorage.setItem('li-version', sig);
      if (window.showToast) window.showToast('Nouvelle version — rechargement…');
      setTimeout(() => location.reload(), 400);
      return;
    }
    localStorage.setItem('li-version', sig);
    sessionStorage.removeItem('li-updating');
  } catch (_) { /* hors-ligne : on garde la version en cache */ }
})();
