// =============================================================
// shelf.js — Bibliothèque de l'ordinateur : connecte un dossier
// local (File System Access API), scanne récursivement les PDF
// et permet de les ouvrir directement dans l'app sans
// import manuel. Le handle est persisté dans IndexedDB.
// =============================================================

const SHELF_HANDLE_KEY = 'shelf-handle';
let _shelfHandle = null;
let _shelfFiles = null;   // cache du scan pour la session
let _shelfFilter = '';

function _escShelf(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// --- Persistance du handle (même DB de config que vault.js) ---
async function _shelfDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('vault-config', 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('config')) d.createObjectStore('config');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function _saveShelfHandle(handle) {
  const d = await _shelfDb();
  return new Promise((resolve, reject) => {
    const r = d.transaction('config', 'readwrite').objectStore('config').put(handle, SHELF_HANDLE_KEY);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}
async function _loadShelfHandle() {
  const d = await _shelfDb();
  return new Promise((resolve, reject) => {
    const r = d.transaction('config').objectStore('config').get(SHELF_HANDLE_KEY);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}
async function _clearShelfHandle() {
  const d = await _shelfDb();
  return new Promise((resolve, reject) => {
    const r = d.transaction('config', 'readwrite').objectStore('config').delete(SHELF_HANDLE_KEY);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

async function _shelfPermission(mode = 'read') {
  if (!_shelfHandle) return false;
  if ((await _shelfHandle.queryPermission({ mode })) === 'granted') return true;
  if ((await _shelfHandle.requestPermission({ mode })) === 'granted') return true;
  return false;
}

// --- Connexion ---
async function shelfConnect() {
  if (!window.showDirectoryPicker) {
    if (window.showToast) window.showToast('Navigateur non compatible (utilise Chrome/Edge)');
    return false;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read', id: 'shelf-livres', startIn: 'documents' });
    _shelfHandle = handle;
    _shelfFiles = null;
    await _saveShelfHandle(handle);
    if (window.showToast) window.showToast('Dossier connecté : ' + handle.name);
    _renderShelfBar();
    if (window.renderHomeBooks) window.renderHomeBooks();
    await shelfBrowse();
    return true;
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('shelf connect error', e);
    return false;
  }
}

async function shelfDisconnect() {
  _shelfHandle = null;
  _shelfFiles = null;
  await _clearShelfHandle();
  if (window.showToast) window.showToast('Dossier déconnecté');
  _renderShelfBar();
  if (window.renderHomeBooks) window.renderHomeBooks();
  if (typeof renderLibrary === 'function') renderLibrary();
}

// --- Scan récursif ---
const SHELF_SKIP_DIRS = new Set(['node_modules', '.git', '$recycle.bin', 'system volume information', 'appdata', '__pycache__']);
const SHELF_MAX_FILES = 3000;
const SHELF_MAX_DEPTH = 8;

async function _scanDir(dirHandle, relPath, out, depth) {
  if (depth > SHELF_MAX_DEPTH || out.length >= SHELF_MAX_FILES) return;
  try {
    for await (const [name, h] of dirHandle.entries()) {
      if (out.length >= SHELF_MAX_FILES) return;
      if (h.kind === 'directory') {
        if (name.startsWith('.') || SHELF_SKIP_DIRS.has(name.toLowerCase())) continue;
        await _scanDir(h, relPath ? relPath + '/' + name : name, out, depth + 1);
      } else {
        if (name.toLowerCase().endsWith('.pdf')) {
          out.push({ name, dir: relPath, handle: h, type: 'pdf' });
        }
      }
    }
  } catch (e) { console.warn('shelf scan', relPath, e); }
}

async function shelfScan(force) {
  if (_shelfFiles && !force) return _shelfFiles;
  if (!_shelfHandle) return [];
  if (!await _shelfPermission('read')) {
    if (window.showToast) window.showToast('Permission refusée pour le dossier');
    return [];
  }
  const out = [];
  await _scanDir(_shelfHandle, '', out, 0);
  out.sort((a, b) => (a.dir + '/' + a.name).localeCompare(b.dir + '/' + b.name, 'fr'));
  _shelfFiles = out;
  return out;
}

// --- Ouverture d'un fichier du disque ---
async function shelfOpen(idx) {
  const entry = _shelfFiles && _shelfFiles[idx];
  if (!entry) return;
  try {
    const file = await entry.handle.getFile();
    const modal = document.getElementById('lib-modal');
    if (modal) modal.classList.remove('open');
    if (window.loadPdfFile) await window.loadPdfFile(file);
  } catch (e) {
    console.error('shelf open', e);
    if (window.showToast) window.showToast('Impossible d\'ouvrir le fichier : ' + e.message);
  }
}

// --- Vue "Mon ordinateur" dans le modal bibliothèque ---
async function shelfBrowse() {
  const body = document.getElementById('lib-body');
  if (!body) return;
  const modal = document.getElementById('lib-modal');
  if (modal) modal.classList.add('open');
  if (!_shelfHandle) {
    body.innerHTML = `<div class="lib-empty">Aucun dossier connecté.<br><br>Clique sur <strong>Connecter un dossier</strong> dans la barre « Mon ordinateur » pour rendre toute ta bibliothèque accessible ici.</div>`;
    return;
  }
  body.innerHTML = `<div class="lib-empty">Analyse du dossier « ${_escShelf(_shelfHandle.name)} »…</div>`;
  const files = await shelfScan();
  _renderShelfList(files);
}

function _renderShelfList(files) {
  const body = document.getElementById('lib-body');
  if (!body) return;
  const q = _shelfFilter.toLowerCase();
  const filtered = q ? files.filter(f => (f.dir + '/' + f.name).toLowerCase().includes(q)) : files;

  // Groupement par sous-dossier
  const groups = new Map();
  filtered.forEach((f, i) => {
    const key = f.dir || '(racine)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  });

  const rows = Array.from(groups.entries()).map(([dir, items]) => `
    <div class="shelf-group">
      <div class="shelf-group-title">${icon('folder', 14)} ${_escShelf(dir)}</div>
      ${items.map(f => {
        const idx = _shelfFiles.indexOf(f);
        return `
        <div class="shelf-file">
          <span class="shelf-file-icon">${icon('picture_as_pdf', 16)}</span>
          <span class="shelf-file-name">${_escShelf(f.name)}</span>
          <button class="lib-action shelf-open" data-idx="${idx}">${icon('menu_book', 15)} Ouvrir</button>
        </div>`;
      }).join('')}
    </div>`).join('');

  body.innerHTML = `
    <div class="shelf-toolbar">
      <strong>${icon('computer', 15)} ${_escShelf(_shelfHandle.name)}</strong>
      <span class="shelf-count">${filtered.length} livre${filtered.length > 1 ? 's' : ''}</span>
      <input id="shelf-search" type="search" placeholder="Rechercher un livre…" value="${_escShelf(_shelfFilter)}"/>
      <button class="lib-action" id="shelf-rescan" title="Relancer l'analyse du dossier">${icon('refresh', 15)}</button>
    </div>
    ${filtered.length === 0 ? '<div class="lib-empty">Aucun PDF trouvé dans ce dossier.</div>' : rows}
  `;

  const search = document.getElementById('shelf-search');
  if (search) {
    search.oninput = () => { _shelfFilter = search.value; _renderShelfList(_shelfFiles); const s = document.getElementById('shelf-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } };
  }
  const rescan = document.getElementById('shelf-rescan');
  if (rescan) rescan.onclick = async () => {
    if (window.showToast) window.showToast('Nouvelle analyse…');
    await shelfScan(true);
    _renderShelfList(_shelfFiles);
  };
  body.querySelectorAll('.shelf-open').forEach(btn => {
    btn.onclick = () => shelfOpen(parseInt(btn.dataset.idx));
  });
}

// --- Barre dans le modal ---
function _renderShelfBar() {
  const status = document.getElementById('shelf-status');
  const btnConnect = document.getElementById('shelf-connect');
  const btnBrowse = document.getElementById('shelf-browse');
  const btnDisconnect = document.getElementById('shelf-disconnect');
  if (!status) return;
  if (_shelfHandle) {
    status.textContent = _shelfHandle.name;
    status.classList.add('connected');
    if (btnConnect) btnConnect.style.display = 'none';
    if (btnBrowse) btnBrowse.disabled = false;
    if (btnDisconnect) btnDisconnect.disabled = false;
  } else {
    status.textContent = 'Aucun dossier connecté';
    status.classList.remove('connected');
    if (btnConnect) btnConnect.style.display = '';
    if (btnBrowse) btnBrowse.disabled = true;
    if (btnDisconnect) btnDisconnect.disabled = true;
  }
}

function _injectShelfBar() {
  const _doInject = () => {
    const slot = document.getElementById('li-set-shelf');
    if (!slot || slot.dataset.wired || document.querySelector('.shelf-bar')) return;
    slot.dataset.wired = '1';

    const bar = document.createElement('div');
    bar.className = 'vault-bar shelf-bar';
    bar.innerHTML = `
      <div class="vault-left">
        <strong>${icon('computer', 14)} Mon ordinateur</strong>
        <span id="shelf-status" class="vault-status">Aucun dossier connecté</span>
      </div>
      <div class="vault-actions">
        <button id="shelf-connect" class="gd-btn vault-primary">${icon('folder_open', 15)} Connecter un dossier</button>
        <button id="shelf-browse" class="gd-btn" disabled title="Parcourir les livres du dossier">${icon('grid_view', 15)} Parcourir</button>
        <button id="shelf-disconnect" class="gd-btn" disabled title="Déconnexion">✕</button>
      </div>
    `;
    slot.appendChild(bar);
    document.getElementById('shelf-connect').onclick = shelfConnect;
    document.getElementById('shelf-browse').onclick = shelfBrowse;
    document.getElementById('shelf-disconnect').onclick = shelfDisconnect;
    _renderShelfBar();
  };
  new MutationObserver(_doInject).observe(document.body, { childList: true, subtree: true });
  _doInject();
}

// --- Styles ---
const _shelfStyle = document.createElement('style');
_shelfStyle.textContent = `
.gd-btn { padding: 4px 10px; border: none; background: transparent; color: var(--text2); border-radius: var(--radius); font-family: inherit; font-size: 13px; cursor: pointer; height: 28px; transition: background .1s, color .1s; box-shadow: inset 0 0 0 1px var(--border); }
.gd-btn:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.gd-btn:disabled { opacity: .4; cursor: default; }
.shelf-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.shelf-toolbar strong { font-size: 14px; font-weight: 600; color: var(--text); }
.shelf-count { font-size: 12px; color: var(--text2); background: var(--bg2); padding: 2px 8px; border-radius: 999px; }
#shelf-search { flex: 1; min-width: 160px; padding: 4px 12px; border: none; border-radius: var(--radius); font-family: inherit; font-size: 13px; background: var(--bg2); color: var(--text); height: 28px; box-shadow: inset 0 0 0 1px var(--border); }
#shelf-search:focus { outline: none; box-shadow: inset 0 0 0 1px var(--accent); background: var(--bg); }
.shelf-group { margin-bottom: 14px; }
.shelf-group-title { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--text3); margin-bottom: 4px; padding: 0 4px; }
.shelf-file { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: var(--radius); transition: background .1s; }
.shelf-file:hover { background: var(--hover); }
.shelf-file-icon { color: var(--text3); display: inline-flex; }
.shelf-file-name { flex: 1; font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
document.head.appendChild(_shelfStyle);

// --- Init ---
window.addEventListener('load', async () => {
  _injectShelfBar();
  try {
    const h = await _loadShelfHandle();
    if (h) { _shelfHandle = h; _renderShelfBar(); if (window.renderHomeBooks) window.renderHomeBooks(); }
  } catch (e) { console.warn('shelf load', e); }
});

// Expose
window.shelfConnect = shelfConnect;
window.shelfBrowse = shelfBrowse;
window.shelfIsConnected = () => !!_shelfHandle;
window.shelfScan = shelfScan;
// Scan SANS demander de permission (pour afficher les PDF du dossier dans la
// bibliothèque sans popup) : renvoie null si l'accès n'est pas déjà accordé.
window.shelfScanIfGranted = async () => {
  if (!_shelfHandle) return null;
  try { if ((await _shelfHandle.queryPermission({ mode: 'read' })) !== 'granted') return null; }
  catch (_) { return null; }
  try { return await shelfScan(); } catch (_) { return null; }
};
window.shelfOpenEntry = async (entry) => {
  try {
    const file = await entry.handle.getFile();
    if (window.loadPdfFile) await window.loadPdfFile(file);
  } catch (e) {
    console.error('shelf open entry', e);
    if (window.showToast) window.showToast('Impossible d\'ouvrir le fichier : ' + e.message);
  }
};
