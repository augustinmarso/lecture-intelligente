// =============================================================
// anki.js — Connexion à Anki via AnkiConnect (add-on 2055492159,
// API HTTP locale sur http://127.0.0.1:8765). Chaque fiche de
// lecture (objectif, idées de synthèse, action) devient des
// cartes de révision espacée. Cartes IA via ai.js si configuré.
// =============================================================

const ANKI_STORE_KEY = 'li-anki';
// auto: true — la répétition espacée repose entièrement sur Anki depuis la
// suppression des rappels Agenda : chaque fiche terminée part automatiquement
// (décochable sur l'écran de fin).
const ANKI_DEFAULTS = { url: 'http://127.0.0.1:8765', deck: 'Lecture Intelligente', auto: true, useAI: true };
const ANKI_MODEL = 'Lecture Intelligente';

function _ankiSettings() {
  try { return Object.assign({}, ANKI_DEFAULTS, JSON.parse(localStorage.getItem(ANKI_STORE_KEY) || '{}')); }
  catch (_) { return Object.assign({}, ANKI_DEFAULTS); }
}
function _ankiSave(patch) {
  localStorage.setItem(ANKI_STORE_KEY, JSON.stringify(Object.assign(_ankiSettings(), patch)));
}

function _escAnki(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _ankiHtml(s) { return _escAnki(s).replace(/\n/g, '<br>'); }
function _ankiSlug(s) {
  return (s || 'lecture').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'lecture';
}

// --- Appel AnkiConnect ---
async function ankiInvoke(action, params) {
  const s = _ankiSettings();
  const resp = await fetch(s.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params: params || {} })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function ankiIsAvailable() {
  try {
    const v = await ankiInvoke('version');
    return v >= 6;
  } catch (_) { return false; }
}
window.ankiIsAvailable = ankiIsAvailable;

// --- Deck + modèle de note ---
// Chaque livre/sujet a son propre sous-paquet : « Racine::Titre » (créé auto par Anki)
function _ankiDeckFor(label) {
  const s = _ankiSettings();
  const clean = (label || '').replace(/::/g, ':').trim();
  return clean ? `${s.deck}::${clean}` : s.deck;
}

async function _ankiEnsureDeckAndModel(deckName) {
  await ankiInvoke('createDeck', { deck: deckName || _ankiSettings().deck }); // no-op si le deck existe
  const models = await ankiInvoke('modelNames');
  if (!models.includes(ANKI_MODEL)) {
    await ankiInvoke('createModel', {
      modelName: ANKI_MODEL,
      inOrderFields: ['Recto', 'Verso', 'Source'],
      css: `.card { font-family: Georgia, serif; font-size: 19px; line-height: 1.5; color: #2A2520; background: #FBF8F2; text-align: left; padding: 24px; }
.recto { font-weight: 600; }
.source { margin-top: 18px; font-size: 13px; color: #9C8F78; font-style: italic; }
hr#answer { border: none; border-top: 1px solid #ECE2D2; margin: 16px 0; }`,
      cardTemplates: [{
        Name: 'Carte',
        Front: '<div class="recto">{{Recto}}</div><div class="source">{{Source}}</div>',
        Back: '<div class="recto">{{Recto}}</div><hr id="answer"><div>{{Verso}}</div><div class="source">{{Source}}</div>'
      }]
    });
  }
}

// --- Envoi de cartes ---
// subDeck (facultatif) : range les cartes dans « Racine::Livre::subDeck »
// (ex : Idées / Citations) pour séparer les types de cartes par livre.
async function _ankiAddCards(cards, sourceLabel, tagSlug, deckLabel, subDeck) {
  const deckName = _ankiDeckFor(deckLabel) + (subDeck ? '::' + subDeck : '');
  await _ankiEnsureDeckAndModel(deckName);
  const notes = cards.map(c => ({
    deckName,
    modelName: ANKI_MODEL,
    fields: { Recto: _ankiHtml(c.recto), Verso: _ankiHtml(c.verso), Source: _escAnki(sourceLabel || '') },
    tags: ['lecture-intelligente', tagSlug].filter(Boolean),
    options: { allowDuplicate: false, duplicateScope: 'deck' }
  }));
  const result = await ankiInvoke('addNotes', { notes });
  const added = result.filter(r => r !== null).length;
  const dups = result.length - added;
  return { added, dups };
}

// Carte unique rapide (utilisée par le panneau IA)
async function ankiQuickAdd(recto, verso, sourceLabel) {
  try {
    if (!await ankiIsAvailable()) { if (window.showToast) window.showToast('Anki injoignable — ouvre Anki avec AnkiConnect'); return false; }
    const { added, dups } = await _ankiAddCards([{ recto, verso }], sourceLabel, _ankiSlug(sourceLabel), sourceLabel);
    if (window.showToast) window.showToast(added ? 'Carte ajoutée dans Anki' : (dups ? 'Carte déjà présente dans Anki' : 'Carte non ajoutée'));
    return added > 0;
  } catch (e) {
    if (window.showToast) window.showToast('Erreur Anki : ' + e.message);
    return false;
  }
}
window.ankiQuickAdd = ankiQuickAdd;

// Carte pour une citation surlignée : recto « Que dit [source] sur [sujet] ? »,
// verso = la citation exacte (+ page). Silencieux si Anki est fermé.
// allowDuplicate: true car chaque passage surligné est une carte à part entière.
async function ankiAddCitation({ text, page, source, subject, deck }) {
  if (!text) return false;
  try {
    if (!await ankiIsAvailable()) return false;
    const src = (source || 'ce texte').trim();
    const recto = subject && subject.trim() ? `Que dit ${src} sur ${subject.trim()} ?` : `Que dit ${src} ?`;
    const verso = text.trim() + (page ? `\n\n(p. ${page})` : '');
    // Chaque livre a son dossier « Citations » : Racine::Livre::Citations
    const deckName = _ankiDeckFor(deck || source || 'Lecture') + '::Citations';
    await _ankiEnsureDeckAndModel(deckName);
    const note = {
      deckName,
      modelName: ANKI_MODEL,
      fields: {
        Recto: _ankiHtml(recto),
        Verso: _ankiHtml(verso),
        Source: _escAnki(src + (page ? ' · p.' + page : ''))
      },
      tags: ['lecture-intelligente', 'citation', _ankiSlug(deck || source)].filter(Boolean),
      options: { allowDuplicate: true }
    };
    const res = await ankiInvoke('addNotes', { notes: [note] });
    return Array.isArray(res) && res[0] != null;
  } catch (_) { return false; }
}
window.ankiAddCitation = ankiAddCitation;

// --- Cartes "modèle" construites depuis une fiche (sans IA) ---
function _noteVoc(note) {
  const book = note.bookTitle || note.title || 'ma lecture';
  const auteur = note.bookAuthor || `l'auteur de « ${book} »`;
  const sujet = (note.objectif || '').trim();
  return { chap: note.chapterTitle ? ' (' + note.chapterTitle + ')' : '', auteur, surQuoi: sujet ? ` sur ${sujet}` : '' };
}

// Une carte par idée de synthèse : recto « Que pense [l'auteur] sur [objectif] ? »
function _ideaCards(note) {
  const { chap, auteur, surQuoi } = _noteVoc(note);
  const cards = [];
  (note.synthese || []).forEach((idee, i) => {
    if (idee && idee.trim()) cards.push({ recto: `Que pense ${auteur}${surQuoi}${chap} ? — idée n°${i + 1} de ma synthèse`, verso: idee });
  });
  return cards;
}

// Une carte par passage surligné : verso = la citation exacte
function _citationCards(note) {
  const { auteur, surQuoi } = _noteVoc(note);
  const cards = [];
  (note.highlights || []).forEach(h => {
    if (h && h.text) cards.push({ recto: `Que dit ${auteur}${surQuoi} ? — p.${h.page}`, verso: h.text });
  });
  return cards;
}

function _templateCards(note) {
  return [..._ideaCards(note), ..._citationCards(note)];
}

// --- Export d'une fiche complète vers Anki ---
async function ankiExportNote(note, opts) {
  opts = opts || {};
  const s = _ankiSettings();
  const book = note.bookTitle || note.title || 'Lecture';
  const sourceLabel = book + (note.bookAuthor ? ' — ' + note.bookAuthor : '') + (note.chapterTitle ? ' · ' + note.chapterTitle : '');
  const tagSlug = _ankiSlug(book);

  if (!await ankiIsAvailable()) {
    if (!opts.silent) _ankiShowHelp();
    return null;
  }

  // Idées de synthèse : via l'IA si dispo (sans les citations — elles ont
  // leur propre dossier et leur verso doit rester le texte exact), sinon modèle
  let ideaCards = null;
  if (s.useAI && window.aiIsConfigured && window.aiIsConfigured() && window.aiGenerateCards) {
    try {
      if (window.showToast && !opts.silent) window.showToast('Génération des cartes par l\'IA…');
      ideaCards = await window.aiGenerateCards(Object.assign({}, note, { highlights: [] }));
    } catch (e) {
      console.warn('anki AI cards failed, fallback template', e);
    }
  }
  if (!ideaCards || ideaCards.length === 0) ideaCards = _ideaCards(note);
  const citeCards = _citationCards(note);
  if (ideaCards.length === 0 && citeCards.length === 0) {
    if (window.showToast && !opts.silent) window.showToast('Rien à exporter — la fiche est vide');
    return { added: 0, dups: 0 };
  }

  try {
    // Dossiers séparés par livre : Idées / Citations
    const res = { added: 0, dups: 0 };
    if (ideaCards.length) {
      const r = await _ankiAddCards(ideaCards, sourceLabel, tagSlug, book, 'Idées');
      res.added += r.added; res.dups += r.dups;
    }
    if (citeCards.length) {
      const r = await _ankiAddCards(citeCards, sourceLabel, tagSlug, book, 'Citations');
      res.added += r.added; res.dups += r.dups;
    }
    if (window.showToast && !opts.silent) {
      window.showToast(res.added ? `${res.added} carte${res.added > 1 ? 's' : ''} dans Anki` + (res.dups ? ` (${res.dups} déjà présente${res.dups > 1 ? 's' : ''})` : '') : 'Cartes déjà présentes dans Anki');
    }
    return res;
  } catch (e) {
    if (window.showToast && !opts.silent) window.showToast('Erreur Anki : ' + e.message);
    return null;
  }
}
window.ankiExportNote = ankiExportNote;

// --- Export .txt de secours (import manuel dans Anki) ---
function ankiDownloadTxt(note) {
  const cards = _templateCards(note);
  if (cards.length === 0) { if (window.showToast) window.showToast('Rien à exporter'); return; }
  const header = '#separator:tab\n#html:false\n#tags:lecture-intelligente ' + _ankiSlug(note.bookTitle || note.title) + '\n';
  const body = cards.map(c => c.recto.replace(/\t|\n/g, ' ') + '\t' + c.verso.replace(/\t/g, ' ').replace(/\n/g, '<br>')).join('\n');
  const blob = new Blob([header + body], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'anki-' + _ankiSlug(note.bookTitle || note.title) + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
  if (window.showToast) window.showToast('Fichier téléchargé — importe-le dans Anki (Fichier, Importer)');
}

// --- Aide à la configuration (AnkiConnect + CORS) ---
function _ankiShowHelp() {
  let help = document.getElementById('anki-help');
  if (!help) {
    help = document.createElement('div');
    help.id = 'anki-help';
    help.innerHTML = `
      <div class="ai-overlay"></div>
      <div class="ai-panel">
        <div class="ai-head">
          <h4>${icon('style', 16)} Connecter Anki</h4>
          <button class="ai-close" title="Fermer">✕</button>
        </div>
        <div class="ai-body anki-help-body">
          <p>Anki ne répond pas. Vérifie ces 3 points :</p>
          <ol>
            <li><strong>Anki est ouvert</strong> sur ton ordinateur (l'application de bureau).</li>
            <li><strong>L'add-on AnkiConnect est installé</strong> : dans Anki, <em>Outils, Extensions, Télécharger des extensions</em>, code <strong>2055492159</strong>, puis redémarre Anki.</li>
            <li><strong>Le site est autorisé</strong> : dans Anki, <em>Outils, Extensions, AnkiConnect, Configuration</em>, ajoute dans <code>webCorsOriginList</code> :
              <pre>"https://augustinmarso.github.io",\n"http://localhost:5200"</pre>
              puis redémarre Anki.</li>
          </ol>
          <p>En attendant, tu peux utiliser le bouton <strong>Export .txt</strong> et importer le fichier dans Anki manuellement.</p>
        </div>
      </div>`;
    document.body.appendChild(help);
    help.querySelector('.ai-close').onclick = () => help.classList.remove('open');
    help.querySelector('.ai-overlay').onclick = () => help.classList.remove('open');
    help.className = 'anki-help-modal';
  }
  help.classList.add('open');
}

// --- Section Anki sur l'écran de fin de session ---
function _injectDoneUI() {
  // Boutons Anki sur les fiches (elles vivent dans #lib-modal, hors de #app)
  new MutationObserver(_wireNoteCardButtons).observe(document.body, { childList: true, subtree: true });

  const obs = new MutationObserver(async () => {
    const success = document.querySelector('.success-screen');
    if (!success || success.dataset.ankiWired) return;
    success.dataset.ankiWired = '1';

    const s = _ankiSettings();
    const section = document.createElement('div');
    section.className = 'gcal-section anki-section';
    section.innerHTML = `
      <h4>${icon('style', 16)} Réviser avec Anki</h4>
      <p>Transforme cette fiche en cartes de révision espacée. Chaque livre a son propre paquet dans <strong>${_escAnki(s.deck)}</strong>.</p>
      <div class="gcal-row">
        <button id="anki-send" class="gcal-btn">${icon('send', 15)} Envoyer vers Anki</button>
        <button id="anki-txt" class="gcal-btn">${icon('download', 15)} Export .txt</button>
        <label class="anki-auto"><input type="checkbox" id="anki-auto" ${s.auto ? 'checked' : ''}/> Envoi automatique à chaque fiche</label>
      </div>
    `;
    const gcal = success.querySelector('.gcal-section');
    if (gcal) gcal.insertAdjacentElement('afterend', section);
    else success.appendChild(section);

    const currentNote = () => {
      const st = window.state;
      return {
        title: st.bookTitle || st.chapterTitle || 'Fiche',
        bookTitle: st.bookTitle, bookAuthor: st.bookAuthor, chapterTitle: st.chapterTitle,
        objectif: st.ppu && st.ppu.precis, synthese: (st.synthese || []).filter(x => x && x.trim()),
        action: st.action || {}, highlights: st.highlights || []
      };
    };
    document.getElementById('anki-send').onclick = () => ankiExportNote(currentNote());
    document.getElementById('anki-txt').onclick = () => ankiDownloadTxt(currentNote());
    document.getElementById('anki-auto').onchange = (e) => _ankiSave({ auto: e.target.checked });

    // Envoi automatique si activé et Anki joignable
    if (s.auto && await ankiIsAvailable()) {
      ankiExportNote(currentNote(), { silent: false });
    }
  });
  obs.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
}

// --- Bouton Anki sur chaque fiche dans "Mes fiches" ---
function _wireNoteCardButtons() {
  document.querySelectorAll('.note-card').forEach(card => {
    const actions = card.querySelector('.note-actions');
    if (!actions || actions.dataset.ankiBtn) return;
    actions.dataset.ankiBtn = '1';
    const btn = document.createElement('button');
    btn.className = 'lib-action';
    btn.innerHTML = icon('style', 15) + ' Anki';
    btn.title = 'Envoyer cette fiche vers Anki';
    btn.onclick = async () => {
      const id = parseInt(card.dataset.id);
      if (!window.notesGet) return;
      const note = await window.notesGet(id);
      if (note) await ankiExportNote(note);
    };
    actions.insertBefore(btn, actions.querySelector('.lib-del'));
  });
}

// =============================================================
// Navigateur de cartes : voir, modifier et supprimer les cartes
// déjà créées, directement dans l'app (via AnkiConnect)
// =============================================================
let _ankiCardsFilter = '';

// HTML d'un champ Anki → texte brut éditable (les <br> redeviennent des retours ligne)
function _ankiPlain(html) {
  return (html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
}

async function openAnkiCards() {
  const modal = document.getElementById('lib-modal');
  if (modal) modal.classList.add('open');
  if (!await ankiIsAvailable()) { _ankiShowHelp(); return; }
  await renderAnkiCardsView();
}

// Cartes du deck racine, groupées par sous-paquet (deck exact, sans doublon parent/enfant)
async function _ankiFetchGroups() {
  const s = _ankiSettings();
  const decks = (await ankiInvoke('deckNames'))
    .filter(d => d === s.deck || d.startsWith(s.deck + '::')).sort();
  const groups = [];
  for (const deck of decks) {
    const safe = deck.replace(/"/g, '');
    const ids = await ankiInvoke('findNotes', { query: `deck:"${safe}" -deck:"${safe}::*"` });
    if (!ids.length) continue;
    const infos = await ankiInvoke('notesInfo', { notes: ids.slice(0, 200) });
    groups.push({ deck, total: ids.length, notes: infos });
  }
  return groups;
}

async function renderAnkiCardsView() {
  const body = document.getElementById('lib-body');
  if (!body) return;
  body.innerHTML = `<div class="lib-empty">Chargement des cartes depuis Anki…</div>`;
  let groups;
  try { groups = await _ankiFetchGroups(); }
  catch (e) { body.innerHTML = `<div class="lib-empty">Erreur Anki : ${_escAnki(e.message)}</div>`; return; }

  const s = _ankiSettings();
  const q = _ankiCardsFilter.toLowerCase();
  const match = (n) => !q || _ankiPlain(n.fields.Recto.value).toLowerCase().includes(q) || _ankiPlain(n.fields.Verso.value).toLowerCase().includes(q);
  const totalCartes = groups.reduce((t, g) => t + g.total, 0);

  body.innerHTML = `
    <div class="notes-toolbar">
      <div class="notes-tabs">
        <button class="notes-tab" data-view="notes">${icon('edit_note', 15)} Mes fiches</button>
        <button class="notes-tab" data-view="books">${icon('library_books', 15)} Mes livres</button>
        <button class="notes-tab active">${icon('style', 15)} Cartes Anki (${totalCartes})</button>
      </div>
      <input id="anki-cards-search" type="search" placeholder="Rechercher une carte…" value="${_escAnki(_ankiCardsFilter)}"/>
    </div>
    ${groups.length === 0 ? `<div class="lib-empty">Aucune carte dans « ${_escAnki(s.deck)} » pour l'instant.</div>` : groups.map(g => {
      const visibles = g.notes.filter(match);
      if (!visibles.length) return '';
      const sous = g.deck.includes('::') ? g.deck.split('::').slice(1).join('::') : g.deck;
      return `<div class="anki-deck-group">
        <h4 class="anki-deck-title">${icon('folder', 14)} ${_escAnki(sous)} <span class="dw-count">${g.total}</span></h4>
        ${visibles.map(n => `
          <div class="anki-card" data-id="${n.noteId}">
            <div class="anki-card-view">
              <div class="anki-card-recto">${_escAnki(_ankiPlain(n.fields.Recto.value))}</div>
              <div class="anki-card-verso">${_escAnki(_ankiPlain(n.fields.Verso.value)).replace(/\n/g, '<br>')}</div>
              ${n.fields.Source && n.fields.Source.value ? `<div class="anki-card-src">${_escAnki(_ankiPlain(n.fields.Source.value))}</div>` : ''}
              <div class="note-actions">
                <button class="lib-action" data-act="edit">${icon('edit', 15)} Modifier</button>
                <button class="lib-action lib-del" data-act="del">${icon('delete', 15)}</button>
              </div>
            </div>
          </div>`).join('')}
      </div>`;
    }).join('')}
  `;

  // Navigation vers les autres vues
  body.querySelectorAll('.notes-tab[data-view]').forEach(t => t.onclick = () => {
    if (t.dataset.view === 'notes' && window.openNotes) window.openNotes();
    else if (t.dataset.view === 'books' && typeof renderLibrary === 'function') renderLibrary();
  });
  const search = document.getElementById('anki-cards-search');
  if (search) search.oninput = () => { _ankiCardsFilter = search.value; clearTimeout(search._t); search._t = setTimeout(renderAnkiCardsView, 350); };

  // Modifier / supprimer
  body.querySelectorAll('.anki-card [data-act]').forEach(btn => {
    btn.onclick = async () => {
      const card = btn.closest('.anki-card');
      const id = parseInt(card.dataset.id);
      if (btn.dataset.act === 'del') {
        if (!confirm('Supprimer cette carte d\'Anki ?')) return;
        try { await ankiInvoke('deleteNotes', { notes: [id] }); card.remove(); if (window.showToast) window.showToast('Carte supprimée'); }
        catch (e) { if (window.showToast) window.showToast('Erreur : ' + e.message); }
      } else if (btn.dataset.act === 'edit') {
        _ankiEditCard(card, id);
      }
    };
  });
}

// Bascule une carte en mode édition (recto + verso), sauvegarde via updateNoteFields
async function _ankiEditCard(cardEl, noteId) {
  const info = (await ankiInvoke('notesInfo', { notes: [noteId] }))[0];
  if (!info) return;
  const recto = _ankiPlain(info.fields.Recto.value);
  const verso = _ankiPlain(info.fields.Verso.value);
  cardEl.innerHTML = `
    <div class="anki-card-edit">
      <label>Recto (question)</label>
      <textarea class="anki-edit-recto" rows="2">${_escAnki(recto)}</textarea>
      <label>Verso (réponse)</label>
      <textarea class="anki-edit-verso" rows="4">${_escAnki(verso)}</textarea>
      <div class="note-actions">
        <button class="lib-action anki-edit-save">${icon('check', 15)} Enregistrer</button>
        <button class="lib-action anki-edit-cancel">Annuler</button>
      </div>
    </div>`;
  cardEl.querySelector('.anki-edit-cancel').onclick = renderAnkiCardsView;
  cardEl.querySelector('.anki-edit-save').onclick = async () => {
    const r = cardEl.querySelector('.anki-edit-recto').value.trim();
    const v = cardEl.querySelector('.anki-edit-verso').value.trim();
    if (!r || !v) { if (window.showToast) window.showToast('Recto et verso ne peuvent pas être vides'); return; }
    try {
      await ankiInvoke('updateNoteFields', { note: { id: noteId, fields: { Recto: _ankiHtml(r), Verso: _ankiHtml(v) } } });
      if (window.showToast) window.showToast('Carte modifiée dans Anki');
      await renderAnkiCardsView();
    } catch (e) { if (window.showToast) window.showToast('Erreur : ' + e.message); }
  };
}
window.openAnkiCards = openAnkiCards;

// --- Bouton « Mes cartes Anki » dans la barre du haut (accès direct) ---
function _injectAnkiTopButton() {
  const _do = () => {
    document.querySelectorAll('.top-bar').forEach(bar => {
      if (bar.dataset.ankiBtn) return;
      bar.dataset.ankiBtn = '1';
      const btn = document.createElement('button');
      btn.className = 'btn-pdf-toggle';
      btn.title = 'Mes cartes Anki';
      btn.innerHTML = icon('style');
      btn.onclick = openAnkiCards;
      const pdfBtn = bar.querySelector('#btn-pdf-toggle');
      if (pdfBtn) bar.insertBefore(btn, pdfBtn);
      else bar.appendChild(btn);
    });
  };
  new MutationObserver(_do).observe(document.body, { childList: true, subtree: true });
  _do();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _injectAnkiTopButton);
else _injectAnkiTopButton();

// --- Barre Anki dans le modal bibliothèque ---
function _renderAnkiBar() {
  const status = document.getElementById('anki-status');
  if (!status) return;
  status.textContent = 'Vérification…';
  status.classList.remove('connected');
  status.style.cursor = 'pointer';
  status.title = 'Cliquer pour retester la connexion à Anki';
  status.onclick = _renderAnkiBar; // reconnexion à la demande
  ankiIsAvailable().then(ok => {
    status.textContent = ok ? 'Anki connecté' : 'Anki injoignable — cliquer pour réessayer';
    status.classList.toggle('connected', ok);
  });
}
window._renderAnkiBar = _renderAnkiBar;

function _injectAnkiBar() {
  const _doInject = () => {
    const modalContent = document.querySelector('#lib-modal .lib-content');
    if (!modalContent || modalContent.dataset.ankiWired) return;
    const header = modalContent.querySelector('.lib-header');
    if (!header) return;
    modalContent.dataset.ankiWired = '1';

    const s = _ankiSettings();
    const bar = document.createElement('div');
    bar.className = 'vault-bar anki-bar';
    bar.innerHTML = `
      <div class="vault-left">
        <strong>${icon('style', 14)} Anki</strong>
        <span id="anki-status" class="vault-status">Vérification…</span>
      </div>
      <div class="vault-actions">
        <input id="anki-deck" type="text" title="Nom du deck Anki" value="${_escAnki(s.deck)}"/>
        <label class="anki-useai" title="Générer les questions/réponses avec l'IA (sinon cartes simples)"><input type="checkbox" id="anki-useai" ${s.useAI ? 'checked' : ''}/> Cartes IA</label>
        <button id="anki-view-cards" class="gd-btn" title="Voir et modifier les cartes déjà créées">${icon('visibility', 15)} Voir les cartes</button>
        <button id="anki-sync-all" class="gd-btn" title="Envoyer toutes mes fiches vers Anki">${icon('sync', 15)} Tout envoyer</button>
        <button id="anki-help-btn" class="gd-btn" title="Aide à la connexion">?</button>
      </div>
    `;
    header.insertAdjacentElement('afterend', bar);
    document.getElementById('anki-deck').onchange = (e) => { _ankiSave({ deck: e.target.value.trim() || ANKI_DEFAULTS.deck }); };
    document.getElementById('anki-useai').onchange = (e) => _ankiSave({ useAI: e.target.checked });
    document.getElementById('anki-help-btn').onclick = _ankiShowHelp;
    document.getElementById('anki-view-cards').onclick = openAnkiCards;
    document.getElementById('anki-sync-all').onclick = async () => {
      if (typeof window.notesGetAll !== 'function') return;
      if (!await ankiIsAvailable()) { _ankiShowHelp(); return; }
      const all = await window.notesGetAll();
      if (all.length === 0) { if (window.showToast) window.showToast('Aucune fiche à envoyer'); return; }
      if (window.showToast) window.showToast(`Envoi de ${all.length} fiche${all.length > 1 ? 's' : ''}…`);
      let total = 0;
      for (const n of all) {
        const res = await ankiExportNote(n, { silent: true });
        if (res) total += res.added;
      }
      if (window.showToast) window.showToast(`Terminé : ${total} nouvelle${total > 1 ? 's' : ''} carte${total > 1 ? 's' : ''} dans Anki`);
      _renderAnkiBar();
    };
    _renderAnkiBar();
  };
  new MutationObserver(_doInject).observe(document.body, { childList: true, subtree: true });
  _doInject();
}

// --- Styles ---
const _ankiStyle = document.createElement('style');
_ankiStyle.textContent = `
.anki-deck-group { margin-bottom: 18px; }
.anki-deck-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--text2); margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
.anki-card { padding: 12px 14px; border-radius: var(--radius); transition: background .1s; }
.anki-card:hover { background: var(--hover); }
.anki-card-recto { font-size: 14px; font-weight: 600; color: var(--text); line-height: 1.5; }
.anki-card-verso { font-size: 13px; color: var(--text2); line-height: 1.55; margin-top: 4px; }
.anki-card-src { font-size: 11.5px; color: var(--text3); font-style: italic; margin-top: 4px; }
.anki-card .note-actions { opacity: 0; transition: opacity .1s; }
.anki-card:hover .note-actions { opacity: 1; }
.anki-card-edit label { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--text3); margin: 8px 0 4px; }
.anki-card-edit textarea { width: 100%; padding: 8px 10px; border: none; border-radius: var(--radius); font-family: inherit; font-size: 13px; line-height: 1.5; background: var(--bg2); color: var(--text); box-shadow: inset 0 0 0 1px var(--border); resize: vertical; }
.anki-card-edit textarea:focus { outline: none; box-shadow: inset 0 0 0 1px var(--accent); background: var(--bg); }
#anki-cards-search { padding: 4px 12px; border: none; border-radius: var(--radius); font-family: inherit; font-size: 13px; background: var(--bg2); color: var(--text); min-width: 200px; height: 28px; box-shadow: inset 0 0 0 1px var(--border); }
#anki-cards-search:focus { outline: none; box-shadow: inset 0 0 0 1px var(--accent); background: var(--bg); }
.anki-bar input#anki-deck { width: 150px; padding: 4px 10px; border: none; border-radius: var(--radius); font-family: inherit; font-size: 12px; background: var(--bg); color: var(--text); box-shadow: inset 0 0 0 1px var(--border); height: 28px; }
.anki-bar input#anki-deck:focus { outline: none; box-shadow: inset 0 0 0 1px var(--accent); }
.anki-useai, .anki-auto { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text2); cursor: pointer; user-select: none; }
.anki-useai input, .anki-auto input { accent-color: var(--accent); cursor: pointer; }
.anki-section .gcal-row { align-items: center; }
.anki-help-modal { position: fixed; inset: 0; z-index: 650; display: none; }
.anki-help-modal.open { display: block; }
.anki-help-body { font-size: 14px; line-height: 1.6; color: var(--text); }
.anki-help-body ol { padding-left: 20px; margin: 10px 0; display: flex; flex-direction: column; gap: 8px; }
.anki-help-body pre { background: var(--bg2); padding: 8px 12px; border-radius: var(--radius); font-size: 12px; margin: 6px 0; white-space: pre-wrap; box-shadow: inset 0 0 0 1px var(--border); }
.anki-help-body code { background: var(--bg2); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.anki-help-body p { margin-bottom: 8px; }
`;
document.head.appendChild(_ankiStyle);

// --- Init ---
window.addEventListener('load', () => {
  _injectAnkiBar();
  _injectDoneUI();
});
