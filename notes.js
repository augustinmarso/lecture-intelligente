// =============================================================
// notes.js — Fiches de lecture permanentes (IndexedDB)
// =============================================================

function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Barre d'onglets partagée entre « Mes fiches », « Mes mots » et « Cartes Anki ».
// opts.noBooks retire l'onglet « Mes livres » (ex : dans la vue Anki).
window.liTabs = function(active, opts) {
  opts = opts || {};
  const tab = (v, label, ic) => `<button class="notes-tab ${active === v ? 'active' : ''}" data-view="${v}">${icon(ic, 15)} ${label}</button>`;
  return `<div class="notes-tabs">
    ${tab('notes', 'Mes fiches', 'edit_note')}
    ${opts.noBooks ? '' : tab('books', 'Mes livres', 'library_books')}
    ${tab('words', 'Mes mots', 'menu_book')}
    ${tab('cards', 'Cartes Anki', 'style')}
    ${tab('settings', 'Paramètres', 'tune')}
  </div>`;
};
window.liWireTabs = function(container) {
  container.querySelectorAll('.notes-tab[data-view]').forEach(t => t.onclick = () => {
    const v = t.dataset.view;
    if (v === 'notes' && window.openNotes) window.openNotes();
    else if (v === 'books' && typeof renderLibrary === 'function') renderLibrary();
    else if (v === 'words' && window.openWords) window.openWords();
    else if (v === 'cards' && window.openAnkiCards) window.openAnkiCards();
    else if (v === 'settings' && window.renderSettingsView) window.renderSettingsView();
  });
};

// Onglet « Paramètres » : seul endroit où s'affichent les barres de connexion
// (Cloud, Anki, Assistant IA, Mon ordinateur, Second Cerveau). Chaque module
// injecte sa barre dans son emplacement dédié via son MutationObserver.
window.renderSettingsView = function() {
  const modal = document.getElementById('lib-modal');
  if (modal) modal.classList.add('open');
  const body = document.getElementById('lib-body');
  if (!body) return;
  body.innerHTML = `
    <div class="notes-toolbar">${window.liTabs('settings')}</div>
    <div class="li-settings">
      <p class="li-settings-intro">${icon('tune', 14)} Connexions &amp; synchronisation — tout ce qui suit ne s'affiche qu'ici.</p>
      <div id="li-set-anki" class="li-set-slot"></div>
      <div id="li-set-ai" class="li-set-slot"></div>
      <div id="li-set-shelf" class="li-set-slot"></div>
      <div id="li-set-vault" class="li-set-slot"></div>
    </div>`;
  window.liWireTabs(body);
};

async function notesAdd(note) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const r = d.transaction('notes', 'readwrite').objectStore('notes').add(note);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function notesGetAll() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const r = d.transaction('notes').objectStore('notes').getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}
async function notesGet(id) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const r = d.transaction('notes').objectStore('notes').get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function notesDelete(id) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const r = d.transaction('notes', 'readwrite').objectStore('notes').delete(id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// =============================================================
// Auto-save : observe l'apparition de .success-screen (écran done)
// =============================================================
let _currentNoteId = null;

async function autoSaveCurrentNote() {
  if (_currentNoteId) return _currentNoteId;
  const s = window.state;
  if (!s) return null;
  // Session restaurée après l'écran de fin : la fiche est peut-être déjà en
  // base (state._savedNoteId) — ne pas la dupliquer.
  if (s._savedNoteId) {
    try {
      const existing = await notesGet(s._savedNoteId);
      if (existing) { _currentNoteId = s._savedNoteId; return _currentNoteId; }
    } catch (_) {}
  }
  const md = window.generateMarkdown ? window.generateMarkdown() : '';
  const note = {
    title: s.bookTitle || s.chapterTitle || (s.sujet && s.sujet.sujet) || 'Fiche sans titre',
    type: s.noteType || 'libre',
    bookTitle: s.bookTitle || '',
    bookAuthor: s.bookAuthor || '',
    chapterTitle: s.chapterTitle || '',
    objectif: s.ppu?.precis || '',
    synthese: (s.synthese || []).filter(x => x && x.trim()),
    action: { ...(s.action || {}) },
    highlights: (s.highlights || []).slice(),
    tags: [],
    markdown: md,
    createdAt: Date.now()
  };
  _currentNoteId = await notesAdd(note);
  // Marquer la fiche comme écrite : restoreState peut alors purger la session
  // en toute sécurité (et un rechargement ne recréera pas de doublon).
  s._savedNoteId = _currentNoteId;
  if (window.persistState) window.persistState();
  if (window.showToast) window.showToast('Fiche enregistrée ✓');
  return _currentNoteId;
}

// =============================================================
// Injection UI : accès "Mes fiches" sur l'écran done
// =============================================================
function _injectNoteUI() {
  const obs = new MutationObserver(async () => {
    const success = document.querySelector('.success-screen');
    if (success && !success.dataset.notesWired) {
      success.dataset.notesWired = '1';
      await autoSaveCurrentNote();
      const note = _currentNoteId ? await notesGet(_currentNoteId) : null;
      if (!note) return;

      const section = document.createElement('div');
      section.className = 'tags-section';
      section.innerHTML = `
        <div class="notes-actions">
          <button id="open-notes" class="lib-action">${icon('folder_open', 15)} Voir toutes mes fiches</button>
        </div>
      `;
      // Insérer avant les boutons "Enregistrer sous"
      const recap = success.querySelector('.recap');
      const calSec = success.querySelector('.gcal-section');
      if (calSec) calSec.insertAdjacentElement('beforebegin', section);
      else if (recap) recap.insertAdjacentElement('afterend', section);
      else success.appendChild(section);

      document.getElementById('open-notes').onclick = openNotes;
    }

    // Reset _currentNoteId quand on quitte l'écran done
    if (!success && _currentNoteId) {
      _currentNoteId = null;
    }
  });
  obs.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
}

// =============================================================
// Modal "Mes fiches" + recherche
// =============================================================
let _notesFilter = { text: '' };

async function openNotes() {
  const modal = document.getElementById('lib-modal');
  if (!modal) return;
  modal.classList.add('open');
  // Toggle the body to show notes view
  await renderNotesView();
}

async function renderNotesView() {
  const body = document.getElementById('lib-body');
  if (!body) return;
  const all = await notesGetAll();
  // Filtrer
  let filtered = all;
  if (_notesFilter.text) {
    const q = _notesFilter.text.toLowerCase();
    filtered = filtered.filter(n =>
      (n.title||'').toLowerCase().includes(q) ||
      (n.objectif||'').toLowerCase().includes(q) ||
      (n.synthese||[]).join(' ').toLowerCase().includes(q)
    );
  }
  filtered.sort((a,b) => b.createdAt - a.createdAt);

  body.innerHTML = `
    <div class="notes-toolbar">
      ${window.liTabs('notes')}
      <input id="notes-search" type="search" placeholder="Rechercher…" value="${_esc(_notesFilter.text)}"/>
    </div>
    <div class="notes-list">
      ${filtered.length === 0 ? '<div class="lib-empty">Aucune fiche ne correspond.</div>' : filtered.map(n => `
        <div class="note-card" data-id="${n.id}"${n.fromAnki ? ' data-from-anki="1"' : ''}>
          <div class="note-header">
            <strong>${_esc(n.title)}</strong>
            <small>${new Date(n.createdAt).toLocaleDateString('fr-FR', { day:'numeric', month:'short', year:'numeric' })} · ${n.fromAnki ? 'depuis Anki' : n.type}</small>
          </div>
          ${n.objectif ? `<p class="note-objective">${icon('target', 14)} ${_esc(n.objectif)}</p>` : ''}
          ${n.synthese && n.synthese.length ? `<ul class="note-synth">${n.synthese.slice(0,3).map(s => `<li>${_esc(s)}</li>`).join('')}${n.synthese.length>3?'<li>…</li>':''}</ul>` : ''}
          <div class="note-actions">
            <button class="lib-action" data-act="view">${icon('visibility', 15)} Voir</button>
            <button class="lib-action" data-act="md">↓ .md</button>
            <button class="lib-action lib-del" data-act="delete">${icon('delete', 15)}</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Wire toolbar
  window.liWireTabs(body);
  const search = document.getElementById('notes-search');
  if (search) {
    search.oninput = () => { _notesFilter.text = search.value; renderNotesView(); };
  }
  body.querySelectorAll('.note-card .lib-action').forEach(btn => {
    btn.onclick = async () => {
      const id = parseInt(btn.closest('.note-card').dataset.id);
      const act = btn.dataset.act;
      if (act === 'delete') {
        if (!confirm('Supprimer cette fiche ?')) return;
        await notesDelete(id);
        await renderNotesView();
      } else if (act === 'view') {
        await viewNote(id);
      } else if (act === 'md') {
        const n = await notesGet(id);
        const blob = new Blob([n.markdown || ''], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (n.title || 'fiche').replace(/[^a-z0-9]+/gi,'-') + '.md';
        a.click();
      }
    };
  });
}

async function viewNote(id) {
  const n = await notesGet(id);
  if (!n) return;
  const body = document.getElementById('lib-body');
  body.innerHTML = `
    <div class="note-view">
      <div class="lib-reader-bar">
        <button id="note-back">← Retour</button>
        <strong>${_esc(n.title)}</strong>
        <button id="note-dl">↓ .md</button>
      </div>
      <div class="note-view-content">
        <pre class="md-render">${_esc(n.markdown || '')}</pre>
      </div>
    </div>
  `;
  document.getElementById('note-back').onclick = renderNotesView;
  document.getElementById('note-dl').onclick = () => {
    const blob = new Blob([n.markdown || ''], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (n.title || 'fiche').replace(/[^a-z0-9]+/gi,'-') + '.md';
    a.click();
  };
}

// =============================================================
// Ouvrir directement la fiche d'un livre (depuis l'accueil, etc.)
// =============================================================
// Titre normalisé pour rapprocher un livre de sa fiche
function noteNorm(t) {
  return (t || '').toLowerCase().replace(/\.(pdf|epub)$/i, '')
    .replace(/\s*\(\d+\)\s*$/, '').replace(/\s+/g, ' ').trim();
}

// Toutes les fiches écrites pour un titre de livre donné
function notesForBook(title, all) {
  const key = noteNorm(title);
  if (!key) return [];
  return (all || []).filter(n => noteNorm(n.bookTitle) === key || noteNorm(n.title) === key);
}

// Ouvre la fiche déjà écrite pour ce livre : une seule → lecture directe ;
// plusieurs → liste filtrée sur ce titre ; aucune → message.
async function openNoteForBook(title) {
  let all = [];
  try { all = await notesGetAll(); } catch (_) {}
  const matches = notesForBook(title, all).sort((a, b) => b.createdAt - a.createdAt);
  if (!matches.length) { if (window.showToast) window.showToast('Pas encore de fiche pour ce livre'); return; }
  const modal = document.getElementById('lib-modal');
  if (modal) modal.classList.add('open');
  if (matches.length === 1) { await viewNote(matches[0].id); return; }
  _notesFilter.text = title;
  await renderNotesView();
}

// (Bouton « Mes fiches » du header de modale supprimé : triple emploi avec
// l'onglet « Mes fiches » et le lien « Fiches » de la barre du haut.)

// =============================================================
// Styles
// =============================================================
const _notesStyle = document.createElement('style');
_notesStyle.textContent = `
.tags-section { background: var(--bg2); border-radius: var(--radius); padding: 14px 16px; text-align: left; margin-top: 1rem; box-shadow: inset 0 0 0 1px var(--border); }
.notes-actions { display: flex; gap: 6px; justify-content: center; }
.notes-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.notes-tabs { display: flex; gap: 2px; flex-wrap: wrap; }
.notes-tab { padding: 4px 12px; border: none; background: transparent; color: var(--text2); border-radius: var(--radius); font-family: inherit; font-size: 13px; cursor: pointer; height: 28px; transition: background .1s; }
.notes-tab:hover { background: var(--hover); color: var(--text); }
.notes-tab.active { background: var(--hover-strong); color: var(--text); font-weight: 500; }
#notes-search { padding: 4px 12px; border: none; border-radius: var(--radius); font-family: inherit; font-size: 13px; background: var(--bg2); color: var(--text); min-width: 200px; height: 28px; box-shadow: inset 0 0 0 1px var(--border); }
#notes-search:focus { outline: none; box-shadow: inset 0 0 0 1px var(--accent); background: var(--bg); }
.notes-list { display: flex; flex-direction: column; gap: 2px; }
.note-card { padding: 12px 14px; border-radius: var(--radius); transition: background .1s; cursor: default; }
.note-card:hover { background: var(--hover); }
.note-header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 4px; flex-wrap: wrap; }
.note-header strong { font-size: 15px; font-weight: 600; color: var(--text); }
.note-header small { font-size: 12px; color: var(--text3); }
.note-objective { font-size: 13px; color: var(--text2); margin-bottom: 6px; line-height: 1.5; }
.note-synth { list-style: none; padding: 0; margin: 6px 0; }
.note-synth li { font-size: 13px; color: var(--text2); padding-left: 14px; position: relative; line-height: 1.5; margin-bottom: 2px; }
.note-synth li::before { content: '·'; position: absolute; left: 4px; color: var(--text3); }
.note-actions { display: flex; gap: 2px; margin-top: 8px; }
.note-view-content { padding: 12px 0; }
.md-render { font-size: 14px; line-height: 1.65; white-space: pre-wrap; color: var(--text); padding: 14px 16px; background: var(--bg2); border-radius: var(--radius); margin-top: 12px; box-shadow: inset 0 0 0 1px var(--border); }
/* Onglet Paramètres : pile de barres de connexion, responsive */
.li-settings { display: flex; flex-direction: column; gap: 10px; }
.li-settings-intro { font-size: 12.5px; color: var(--text3); display: flex; align-items: center; gap: 6px; margin: 0 2px 4px; line-height: 1.4; }
.li-set-slot { }
.li-set-slot .vault-bar { border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg2); }
@media (max-width: 640px) {
  .li-settings-intro { display: none; }
  .li-set-slot .vault-bar { flex-direction: column; align-items: stretch; gap: 8px; }
  .li-set-slot .vault-actions { justify-content: flex-start; }
  .li-set-slot .vault-actions > * { flex: 1 1 auto; }
  /* Écrase les largeurs fixes des champs (specificité > .classe input#id) */
  .li-settings .ai-bar input#ai-key,
  .li-settings .anki-bar input#anki-deck,
  .li-settings .vault-actions input,
  .li-settings .vault-actions select { width: 100%; min-width: 0; box-sizing: border-box; }
  .li-set-slot .vault-status { max-width: none; }
}
`;
document.head.appendChild(_notesStyle);

// =============================================================
// Init
// =============================================================
function _initNotes() {
  _injectNoteUI();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initNotes);
} else {
  _initNotes();
}

// Expose
window.notesAdd = notesAdd;
window.notesGetAll = notesGetAll;
window.notesGet = notesGet;
window.openNotes = openNotes;
window.viewNote = viewNote;
window.noteNorm = noteNorm;
window.notesForBook = notesForBook;
window.openNoteForBook = openNoteForBook;
