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

function _wikilink(s) {
  if (!s) return '';
  return `[[${String(s).replace(/[\[\]]/g, '').trim()}]]`;
}

function buildObsidianMarkdown(note) {
  const dateISO = new Date(note.createdAt || Date.now()).toISOString().slice(0, 10);
  const tags = (note.tags || []).map(t => t.replace(/\s+/g, '-')).filter(Boolean);

  // YAML frontmatter — strings simples (Obsidian le parse pour les propriétés)
  const fm = [
    '---',
    `title: ${_yamlValue(note.title || '')}`,
    `date: ${dateISO}`,
    `type: ${note.type || 'note'}`,
    note.bookTitle ? `book: "[[${note.bookTitle.replace(/[\[\]"]/g,'')}]]"` : null,
    note.bookAuthor ? `author: "[[${note.bookAuthor.replace(/[\[\]"]/g,'')}]]"` : null,
    note.chapterTitle ? `chapter: "[[${note.chapterTitle.replace(/[\[\]"]/g,'')}]]"` : null,
    `tags: [${tags.map(t => t.includes(' ') ? `"${t}"` : t).join(', ')}]`,
    `source: lecture-intelligente`,
    '---',
    ''
  ].filter(Boolean).join('\n');

  // Section liens (wikilinks Obsidian dans le body)
  const links = [];
  if (note.bookTitle) links.push(`- Livre : ${_wikilink(note.bookTitle)}`);
  if (note.bookAuthor) links.push(`- Auteur : ${_wikilink(note.bookAuthor)}`);
  if (note.chapterTitle) links.push(`- Chapitre : ${_wikilink(note.chapterTitle)}`);
  const linksSection = links.length ? `## Liens\n\n${links.join('\n')}\n\n` : '';

  // Tags en wikilinks ET en hashtags pour double indexation
  const tagsWiki = tags.length ? `\n## Tags\n\n${tags.map(_wikilink).join(' · ')}\n\n${tags.map(t => `#${t}`).join(' ')}\n` : '';

  const body = note.markdown || '';
  return fm + linksSection + body + tagsWiki;
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
    if (window.showToast) window.showToast(`Sauvée dans le vault : ${filename}`);
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

async function vaultReadNote(handle) {
  const file = await handle.getFile();
  return await file.text();
}

// Retire le frontmatter YAML et la ligne source, garde le corps lisible
function _stripFrontmatter(md) {
  return String(md || '').replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
}

function _escVault(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// =============================================================
// Suivi du dernier champ éditable de l'app (hors modal) :
// permet de « remplacer mes mots par mes notes » en réinjectant
// une note du Second Cerveau dans le champ où j'écrivais.
// =============================================================
let _lastEditable = null;
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') &&
      el.closest('#app') && !el.closest('#lib-modal')) {
    _lastEditable = el;
  }
});

function _setFieldValue(el, value) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Insère le texte d'une note : remplace le contenu du dernier champ actif
function vaultInsertIntoField(text, mode) {
  const el = _lastEditable && document.body.contains(_lastEditable) ? _lastEditable : null;
  if (!el) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    if (window.showToast) window.showToast('Note copiée — colle-la dans le champ voulu (aucun champ actif)');
    return false;
  }
  const base = el.value && mode === 'append' ? (el.value.replace(/\s*$/, '') + '\n\n') : '';
  _setFieldValue(el, base + text);
  const modal = document.getElementById('lib-modal');
  if (modal) modal.classList.remove('open');
  el.focus();
  if (window.showToast) window.showToast(mode === 'append' ? 'Note ajoutée à ton champ' : 'Champ remplacé par ta note');
  return true;
}

// --- Vue : liste des notes du Second Cerveau ---
async function vaultBrowse() {
  const body = document.getElementById('lib-body');
  if (!body) return;
  const modal = document.getElementById('lib-modal');
  if (modal) modal.classList.add('open');
  if (!await vaultIsConnected()) {
    body.innerHTML = `<div class="lib-empty">Second Cerveau non connecté.<br><br>Clique sur <strong>Choisir dossier</strong> dans la barre « Second Cerveau » pour lire tes notes ici.</div>`;
    return;
  }
  if (!await _ensurePermission(_vaultHandle, 'read')) {
    body.innerHTML = `<div class="lib-empty">Permission de lecture refusée pour le dossier.</div>`;
    return;
  }
  body.innerHTML = `<div class="lib-empty">Lecture du dossier « ${_escVault(_vaultHandle.name)} »…</div>`;
  const notes = await vaultListNotes();
  if (notes.length === 0) {
    body.innerHTML = `<div class="lib-empty">Aucune note (.md) dans ce dossier.</div>`;
    return;
  }
  body.innerHTML = `
    <div class="vault-view-toolbar">
      <strong>${icon('psychology', 15)} Second Cerveau — ${notes.length} note${notes.length > 1 ? 's' : ''}</strong>
      <input id="vault-search" type="search" placeholder="Rechercher une note…"/>
    </div>
    <div class="vault-note-list" id="vault-note-list">
      ${notes.map((n, i) => `
        <div class="vault-note-row" data-i="${i}">
          <span class="vault-note-icon">${icon('description', 16)}</span>
          <span class="vault-note-name">${_escVault(n.name.replace(/\.md$/i, ''))}</span>
          <button class="lib-action vault-open" data-i="${i}">${icon('visibility', 15)} Lire</button>
        </div>`).join('')}
    </div>
  `;
  const search = document.getElementById('vault-search');
  if (search) search.oninput = () => {
    const q = search.value.toLowerCase();
    document.querySelectorAll('.vault-note-row').forEach(row => {
      const name = row.querySelector('.vault-note-name').textContent.toLowerCase();
      row.style.display = name.includes(q) ? '' : 'none';
    });
  };
  body.querySelectorAll('.vault-open').forEach(btn => {
    btn.onclick = () => _vaultOpenNote(notes[parseInt(btn.dataset.i)]);
  });
}

async function _vaultOpenNote(entry) {
  const body = document.getElementById('lib-body');
  if (!body) return;
  body.innerHTML = `<div class="lib-empty">Ouverture…</div>`;
  let raw = '';
  try { raw = await vaultReadNote(entry.handle); }
  catch (e) { body.innerHTML = `<div class="lib-empty">Impossible de lire cette note : ${_escVault(e.message)}</div>`; return; }
  const clean = _stripFrontmatter(raw);
  const hasField = _lastEditable && document.body.contains(_lastEditable);
  body.innerHTML = `
    <div class="vault-reader">
      <div class="lib-reader-bar">
        <button id="vault-back">← Retour</button>
        <strong>${_escVault(entry.name.replace(/\.md$/i, ''))}</strong>
        <div style="display:flex;gap:6px">
          <button id="vault-insert-append" class="lib-action" title="Ajouter cette note à la fin du champ où j'écrivais">${icon('playlist_add', 15)} Ajouter au champ</button>
          <button id="vault-insert-replace" class="lib-action vault-insert-primary" title="Remplacer le champ où j'écrivais par cette note">${icon('swap_horiz', 15)} Remplacer mes mots</button>
        </div>
      </div>
      ${hasField ? '' : `<div class="vault-insert-hint">${icon('info', 14)} Astuce : ouvre la bibliothèque depuis un champ de saisie (objectif, synthèse…) pour pouvoir y insérer cette note.</div>`}
      <div class="vault-reader-content"><pre class="md-render">${_escVault(clean)}</pre></div>
    </div>
  `;
  document.getElementById('vault-back').onclick = vaultBrowse;
  document.getElementById('vault-insert-append').onclick = () => vaultInsertIntoField(clean, 'append');
  document.getElementById('vault-insert-replace').onclick = () => vaultInsertIntoField(clean, 'replace');
}

// --- UI ---
function _renderVaultBar() {
  const el = document.getElementById('vault-status');
  const btnConnect = document.getElementById('vault-connect');
  const btnDisconnect = document.getElementById('vault-disconnect');
  const btnSyncAll = document.getElementById('vault-sync-all');
  if (!el) return;
  const btnBrowse = document.getElementById('vault-browse');
  if (_vaultHandle) {
    el.textContent = '✓ ' + _vaultHandle.name;
    el.classList.add('connected');
    if (btnConnect) btnConnect.style.display = 'none';
    if (btnDisconnect) btnDisconnect.disabled = false;
    if (btnSyncAll) btnSyncAll.disabled = false;
    if (btnBrowse) btnBrowse.disabled = false;
  } else {
    el.textContent = 'Aucun dossier connecté';
    el.classList.remove('connected');
    if (btnConnect) btnConnect.style.display = '';
    if (btnDisconnect) btnDisconnect.disabled = true;
    if (btnSyncAll) btnSyncAll.disabled = true;
    if (btnBrowse) btnBrowse.disabled = true;
  }
}

function _injectVaultBar() {
  const _doInject = () => {
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
        <strong>${icon('psychology', 14)} Second Cerveau</strong>
        <span id="vault-status" class="vault-status">Aucun dossier connecté</span>
      </div>
      <div class="vault-actions">
        <button id="vault-connect" class="gd-btn vault-primary">${icon('folder_open', 15)} Choisir dossier</button>
        <button id="vault-browse" class="gd-btn" disabled title="Voir les notes du dossier">${icon('menu_book', 15)} Parcourir</button>
        <button id="vault-sync-all" class="gd-btn" disabled title="Exporter toutes mes fiches dans le dossier">↑ Tout sync</button>
        <button id="vault-disconnect" class="gd-btn" disabled title="Déconnexion">✕</button>
      </div>
    `;
    insertAfter.insertAdjacentElement('afterend', bar);
    document.getElementById('vault-connect').onclick = vaultConnect;
    document.getElementById('vault-disconnect').onclick = vaultDisconnect;
    document.getElementById('vault-sync-all').onclick = vaultSyncAllNotes;
    document.getElementById('vault-browse').onclick = vaultBrowse;
    _renderVaultBar();
  };
  new MutationObserver(_doInject).observe(document.body, { childList: true, subtree: true });
  _doInject();
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
.vault-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--bg2); flex-wrap: wrap; }
.vault-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.vault-left strong { font-size: 13px; font-weight: 600; color: var(--text); }
.vault-status { font-size: 12px; color: var(--text2); padding: 2px 8px; border-radius: 3px; background: var(--bg3); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.vault-status.connected { color: var(--success); background: rgba(15,123,108,0.12); }
.vault-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.vault-primary { background: var(--accent); color: #fff; }
.vault-primary:hover:not(:disabled) { background: var(--accent-hover); color: #fff; }
@media (prefers-color-scheme: dark) {
  .vault-status.connected { color: #5BC9B5; background: rgba(91,201,181,0.15); }
}
.vault-view-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.vault-view-toolbar strong { font-size: 14px; font-weight: 600; color: var(--text); }
#vault-search { flex: 1; min-width: 160px; padding: 4px 12px; border: none; border-radius: var(--radius); font-family: inherit; font-size: 13px; background: var(--bg2); color: var(--text); height: 28px; box-shadow: inset 0 0 0 1px var(--border); }
#vault-search:focus { outline: none; box-shadow: inset 0 0 0 1px var(--accent); background: var(--bg); }
.vault-note-list { display: flex; flex-direction: column; gap: 2px; }
.vault-note-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: var(--radius); transition: background .1s; }
.vault-note-row:hover { background: var(--hover); }
.vault-note-icon { color: var(--text3); display: inline-flex; }
.vault-note-name { flex: 1; font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vault-reader { display: flex; flex-direction: column; height: 100%; }
.vault-reader-content { flex: 1; overflow-y: auto; padding-right: 6px; }
.vault-insert-primary { background: var(--accent) !important; color: #fff !important; box-shadow: none !important; font-weight: 500; }
.vault-insert-primary:hover { background: var(--accent-hover) !important; }
.vault-insert-hint { font-size: 12px; color: var(--text2); background: var(--bg2); padding: 8px 12px; border-radius: var(--radius); margin-bottom: 12px; display: flex; align-items: center; gap: 6px; line-height: 1.4; }
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
window.vaultBrowse = vaultBrowse;
window.vaultListNotes = vaultListNotes;
window.vaultReadNote = vaultReadNote;
window.vaultInsertIntoField = vaultInsertIntoField;
window._getVaultHandle = () => _vaultHandle;
