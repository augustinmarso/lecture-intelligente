// =============================================================
// cloud.js — Synchro cloud (Supabase) : sujets, fiches, mots du
// dictionnaire, statistiques, session en cours et progression de
// lecture, sur tous les appareils via un code secret (pas de
// compte). Les données passent par les RPC li_pull/li_push ; la
// table est verrouillée par RLS, le code (>= 32 chars aléatoires)
// fait office de clé. Les PDF eux-mêmes restent locaux.
// =============================================================

const CLOUD_URL = 'https://aicfplhedeuveautpbio.supabase.co';
const CLOUD_KEY = 'sb_publishable_ySck-CSyJil4SBgD3SEVRg_2FI2VHHS';
const CLOUD_STORE = 'li-cloud';
const TOMB_STORE = 'li-tomb';

function _cloudCfg() {
  try { return JSON.parse(localStorage.getItem(CLOUD_STORE) || '{}'); } catch (_) { return {}; }
}
function _cloudSave(patch) {
  localStorage.setItem(CLOUD_STORE, JSON.stringify(Object.assign(_cloudCfg(), patch)));
}
function _tomb() {
  try { return Object.assign({ sujets: [], notes: [] }, JSON.parse(localStorage.getItem(TOMB_STORE) || '{}')); }
  catch (_) { return { sujets: [], notes: [] }; }
}
function _tombSave(t) {
  t.sujets = (t.sujets || []).slice(-1000);
  t.notes = (t.notes || []).slice(-1000);
  localStorage.setItem(TOMB_STORE, JSON.stringify(t));
}

async function _cloudRpc(fn, args) {
  const resp = await fetch(`${CLOUD_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'apikey': CLOUD_KEY,
      'authorization': 'Bearer ' + CLOUD_KEY
    },
    body: JSON.stringify(args)
  });
  if (!resp.ok) {
    let msg = 'Erreur cloud (' + resp.status + ')';
    try { const j = await resp.json(); if (j.message) msg = j.message; } catch (_) {}
    throw new Error(msg);
  }
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

// --- Collecte et fusion ---
function _lsJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
}

async function _collectLocal() {
  const sujets = (typeof sujetsAll === 'function' ? sujetsAll() : (window.sujetsAll ? window.sujetsAll() : []));
  let notes = [];
  try { if (window.notesGetAll) notes = await window.notesGetAll(); } catch (_) {}
  // Les fiches sont identifiées entre appareils par createdAt (l'id
  // IndexedDB est local) ; on retire les ids pour éviter les collisions.
  notes = notes.map(n => { const c = Object.assign({}, n); delete c.id; return c; });

  // Mots du dictionnaire (avec définitions)
  const mots = _lsJson('dict-saved-words-v1', []);
  // Statistiques / gamification
  const stats = _lsJson('reading-stats-v1', null);
  // Session de travail en cours (la plus récente gagne entre appareils)
  const session = _lsJson('li-session-v1', null);
  // Progression de lecture des livres (métadonnées seulement — pas les PDF)
  let booksMeta = [];
  try {
    if (window.libGetAll) {
      booksMeta = (await window.libGetAll()).map(b => ({
        title: b.title, name: b.name, size: b.size,
        lastPage: b.lastPage, totalPages: b.totalPages,
        lastViewedAt: b.lastViewedAt, addedAt: b.addedAt
      }));
    }
  } catch (_) {}

  return { sujets, notes, mots, stats, session, booksMeta, tomb: _tomb(), exportedAt: Date.now() };
}

function _mergePayloads(local, remote) {
  remote = remote || {};
  const tomb = {
    sujets: Array.from(new Set([...(local.tomb.sujets || []), ...((remote.tomb && remote.tomb.sujets) || [])])),
    notes: Array.from(new Set([...(local.tomb.notes || []), ...((remote.tomb && remote.tomb.notes) || [])]))
  };
  const tombS = new Set(tomb.sujets);
  const tombN = new Set(tomb.notes);

  // Sujets : par id, le plus récent (updatedAt) gagne
  const byId = new Map();
  [...(remote.sujets || []), ...(local.sujets || [])].forEach(s => {
    if (!s || !s.id || tombS.has(s.id)) return;
    const cur = byId.get(s.id);
    if (!cur || (s.updatedAt || 0) >= (cur.updatedAt || 0)) byId.set(s.id, s);
  });

  // Fiches : par createdAt, la version locale gagne si présente des deux côtés
  const byCreated = new Map();
  [...(remote.notes || []), ...(local.notes || [])].forEach(n => {
    if (!n || !n.createdAt || tombN.has(n.createdAt)) return;
    byCreated.set(n.createdAt, n);
  });

  // Mots : union par mot+langue, la sauvegarde la plus récente gagne
  const byWord = new Map();
  [...(remote.mots || []), ...(local.mots || [])].forEach(w => {
    if (!w || !w.word) return;
    const k = w.word + '|' + (w.lang || '');
    const cur = byWord.get(k);
    if (!cur || (w.savedAt || 0) >= (cur.savedAt || 0)) byWord.set(k, w);
  });

  // Stats : fusion monotone — union des pages/livres, max des compteurs
  // (la somme compterait double entre appareils, le max ne régresse jamais)
  const stats = _mergeStats(local.stats, remote.stats);

  // Session en cours : la plus récemment enregistrée gagne
  const lS = local.session, rS = remote.session;
  const session = (!rS || (lS && (lS.savedAt || 0) >= (rS.savedAt || 0))) ? lS : rS;

  // Progression des livres : par fichier (nom|taille), la lecture la plus récente gagne
  const byBook = new Map();
  [...(remote.booksMeta || []), ...(local.booksMeta || [])].forEach(b => {
    if (!b || !b.name) return;
    const k = b.name + '|' + (b.size || 0);
    const cur = byBook.get(k);
    if (!cur || (b.lastViewedAt || 0) >= (cur.lastViewedAt || 0)) byBook.set(k, b);
  });

  return {
    sujets: Array.from(byId.values()),
    notes: Array.from(byCreated.values()),
    mots: Array.from(byWord.values()).slice(0, 500),
    stats,
    session,
    booksMeta: Array.from(byBook.values()),
    tomb,
    exportedAt: Date.now()
  };
}

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

async function _applyLocal(merged, local) {
  // Sujets
  const w = (typeof sujetsWrite === 'function' ? sujetsWrite : window.sujetsWrite);
  if (w && JSON.stringify(merged.sujets) !== JSON.stringify(local.sujets)) w(merged.sujets);
  _tombSave(merged.tomb);
  // Fiches manquantes en local
  const localCreated = new Set(local.notes.map(n => n.createdAt));
  let added = 0;
  for (const n of merged.notes) {
    if (!localCreated.has(n.createdAt) && window.notesAdd) {
      try { await window.notesAdd(Object.assign({}, n)); added++; } catch (e) { console.warn('cloud note add', e); }
    }
  }
  // Mots du dictionnaire
  try {
    if (JSON.stringify(merged.mots || []) !== JSON.stringify(local.mots || [])) {
      localStorage.setItem('dict-saved-words-v1', JSON.stringify(merged.mots || []));
    }
  } catch (_) {}
  // Statistiques
  try {
    if (merged.stats && JSON.stringify(merged.stats) !== JSON.stringify(local.stats)) {
      localStorage.setItem('reading-stats-v1', JSON.stringify(merged.stats));
    }
  } catch (_) {}
  // Session en cours : appliquée en stockage seulement — elle prendra effet
  // au prochain démarrage (restoreState), sans perturber la session active
  try {
    if (merged.session && (!local.session || (merged.session.savedAt || 0) > (local.session.savedAt || 0))) {
      localStorage.setItem('li-session-v1', JSON.stringify(merged.session));
    }
  } catch (_) {}
  // Progression des livres : si un livre local a été lu plus loin ailleurs,
  // on met à jour sa position (sans toucher au fichier ni à lastViewedAt local
  // au-delà de la valeur distante — évite l'escalade entre appareils)
  try {
    if (window.libGetAll && typeof openDB === 'function' && (merged.booksMeta || []).length) {
      const metaByKey = new Map((merged.booksMeta || []).map(b => [b.name + '|' + (b.size || 0), b]));
      const books = await window.libGetAll();
      const d = await openDB();
      for (const b of books) {
        const m = metaByKey.get(b.name + '|' + (b.size || 0));
        if (m && (m.lastViewedAt || 0) > (b.lastViewedAt || 0)) {
          b.lastPage = m.lastPage; b.totalPages = m.totalPages || b.totalPages; b.lastViewedAt = m.lastViewedAt;
          d.transaction('books', 'readwrite').objectStore('books').put(b);
        }
      }
    }
  } catch (e) { console.warn('cloud books meta', e); }
  return added;
}

// --- Synchro ---
let _syncing = false;
async function cloudSyncNow(opts) {
  opts = opts || {};
  const cfg = _cloudCfg();
  if (!cfg.code) { if (!opts.silent && window.showToast) window.showToast('Synchro non activée'); return false; }
  if (_syncing) return false;
  _syncing = true;
  _renderCloudBar('Synchronisation…');
  try {
    const local = await _collectLocal();
    const remote = await _cloudRpc('li_pull', { p_code: cfg.code });
    const merged = _mergePayloads(local, remote);
    const added = await _applyLocal(merged, local);
    await _cloudRpc('li_push', { p_code: cfg.code, p_data: merged });
    _cloudSave({ lastSync: Date.now() });
    if (!opts.silent && window.showToast) window.showToast('Synchronisé' + (added ? ` (${added} fiche${added > 1 ? 's' : ''} récupérée${added > 1 ? 's' : ''})` : ''));
    // Rafraîchir l'accueil si la liste des sujets a changé
    if (added || JSON.stringify(merged.sujets) !== JSON.stringify(local.sujets)) {
      if (window.render && window.state && !window.state.done && window.state.step === 0) window.render();
    }
    return true;
  } catch (e) {
    console.warn('cloud sync', e);
    if (!opts.silent && window.showToast) window.showToast('Synchro impossible : ' + e.message);
    return false;
  } finally {
    _syncing = false;
    _renderCloudBar();
  }
}
window.cloudSyncNow = cloudSyncNow;

function _cloudNewCode() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'li-' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Push différé quand les données changent
let _pushTimer = null;
document.addEventListener('li:changed', () => {
  if (!_cloudCfg().code) return;
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => cloudSyncNow({ silent: true }), 5000);
});

// Tombstones des fiches supprimées + signal de changement
function _hookNotes() {
  const origDelete = window.notesDelete;
  if (typeof origDelete === 'function' && !origDelete.__cloudWrapped) {
    window.notesDelete = async function (id) {
      try {
        const n = window.notesGet ? await window.notesGet(id) : null;
        if (n && n.createdAt) { const t = _tomb(); t.notes.push(n.createdAt); _tombSave(t); }
      } catch (_) {}
      const r = await origDelete(id);
      document.dispatchEvent(new CustomEvent('li:changed'));
      return r;
    };
    window.notesDelete.__cloudWrapped = true;
  }
  const origAdd = window.notesAdd;
  if (typeof origAdd === 'function' && !origAdd.__cloudWrapped) {
    window.notesAdd = async function (note) {
      const r = await origAdd(note);
      document.dispatchEvent(new CustomEvent('li:changed'));
      return r;
    };
    window.notesAdd.__cloudWrapped = true;
  }
}

// --- UI : barre Cloud dans le modal bibliothèque ---
function _renderCloudBar(statusOverride) {
  const status = document.getElementById('cloud-status');
  if (!status) return;
  const cfg = _cloudCfg();
  const on = !!cfg.code;
  if (statusOverride && on) {
    status.textContent = statusOverride;
  } else if (on) {
    status.textContent = cfg.lastSync ? 'Synchro active · ' + new Date(cfg.lastSync).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'Synchro active';
    status.classList.add('connected');
  } else {
    status.textContent = 'Non activée';
    status.classList.remove('connected');
  }
  const off = document.getElementById('cloud-off-actions');
  const onA = document.getElementById('cloud-on-actions');
  if (off) off.style.display = on ? 'none' : '';
  if (onA) onA.style.display = on ? '' : 'none';
}

function _injectCloudBar() {
  const _doInject = () => {
    const modalContent = document.querySelector('#lib-modal .lib-content');
    if (!modalContent || modalContent.dataset.cloudWired) return;
    const header = modalContent.querySelector('.lib-header');
    if (!header) return;
    modalContent.dataset.cloudWired = '1';

    const bar = document.createElement('div');
    bar.className = 'vault-bar cloud-bar';
    bar.innerHTML = `
      <div class="vault-left">
        <strong>${icon('cloud_sync', 14)} Cloud</strong>
        <span id="cloud-status" class="vault-status">Non activée</span>
      </div>
      <div class="vault-actions">
        <span id="cloud-off-actions" style="display:flex;gap:4px;flex-wrap:wrap">
          <button id="cloud-enable" class="gd-btn vault-primary">${icon('cloud_upload', 15)} Activer la synchro</button>
          <input id="cloud-code-in" type="password" placeholder="Ou colle un code existant…"/>
          <button id="cloud-link" class="gd-btn">Relier</button>
        </span>
        <span id="cloud-on-actions" style="display:none;gap:4px;flex-wrap:wrap">
          <button id="cloud-sync" class="gd-btn">${icon('sync', 15)} Sync maintenant</button>
          <button id="cloud-copy" class="gd-btn" title="Copier le code pour tes autres appareils">${icon('content_copy', 15)} Copier le code</button>
          <button id="cloud-off" class="gd-btn" title="Désactiver la synchro sur cet appareil">✕</button>
        </span>
      </div>
    `;
    header.insertAdjacentElement('afterend', bar);

    document.getElementById('cloud-enable').onclick = async () => {
      _cloudSave({ code: _cloudNewCode() });
      _renderCloudBar();
      if (window.showToast) window.showToast('Synchro activée — copie le code sur tes autres appareils');
      await cloudSyncNow({ silent: true });
    };
    document.getElementById('cloud-link').onclick = async () => {
      const v = document.getElementById('cloud-code-in').value.trim();
      if (v.length < 32) { if (window.showToast) window.showToast('Code invalide'); return; }
      _cloudSave({ code: v });
      _renderCloudBar();
      const ok = await cloudSyncNow({});
      if (ok && window.showToast) window.showToast('Appareil relié — données synchronisées');
    };
    document.getElementById('cloud-sync').onclick = () => cloudSyncNow({});
    document.getElementById('cloud-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(_cloudCfg().code);
        if (window.showToast) window.showToast('Code copié — colle-le dans « Relier » sur l\'autre appareil');
      } catch (_) {
        prompt('Copie ce code :', _cloudCfg().code);
      }
    };
    document.getElementById('cloud-off').onclick = () => {
      if (!confirm('Désactiver la synchro sur cet appareil ? (les données restent en local et dans le cloud)')) return;
      _cloudSave({ code: '' });
      _renderCloudBar();
    };
    _renderCloudBar();
  };
  new MutationObserver(_doInject).observe(document.body, { childList: true, subtree: true });
  _doInject();
}

// --- Styles ---
const _cloudStyle = document.createElement('style');
_cloudStyle.textContent = `
.cloud-bar input#cloud-code-in { width: 180px; padding: 4px 10px; border: none; border-radius: var(--radius); font-family: inherit; font-size: 12px; background: var(--bg); color: var(--text); box-shadow: inset 0 0 0 1px var(--border); height: 28px; }
.cloud-bar input#cloud-code-in:focus { outline: none; box-shadow: inset 0 0 0 1px var(--accent); }
`;
document.head.appendChild(_cloudStyle);

// --- Init ---
window.addEventListener('load', () => {
  _injectCloudBar();
  setTimeout(_hookNotes, 700); // après les wraps de vault.js
  if (_cloudCfg().code) {
    setTimeout(() => cloudSyncNow({ silent: true }), 2500);
    setInterval(() => cloudSyncNow({ silent: true }), 3 * 60 * 1000);
  }
});
