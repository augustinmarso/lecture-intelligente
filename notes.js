// =============================================================
// notes.js — Fiches de lecture permanentes (IndexedDB) + tags
// =============================================================

function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function notesAdd(note) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const r = d.transaction('notes', 'readwrite').objectStore('notes').add(note);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function notesUpdate(id, patch) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('notes', 'readwrite');
    const s = tx.objectStore('notes');
    const g = s.get(id);
    g.onsuccess = () => {
      const n = g.result;
      if (!n) { reject(new Error('Note introuvable')); return; }
      Object.assign(n, patch);
      const p = s.put(n);
      p.onsuccess = () => resolve(n);
      p.onerror = () => reject(p.error);
    };
    g.onerror = () => reject(g.error);
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
// Auto-suggestions de tags depuis le contenu de l'état
// =============================================================
function suggestTags(state) {
  const tags = new Set();
  // Type
  if (state.noteType === 'livre') tags.add('livre');
  else if (state.noteType === 'chapitre') tags.add('chapitre');
  // Année / mois
  const d = new Date();
  tags.add(String(d.getFullYear()));
  tags.add(d.toLocaleDateString('fr-FR', { month: 'long' }));
  // Mots-clés depuis l'objectif précis (top mots significatifs)
  const stop = new Set(('le la les de des du un une et ou à au aux avec pour par sur dans en sans est sont ce cette ces mon ma mes ton ta tes son sa ses notre votre leur leurs comment quoi quel quelle que qui où quand pourquoi je tu il elle nous vous ils elles me te se moi toi mais donc car ne pas plus moins très bien mal aussi alors ainsi puis si oui non aux du au la les un une de des'.split(' ')));
  const text = [state.ppu?.precis, state.ppu?.utile, state.lecture?.question, state.action?.conseil].filter(Boolean).join(' ').toLowerCase();
  const words = text.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 5 && !stop.has(w));
  const counts = {};
  words.forEach(w => counts[w] = (counts[w] || 0) + 1);
  Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, 5).forEach(([w]) => tags.add(w));
  return Array.from(tags);
}

// =============================================================
// Auto-save : observe l'apparition de .success-screen (écran done)
// =============================================================
let _currentNoteId = null;

async function autoSaveCurrentNote() {
  if (_currentNoteId) return _currentNoteId;
  const s = window.state;
  if (!s) return null;
  const md = window.generateMarkdown ? window.generateMarkdown() : '';
  const note = {
    title: s.bookTitle || s.chapterTitle || 'Fiche sans titre',
    type: s.noteType || 'libre',
    bookTitle: s.bookTitle || '',
    bookAuthor: s.bookAuthor || '',
    chapterTitle: s.chapterTitle || '',
    objectif: s.ppu?.precis || '',
    synthese: (s.synthese || []).filter(x => x && x.trim()),
    action: { ...(s.action || {}) },
    highlights: (s.highlights || []).slice(),
    tags: suggestTags(s),
    markdown: md,
    createdAt: Date.now()
  };
  _currentNoteId = await notesAdd(note);
  if (window.showToast) window.showToast('Fiche enregistrée ✓');
  return _currentNoteId;
}

// =============================================================
// Injection UI : section Tags + section "Mes fiches" sur l'écran done
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
        <h4>${icon('sell', 14)} Tags pour retrouver cette fiche</h4>
        <p class="tags-hint">Suggestions automatiques (cliquables pour activer/désactiver) ou ajoute les tiens.</p>
        <div class="tags-list" id="tags-list"></div>
        <div class="tags-input-row">
          <input id="tag-new" type="text" placeholder="Nouveau tag (Entrée pour ajouter)…"/>
          <button id="tag-add">+ Ajouter</button>
        </div>
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

      // Render tags as toggle chips
      const renderTags = () => {
        const list = document.getElementById('tags-list');
        const all = new Set([...(note.tags || []), ...suggestTags(window.state)]);
        list.innerHTML = Array.from(all).map(t => `<span class="tag-chip ${(note.tags||[]).includes(t)?'active':''}" data-tag="${_esc(t)}">${_esc(t)}<small class="tag-x">✕</small></span>`).join('');
        list.querySelectorAll('.tag-chip').forEach(chip => {
          chip.onclick = async (e) => {
            const tag = chip.dataset.tag;
            const tags = new Set(note.tags || []);
            if (e.target.classList.contains('tag-x')) {
              tags.delete(tag);
            } else {
              if (tags.has(tag)) tags.delete(tag); else tags.add(tag);
            }
            note.tags = Array.from(tags);
            await notesUpdate(note.id, { tags: note.tags });
            renderTags();
          };
        });
      };
      renderTags();

      const addTag = async () => {
        const inp = document.getElementById('tag-new');
        const v = (inp.value || '').trim().toLowerCase();
        if (!v) return;
        const tags = new Set(note.tags || []);
        v.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tags.add(t));
        note.tags = Array.from(tags);
        await notesUpdate(note.id, { tags: note.tags });
        inp.value = '';
        renderTags();
      };
      document.getElementById('tag-add').onclick = addTag;
      document.getElementById('tag-new').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addTag(); }
      });
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
// Modal "Mes fiches" + recherche/filtre par tag
// =============================================================
let _notesFilter = { text: '', tag: null };

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
  // Récupérer tous tags
  const allTags = {};
  all.forEach(n => (n.tags || []).forEach(t => allTags[t] = (allTags[t]||0)+1));
  const tagChips = Object.entries(allTags).sort((a,b) => b[1]-a[1]).map(([t,c]) =>
    `<span class="tag-chip ${_notesFilter.tag===t?'active':''}" data-filter-tag="${_esc(t)}">${_esc(t)} <small>${c}</small></span>`
  ).join('');

  // Filtrer
  let filtered = all;
  if (_notesFilter.tag) filtered = filtered.filter(n => (n.tags||[]).includes(_notesFilter.tag));
  if (_notesFilter.text) {
    const q = _notesFilter.text.toLowerCase();
    filtered = filtered.filter(n =>
      (n.title||'').toLowerCase().includes(q) ||
      (n.objectif||'').toLowerCase().includes(q) ||
      (n.synthese||[]).join(' ').toLowerCase().includes(q) ||
      (n.tags||[]).some(t => t.toLowerCase().includes(q))
    );
  }
  filtered.sort((a,b) => b.createdAt - a.createdAt);

  body.innerHTML = `
    <div class="notes-toolbar">
      <div class="notes-tabs">
        <button class="notes-tab active" data-view="notes">${icon('edit_note', 15)} Mes fiches (${all.length})</button>
        <button class="notes-tab" data-view="books">${icon('library_books', 15)} Mes livres</button>
      </div>
      <input id="notes-search" type="search" placeholder="Rechercher…" value="${_esc(_notesFilter.text)}"/>
    </div>
    ${tagChips ? `<div class="notes-tags-bar"><span class="tag-chip ${!_notesFilter.tag?'active':''}" data-filter-tag="">Tous</span>${tagChips}</div>` : ''}
    <div class="notes-list">
      ${filtered.length === 0 ? '<div class="lib-empty">Aucune fiche ne correspond.</div>' : filtered.map(n => `
        <div class="note-card" data-id="${n.id}">
          <div class="note-header">
            <strong>${_esc(n.title)}</strong>
            <small>${new Date(n.createdAt).toLocaleDateString('fr-FR', { day:'numeric', month:'short', year:'numeric' })} · ${n.type}</small>
          </div>
          ${n.objectif ? `<p class="note-objective">${icon('target', 14)} ${_esc(n.objectif)}</p>` : ''}
          ${n.synthese && n.synthese.length ? `<ul class="note-synth">${n.synthese.slice(0,3).map(s => `<li>${_esc(s)}</li>`).join('')}${n.synthese.length>3?'<li>…</li>':''}</ul>` : ''}
          <div class="note-tags">${(n.tags||[]).map(t => `<span class="tag-chip small">${_esc(t)}</span>`).join('')}</div>
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
  body.querySelectorAll('.notes-tab').forEach(t => t.onclick = () => {
    if (t.dataset.view === 'books' && typeof renderLibrary === 'function') renderLibrary();
  });
  const search = document.getElementById('notes-search');
  if (search) {
    search.oninput = () => { _notesFilter.text = search.value; renderNotesView(); };
  }
  body.querySelectorAll('[data-filter-tag]').forEach(el => {
    el.onclick = () => { _notesFilter.tag = el.dataset.filterTag || null; renderNotesView(); };
  });
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
        <div class="note-tags">${(n.tags||[]).map(t => `<span class="tag-chip small">${_esc(t)}</span>`).join('')}</div>
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
// Hook : ajouter onglet Fiches dans le rendu de la bibliothèque
// =============================================================
function _hookLibraryTabs() {
  // Attache un bouton "📝 Fiches" dans le header du modal
  const obs = new MutationObserver(() => {
    const headerActions = document.querySelector('#lib-modal .lib-header-actions');
    if (headerActions && !headerActions.dataset.notesBtnWired) {
      headerActions.dataset.notesBtnWired = '1';
      const btn = document.createElement('button');
      btn.className = 'lib-import';
      btn.innerHTML = icon('edit_note');
      btn.style.background = 'var(--bg2)';
      btn.style.color = 'var(--text)';
      btn.title = 'Mes fiches';
      btn.onclick = openNotes;
      const closeBtn = headerActions.querySelector('.lib-close');
      if (closeBtn) headerActions.insertBefore(btn, closeBtn);
      else headerActions.appendChild(btn);
    }

    // Onglet de retour vers livres si on est sur la vue Notes
    const notesList = document.querySelector('.notes-list');
    if (notesList) {
      notesList.dataset.tabsWired = '1';
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// =============================================================
// Styles
// =============================================================
const _notesStyle = document.createElement('style');
_notesStyle.textContent = `
.tags-section { background: var(--bg2); border-radius: var(--radius); padding: 14px 16px; text-align: left; margin-top: 1rem; box-shadow: inset 0 0 0 1px var(--border); }
.tags-section h4 { font-size: 14px; font-weight: 600; margin-bottom: 4px; color: var(--text); }
.tags-hint { font-size: 13px; color: var(--text2); margin-bottom: 10px; line-height: 1.5; }
.tags-list { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
.tag-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 3px; background: var(--bg3); color: var(--text); font-size: 13px; cursor: pointer; transition: background .1s; user-select: none; font-weight: 500; }
.tag-chip:hover { background: var(--hover-strong); }
.tag-chip.active { background: var(--accent); color: #fff; }
.tag-chip.small { padding: 1px 8px; font-size: 12px; cursor: default; }
.tag-chip small { font-size: 11px; opacity: .7; margin-left: 2px; }
.tag-x { padding-left: 4px; opacity: .55; }
.tag-chip.active .tag-x { opacity: 1; }
.tag-chip:hover .tag-x { opacity: 1; }
.tags-input-row { display: flex; gap: 6px; margin-bottom: 10px; }
.tags-input-row input { flex: 1; padding: 6px 10px; border: none; border-radius: var(--radius); font-family: inherit; font-size: 13px; background: var(--bg); color: var(--text); box-shadow: inset 0 0 0 1px var(--border); height: 28px; }
.tags-input-row input:focus { outline: none; box-shadow: inset 0 0 0 1px var(--accent); }
.tags-input-row button { padding: 4px 12px; background: var(--accent); color: #fff; border: none; border-radius: var(--radius); font-family: inherit; font-size: 13px; cursor: pointer; height: 28px; transition: background .1s; }
.tags-input-row button:hover { background: var(--accent-hover); }
.notes-actions { display: flex; gap: 6px; }
.notes-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.notes-tabs { display: flex; gap: 2px; }
.notes-tab { padding: 4px 12px; border: none; background: transparent; color: var(--text2); border-radius: var(--radius); font-family: inherit; font-size: 13px; cursor: pointer; height: 28px; transition: background .1s; }
.notes-tab:hover { background: var(--hover); color: var(--text); }
.notes-tab.active { background: var(--hover-strong); color: var(--text); font-weight: 500; }
#notes-search { padding: 4px 12px; border: none; border-radius: var(--radius); font-family: inherit; font-size: 13px; background: var(--bg2); color: var(--text); min-width: 200px; height: 28px; box-shadow: inset 0 0 0 1px var(--border); }
#notes-search:focus { outline: none; box-shadow: inset 0 0 0 1px var(--accent); background: var(--bg); }
.notes-tags-bar { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
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
.note-tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0; }
.note-actions { display: flex; gap: 2px; margin-top: 8px; }
.note-view-content { padding: 12px 0; }
.md-render { font-size: 14px; line-height: 1.65; white-space: pre-wrap; color: var(--text); padding: 14px 16px; background: var(--bg2); border-radius: var(--radius); margin-top: 12px; box-shadow: inset 0 0 0 1px var(--border); }
`;
document.head.appendChild(_notesStyle);

// =============================================================
// Init
// =============================================================
function _initNotes() {
  _injectNoteUI();
  _hookLibraryTabs();
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
