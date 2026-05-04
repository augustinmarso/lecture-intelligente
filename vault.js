// =============================================================
// vault.js — Second Cerveau : enregistrement direct dans le
// dossier Google Drive local (G:\Mon Drive\second cerveau\01 -Permanent)
// via File System Access API, format Obsidian (YAML frontmatter)
// =============================================================

const VAULT_DB = 'lecture-intelligente';
const VAULT_STORE_HANDLE_KEY = 'vault-handle';

let _vaultHandle = null;

// --- Persistance du handle (IndexedDB peut stocker les handles) ---
async function _vaultDb() {
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

async function _saveVaultHandle(handle) {
  const d = await _vaultDb();
  return new Promise((resolve, reject) => {
    const r = d.transaction('config', 'readwrite').objectStore('config').put(handle, VAULT_STORE_HANDLE_KEY);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

async function _loadVaultHandle() {
  const d = await _vaultDb();
  return new Promise((resolve, reject) => {
    const r = d.transaction('config').objectStore('config').get(VAULT_STORE_HANDLE_KEY);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

async function _clearVaultHandle() {
  const d = await _vaultDb();
  return new Promise((resolve, reject) => {
    const r = d.transaction('config', 'readwrite').objectStore('config').delete(VAULT_STORE_HANDLE_KEY);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// --- Permissions ---
async function _ensurePermission(handle, mode = 'readwrite') {
  if (!handle) return false;
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  if ((await handle.requestPermission({ mode })) === 'granted') return true;
  return false;
}

// --- API publique ---
async function vaultIsConnected() {
  if (_vaultHandle) return true;
  const h = await _loadVaultHandle();
  if (h) {
    _vaultHandle = h;
    return true;
  }
  return false;
}

async function vaultName() {
  if (!_vaultHandle) return null;
  return _vaultHandle.name;
}

async function vaultConnect() {
  if (!window.showDirectoryPicker) {
    if (window.showToast) window.showToast('Navigateur non compatible (utilise Chrome/Edge)');
    return false;
  }
  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      id: 'second-cerveau-permanent',
      startIn: 'documents'
    });
    _vaultHandle = handle;
    await _saveVaultHandle(handle);
    if (window.showToast) window.showToast(`✓ Vault connecté : ${handle.name}`);
    _renderVaultBar();
    return true;
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('vault connect error', e);
    return false;
  }
}

async function vaultDisconnect() {
  _vaultHandle = null;
  await _clearVaultHandle();
  if (window.showToast) window.showToast('Vault déconnecté');
  _renderVaultBar();
}

// --- Génération markdown Obsidian-compatible ---
function _slugify(s) {
  return (s || 'note')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function _yamlValue(v) {
  if (v == null) return '';
  const s = String(v).replace(/"/g, '\\"');
  return `"${s}"`;
}

function buildObsidianMarkdown(note) {
  const dateISO = new Date(note.createdAt || Date.now()).toISOString().slice(0, 10);
  const tags = (note.tags || []).map(t => t.replace(/\s+/g, '-')).filter(Boolean);
  const fm = [
    '---',
    `title: ${_yamlValue(note.title || '')}`,
    `date: ${dateISO}`,
    `type: ${note.type || 'note'}`,
    note.bookTitle ? `book: ${_yamlValue(note.bookTitle)}` : null,
    note.chapterTitle ? `chapter: ${_yamlValue(note.chapterTitle)}` : null,
    `tags: [${tags.map(t => t.includes(' ') ? `"${t}"` : t).join(', ')}]`,
    `source: lecture-intelligente`,
    '---',
    ''
  ].filter(Boolean).join('\n');

  const tagsLine = tags.length ? `\n${tags.map(t => `#${t}`).join(' ')}\n` : '';
  const body = note.markdown || '';
  return fm + body + tagsLine;
}

function _filenameForNote(note) {
  const dateISO = new Date(note.createdAt || Date.now()).toISOString().slice(0, 10);
  const slug = _slugify(note.title);
  return `${dateISO} ${note.title ? note.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 80) : slug}.md`;
}

async function vaultSaveNote(note) {
  if (!await vaultIsConnected()) {
    if (window.showToast) window.showToast('Vault non connecté — connecte le dossier');
    return false;
  }
  if (!await _ensurePermission(_vaultHandle, 'readwrite')) {
    if (window.showToast) window.showToast('Permission refusée pour le vault');
    return false;
  }
  try {
    const md = buildObsidianMarkdown(note);
    const filename = _filenameForNote(note);
    const fileHandle = await _vaultHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(md);
    await writable.close();
    if (window.showToast) window.showToast(`💾 Sauvée dans le vault : ${filename}`);
    return true;
  } catch (e) {
    console.error('vault save error', e);
    if (window.showToast) window.showToast('Erreur sauvegarde vault : ' + e.message);
    return false;
  }
}

async function vaultListNotes() {
  if (!await vaultIsConnected()) return [];
  if (!await _ensurePermission(_vaultHandle, 'read')) return [];
  const out = [];
  for await (const [name, h] of _vaultHandle.entries()) {
    if (h.kind === 'file' && name.toLowerCase().endsWith('.md')) {
      out.push({ name, handle: h });
    }
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

// --- UI ---
function _renderVaultBar() {
  const el = document.getElementById('vault-status');
  const btnConnect = document.getElementById('vault-connect');
  const btnDisconnect = document.getElementById('vault-disconnect');
  const btnSyncAll = document.getElementById('vault-sync-all');
  if (!el) return;
  if (_vaultHandle) {
    el.textContent = '✓ ' + _vaultHandle.name;
    el.classList.add('connected');
    if (btnConnect) btnConnect.style.display = 'none';
    if (btnDisconnect) btnDisconnect.disabled = false;
    if (btnSyncAll) btnSyncAll.disabled = false;
  } else {
    el.textContent = 'Aucun dossier connecté';
    el.classList.remove('connected');
    if (btnConnect) btnConnect.style.display = '';
    if (btnDisconnect) btnDisconnect.disabled = true;
    if (btnSyncAll) btnSyncAll.disabled = true;
  }
}

function _injectVaultBar() {
  const obs = new MutationObserver(() => {
    const modalContent = document.querySelector('#lib-modal .lib-content');
    if (!modalContent || modalContent.dataset.vaultWired) return;
    const gdBar = modalContent.querySelector('.gd-bar');
    const insertAfter = gdBar || modalContent.querySelector('.lib-header');
    if (!insertAfter) return;
    modalContent.dataset.vaultWired = '1';

    const bar = document.createElement('div');
    bar.className = 'vault-bar';
    bar.innerHTML = `
      <div class="vault-left">
        <strong>🧠 Second Cerveau</strong>
        <span id="vault-status" class="vault-status">Aucun dossier connecté</span>
      </div>
      <div class="vault-actions">
        <button id="vault-connect" class="gd-btn vault-primary">📁 Choisir dossier</button>
        <button id="vault-sync-all" class="gd-btn" disabled title="Exporter toutes mes fiches dans le dossier">↑ Tout sync</button>
        <button id="vault-disconnect" class="gd-btn" disabled title="Déconnexion">✕</button>
      </div>
    `;
    insertAfter.insertAdjacentElement('afterend', bar);
    document.getElementById('vault-connect').onclick = vaultConnect;
    document.getElementById('vault-disconnect').onclick = vaultDisconnect;
    document.getElementById('vault-sync-all').onclick = vaultSyncAllNotes;
    _renderVaultBar();
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

async function vaultSyncAllNotes() {
  if (typeof notesGetAll !== 'function') return;
  if (!await vaultIsConnected()) return;
  const all = await notesGetAll();
  if (window.showToast) window.showToast(`Sync de ${all.length} fiche(s)…`);
  let ok = 0;
  for (const n of all) {
    if (await vaultSaveNote(n)) ok++;
  }
  if (window.showToast) window.showToast(`✓ ${ok}/${all.length} fiches dans le vault`);
}

// --- Hook auto : sauvegarder dans le vault à chaque création de fiche ---
function _hookAutoSave() {
  // Wrap notesAdd
  const origAdd = window.notesAdd;
  if (typeof origAdd === 'function' && !origAdd.__vaultWrapped) {
    window.notesAdd = async function (note) {
      const id = await origAdd(note);
      try {
        if (await vaultIsConnected()) {
          const noteWithId = { ...note, id };
          await vaultSaveNote(noteWithId);
        }
      } catch (e) { console.warn('vault auto-save', e); }
      return id;
    };
    window.notesAdd.__vaultWrapped = true;
  }
  // Wrap notesUpdate (re-save quand tags changent)
  const origUpdate = window.notesUpdate;
  if (typeof origUpdate === 'function' && !origUpdate.__vaultWrapped) {
    window.notesUpdate = async function (id, patch) {
      const updated = await origUpdate(id, patch);
      try {
        if (updated && await vaultIsConnected()) {
          await vaultSaveNote(updated);
        }
      } catch (e) { console.warn('vault auto-update', e); }
      return updated;
    };
    window.notesUpdate.__vaultWrapped = true;
  }
}

// --- Styles ---
const _vaultStyle = document.createElement('style');
_vaultStyle.textContent = `
.vault-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 18px; border-bottom: 0.5px solid var(--border); background: var(--bg2); flex-wrap: wrap; }
.vault-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.vault-left strong { font-size: 13px; }
.vault-status { font-size: 12px; color: var(--text2); padding: 2px 8px; border-radius: 4px; background: var(--bg3); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vault-status.connected { color: #16a34a; background: rgba(22,163,74,.15); font-weight: 500; }
.vault-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.vault-primary { background: #7c3aed; color: #fff; border-color: #7c3aed; }
.vault-primary:hover:not(:disabled) { background: #6d28d9; }
@media (prefers-color-scheme: dark) {
  .vault-status.connected { color: #4ade80; background: rgba(74,222,128,.15); }
}
`;
document.head.appendChild(_vaultStyle);

// --- Init ---
window.addEventListener('load', async () => {
  _injectVaultBar();
  // Tente de restaurer le handle sauvegardé
  try {
    const h = await _loadVaultHandle();
    if (h) {
      _vaultHandle = h;
      _renderVaultBar();
    }
  } catch (e) { console.warn('vault load', e); }
  // Hook auto-save (différé pour laisser notes.js s'initialiser)
  setTimeout(_hookAutoSave, 500);
});

// Expose
window.vaultConnect = vaultConnect;
window.vaultIsConnected = vaultIsConnected;
window.vaultSaveNote = vaultSaveNote;
window.vaultSyncAllNotes = vaultSyncAllNotes;
