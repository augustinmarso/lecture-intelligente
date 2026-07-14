// =============================================================
// backup.js — Export/Import complet des données de suivi
// Sauvegarde stats, fiches, positions, préférences
// Backup auto dans le vault si connecté
// =============================================================

const BACKUP_VERSION = 2;
const BACKUP_FILE = '_lecture-intelligente-backup.json';

// =============================================================
// Collecte des données
// =============================================================
async function collectAllData(includeBooks = false) {
  const data = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    stats: {},
    notes: [],
    books: [],
    preferences: {}
  };

  // localStorage — tout ce qui fait la mémoire de l'app
  const lsKeys = [
    'reading-stats-v1',
    'epub-reader-prefs-v1',
    'ambient-prefs-v1',
    'li-sujets',            // sujets en cours (méthode « Maîtriser un sujet »)
    'dict-saved-words-v1',  // mots du dictionnaire avec définitions
    'li-session-v1',        // session de travail en cours
    'li-anki',              // réglages Anki (deck, envoi auto)
    'dict-lang-v1',         // langue du dictionnaire
    'li-tomb'               // suppressions (évite les résurrections à la fusion)
  ];
  for (const k of lsKeys) {
    try { const v = localStorage.getItem(k); if (v) data.preferences[k] = v; } catch (_) {}
  }
  // Positions EPUB
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('epub-pos-')) {
      try { data.preferences[k] = localStorage.getItem(k); } catch (_) {}
    }
  }
  // Stats parsées
  try { data.stats = JSON.parse(localStorage.getItem('reading-stats-v1') || '{}'); } catch (_) {}

  // IndexedDB notes
  if (typeof notesGetAll === 'function') {
    try { data.notes = await notesGetAll(); } catch (_) {}
  }

  // IndexedDB books (métadonnées seulement, sans binaire)
  if (typeof libGetAll === 'function') {
    try {
      const books = await libGetAll();
      data.books = books.map(b => {
        const meta = {
          id: b.id,
          title: b.title,
          name: b.name,
          size: b.size,
          mime: b.mime,
          addedAt: b.addedAt,
          lastViewedAt: b.lastViewedAt,
          lastPage: b.lastPage,
          totalPages: b.totalPages
        };
        if (includeBooks && b.data) {
          // Encode binary en base64
          const bytes = new Uint8Array(b.data);
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          meta.dataB64 = btoa(bin);
        }
        return meta;
      });
    } catch (_) {}
  }

  return data;
}

// Fusion monotone des stats (max/union champ par champ) — reprise de
// l'ancienne synchro cloud, utilisée par la restauration ci-dessous.
function _mergeStats(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const out = Object.assign({}, a);
  out.pagesRead = Object.assign({}, b.pagesRead, a.pagesRead);
  out.booksOpened = Object.assign({}, b.booksOpened, a.booksOpened);
  out.readingTimeMs = Math.max(a.readingTimeMs || 0, b.readingTimeMs || 0);
  out.citations = Math.max(a.citations || 0, b.citations || 0);
  out.notes = Math.max(a.notes || 0, b.notes || 0);
  out.xp = Math.max(a.xp || 0, b.xp || 0);
  out.streakDays = Math.max(a.streakDays || 0, b.streakDays || 0);
  out.longestStreak = Math.max(a.longestStreak || 0, b.longestStreak || 0);
  out.lastActiveDay = [a.lastActiveDay, b.lastActiveDay].filter(Boolean).sort().pop() || null;
  out.badges = Array.from(new Set([...(a.badges || []), ...(b.badges || [])]));
  out.daily = Object.assign({}, b.daily, a.daily);
  // Jours présents des deux côtés : max champ par champ
  for (const day of Object.keys(b.daily || {})) {
    if (!(a.daily || {})[day]) continue;
    const da = a.daily[day], db = b.daily[day];
    out.daily[day] = {
      minutes: Math.max(da.minutes || 0, db.minutes || 0),
      pages: Math.max(da.pages || 0, db.pages || 0),
      citations: Math.max(da.citations || 0, db.citations || 0)
    };
  }
  return out;
}

// =============================================================
// Restauration
// =============================================================
async function restoreAllData(data, opts = {}) {
  if (!data || !data.version) throw new Error('Fichier de backup invalide');
  const merge = opts.merge !== false;
  let restored = { notes: 0, books: 0, prefs: 0 };

  // localStorage — clés fusionnées intelligemment, le reste est écrasé
  const SMART_KEYS = new Set(['li-sujets', 'dict-saved-words-v1', 'li-session-v1', 'reading-stats-v1']);
  const _parse = (s, fb) => { try { return JSON.parse(s) ?? fb; } catch (_) { return fb; } };
  if (data.preferences) {
    for (const [k, v] of Object.entries(data.preferences)) {
      if (SMART_KEYS.has(k)) continue;
      try { localStorage.setItem(k, v); restored.prefs++; } catch (_) {}
    }
    // Sujets : par id, le plus récent (updatedAt) gagne
    if (data.preferences['li-sujets']) {
      const cur = _parse(localStorage.getItem('li-sujets'), []);
      const inc = _parse(data.preferences['li-sujets'], []);
      const byId = new Map();
      [...inc, ...cur].forEach(s => {
        if (!s || !s.id) return;
        const p = byId.get(s.id);
        if (!p || (s.updatedAt || 0) >= (p.updatedAt || 0)) byId.set(s.id, s);
      });
      localStorage.setItem('li-sujets', JSON.stringify(Array.from(byId.values())));
      restored.prefs++;
    }
    // Mots : union par mot+langue, la sauvegarde la plus récente gagne
    if (data.preferences['dict-saved-words-v1']) {
      const cur = _parse(localStorage.getItem('dict-saved-words-v1'), []);
      const inc = _parse(data.preferences['dict-saved-words-v1'], []);
      const byW = new Map();
      [...inc, ...cur].forEach(w => {
        if (!w || !w.word) return;
        const k = w.word + '|' + (w.lang || '');
        const p = byW.get(k);
        if (!p || (w.savedAt || 0) >= (p.savedAt || 0)) byW.set(k, w);
      });
      localStorage.setItem('dict-saved-words-v1', JSON.stringify(Array.from(byW.values()).slice(0, 500)));
      restored.prefs++;
    }
    // Session en cours : la plus récente gagne
    if (data.preferences['li-session-v1']) {
      const cur = _parse(localStorage.getItem('li-session-v1'), null);
      const inc = _parse(data.preferences['li-session-v1'], null);
      if (inc && (!cur || (inc.savedAt || 0) > (cur.savedAt || 0))) {
        localStorage.setItem('li-session-v1', JSON.stringify(inc));
        restored.prefs++;
      }
    }
  }
  // Stats : fusion monotone (max/union), jamais de régression de compteurs
  if (data.stats && Object.keys(data.stats).length) {
    try {
      const cur = _parse(localStorage.getItem('reading-stats-v1'), null);
      const merged = (typeof _mergeStats === 'function') ? _mergeStats(cur, data.stats) : data.stats;
      localStorage.setItem('reading-stats-v1', JSON.stringify(merged));
    } catch (_) {}
  }

  // Notes — sans recréer celles qui existent déjà (identité = createdAt)
  if (Array.isArray(data.notes) && typeof notesAdd === 'function') {
    if (!merge && typeof notesGetAll === 'function' && typeof notesDelete === 'function') {
      const existing = await notesGetAll();
      for (const n of existing) await notesDelete(n.id);
    }
    let existingCreated = new Set();
    try { if (typeof notesGetAll === 'function') existingCreated = new Set((await notesGetAll()).map(n => n.createdAt)); } catch (_) {}
    for (const n of data.notes) {
      if (n.createdAt && existingCreated.has(n.createdAt)) continue;
      const clean = { ...n };
      delete clean.id;
      try { await notesAdd(clean); restored.notes++; } catch (_) {}
    }
  }

  // Books (uniquement si dataB64 inclus)
  if (Array.isArray(data.books) && typeof libAdd === 'function' && typeof libGetAll === 'function') {
    const existing = await libGetAll();
    const existingKeys = new Set(existing.map(b => `${b.name}|${b.size}`));
    for (const b of data.books) {
      if (!b.dataB64) continue;
      const key = `${b.name}|${b.size}`;
      if (existingKeys.has(key)) continue;
      try {
        const bin = atob(b.dataB64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const book = {
          title: b.title, name: b.name, size: b.size, mime: b.mime,
          data: bytes.buffer, addedAt: b.addedAt || Date.now(),
          lastPage: b.lastPage, totalPages: b.totalPages, lastViewedAt: b.lastViewedAt
        };
        await libAdd(book);
        restored.books++;
      } catch (_) {}
    }
  }

  return restored;
}

// =============================================================
// Export en téléchargement
// =============================================================
async function downloadBackup(includeBooks = false) {
  if (window.showToast) window.showToast(includeBooks ? 'Préparation du backup complet…' : 'Préparation du backup…');
  const data = await collectAllData(includeBooks);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  a.download = `lecture-intelligente-backup-${date}${includeBooks?'-full':''}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  if (window.showToast) window.showToast('✓ Backup téléchargé');
}

// =============================================================
// Import depuis fichier
// =============================================================
async function importBackupFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) { resolve(null); return; }
      try {
        const text = await f.text();
        const data = JSON.parse(text);
        const restored = await restoreAllData(data, { merge: true });
        if (window.showToast) window.showToast(`✓ Restauré : ${restored.notes} fiches, ${restored.books} livres, ${restored.prefs} préfs`);
        resolve(restored);
      } catch (err) {
        if (window.showToast) window.showToast('Erreur : ' + err.message);
        resolve(null);
      }
    };
    inp.click();
  });
}

// =============================================================
// Backup auto dans le vault (File System Access)
// =============================================================
async function vaultAutoBackup() {
  if (typeof vaultIsConnected !== 'function' || !await vaultIsConnected()) return false;
  try {
    const handle = window._getVaultHandle ? window._getVaultHandle() : null;
    if (!handle) return false;
    const data = await collectAllData(false); // sans PDFs (gardés localement)
    const json = JSON.stringify(data, null, 2);
    const fileHandle = await handle.getFileHandle(BACKUP_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(json);
    await writable.close();
    return true;
  } catch (e) {
    console.warn('vaultAutoBackup error', e);
    return false;
  }
}

async function vaultRestore() {
  if (typeof vaultIsConnected !== 'function' || !await vaultIsConnected()) {
    if (window.showToast) window.showToast('Vault non connecté');
    return null;
  }
  try {
    const handle = window._getVaultHandle ? window._getVaultHandle() : null;
    if (!handle) return null;
    const fileHandle = await handle.getFileHandle(BACKUP_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    const data = JSON.parse(text);
    const restored = await restoreAllData(data, { merge: true });
    if (window.showToast) window.showToast(`✓ Restauré depuis vault : ${restored.notes} fiches, ${restored.prefs} préfs`);
    return restored;
  } catch (e) {
    if (window.showToast) window.showToast('Aucun backup vault trouvé');
    return null;
  }
}

// =============================================================
// Auto-save dans le vault à chaque modification importante
// =============================================================
let _autosaveTimer = null;
function _scheduleAutoBackup() {
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => { vaultAutoBackup(); }, 3000);
}

window.addEventListener('load', () => {
  // Hook notesAdd / notesDelete
  ['notesAdd', 'notesDelete'].forEach(fn => {
    const orig = window[fn];
    if (typeof orig === 'function' && !orig.__backupWrapped) {
      window[fn] = async function(...args) {
        const r = await orig(...args);
        _scheduleAutoBackup();
        return r;
      };
      window[fn].__backupWrapped = true;
    }
  });
  // Tout changement signalé (sujets, mots…) + filet périodique (session, stats)
  document.addEventListener('li:changed', _scheduleAutoBackup);
  setInterval(() => { vaultAutoBackup(); }, 5 * 60 * 1000);
});

// =============================================================
// UI — Section dans le dashboard
// =============================================================
function _injectBackupSection() {
  const obs = new MutationObserver(() => {
    const dashBody = document.querySelector('#dash-modal .dash-body');
    if (!dashBody || dashBody.dataset.backupWired) return;
    dashBody.dataset.backupWired = '1';
    const section = document.createElement('div');
    section.className = 'dash-section dash-backup';
    section.innerHTML = `
      <h3>${icon('save',15)} Sauvegarde de mes données</h3>
      <p class="backup-desc">Toutes tes données (fiches, sujets, mots, stats, session, positions) vivent sur ton ordinateur. Connecte un dossier (Second Cerveau) dans les Paramètres : l'app y enregistre automatiquement chaque modification — place ce dossier dans OneDrive ou Google Drive et tu as une synchro sans aucun serveur.</p>
      <div class="backup-actions">
        <button class="backup-btn primary" data-act="export">↓ Télécharger un backup</button>
        <button class="backup-btn" data-act="export-full">↓ Backup complet (avec PDFs)</button>
        <button class="backup-btn" data-act="import">↑ Restaurer depuis fichier</button>
        <button class="backup-btn" data-act="vault-save">${icon('cloud_upload',15)} Sauver dans le vault</button>
        <button class="backup-btn" data-act="vault-restore">${icon('restore',15)} Restaurer du vault</button>
      </div>
      <div class="backup-info" id="backup-info"></div>
    `;
    dashBody.appendChild(section);

    section.querySelector('[data-act="export"]').onclick = () => downloadBackup(false);
    section.querySelector('[data-act="export-full"]').onclick = () => downloadBackup(true);
    section.querySelector('[data-act="import"]').onclick = importBackupFile;
    section.querySelector('[data-act="vault-save"]').onclick = async () => {
      const ok = await vaultAutoBackup();
      if (window.showToast) window.showToast(ok ? '✓ Backup vault OK' : 'Vault non connecté — va dans Biblio pour le connecter');
    };
    section.querySelector('[data-act="vault-restore"]').onclick = vaultRestore;
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// =============================================================
// Styles
// =============================================================
const _backupStyle = document.createElement('style');
_backupStyle.textContent = `
.dash-backup { padding-top: 14px; border-top: 1px solid var(--border); }
.backup-desc { font-size: 13px; color: var(--text2); line-height: 1.5; margin-bottom: 12px; }
.backup-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.backup-btn { padding: 8px 14px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: var(--radius); font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer; transition: all .15s; }
.backup-btn:hover { background: var(--bg2); border-color: var(--border2); }
.backup-btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.backup-btn.primary:hover { background: var(--accent-hover); }
.backup-info { margin-top: 10px; font-size: 12px; color: var(--text3); }
`;
document.head.appendChild(_backupStyle);

// =============================================================
// Expose vault handle pour backup auto
// =============================================================
window.addEventListener('load', () => {
  // Patch vault.js pour exposer le handle
  if (!window._getVaultHandle && typeof vaultIsConnected === 'function') {
    // Le handle est dans _vaultHandle dans vault.js — pas directement accessible
    // On va patcher vaultSaveNote pour qu'il déclenche aussi notre backup
    const origSave = window.vaultSaveNote;
    if (typeof origSave === 'function' && !origSave.__backupWrapped) {
      window.vaultSaveNote = async function(...args) {
        const r = await origSave(...args);
        _scheduleAutoBackup();
        return r;
      };
      window.vaultSaveNote.__backupWrapped = true;
    }
  }
});

// =============================================================
// Init
// =============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _injectBackupSection);
} else {
  _injectBackupSection();
}

window.collectAllData = collectAllData;
window.restoreAllData = restoreAllData;
window.downloadBackup = downloadBackup;
window.importBackupFile = importBackupFile;
window.vaultAutoBackup = vaultAutoBackup;
window.vaultRestore = vaultRestore;
