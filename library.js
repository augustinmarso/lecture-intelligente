// =============================================================
// library.js — Bibliothèque locale + conversion PDF→Texte/EPUB
// =============================================================

const DB_NAME = 'lecture-intelligente';
const DB_VERSION = 2;
let _db = null;

function escHtmlLib(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('books')) {
        const s = d.createObjectStore('books', { keyPath: 'id', autoIncrement: true });
        s.createIndex('addedAt', 'addedAt');
      }
      if (!d.objectStoreNames.contains('notes')) {
        const n = d.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
        n.createIndex('createdAt', 'createdAt');
        n.createIndex('tags', 'tags', { multiEntry: true });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

// Titre normalisé pour comparer deux livres (minuscules, sans extension,
// sans « (1) » de retéléchargement, espaces réduits)
function _libNorm(t) {
  return (t || '').toLowerCase().replace(/\.(pdf|epub)$/i, '')
    .replace(/\s*\(\d+\)\s*$/, '').replace(/\s+/g, ' ').trim();
}

// Un seul exemplaire par titre : garde le plus récemment consulté
function libDedupe(books) {
  const byTitle = new Map();
  for (const b of books) {
    const key = _libNorm(b.title || b.name);
    const prev = byTitle.get(key);
    if (!prev || (b.lastViewedAt || b.addedAt || 0) > (prev.lastViewedAt || prev.addedAt || 0)) byTitle.set(key, b);
  }
  return [...byTitle.values()];
}
window.libDedupe = libDedupe;

async function libAdd(book) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('books', 'readwrite');
    const r = tx.objectStore('books').add(book);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function libGetAll() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const r = d.transaction('books').objectStore('books').getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}
async function libGet(id) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const r = d.transaction('books').objectStore('books').get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function libDelete(id) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const r = d.transaction('books', 'readwrite').objectStore('books').delete(id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// Met à jour la dernière page lue (appelé automatiquement par renderPage)
let _lastPosSaveTime = 0;
async function libSetLastPosition(id, page, totalPages) {
  if (!id) return;
  // Throttle : pas plus d'un save toutes les 500ms
  const now = Date.now();
  if (now - _lastPosSaveTime < 500) return;
  _lastPosSaveTime = now;
  try {
    const d = await openDB();
    const tx = d.transaction('books', 'readwrite');
    const s = tx.objectStore('books');
    const g = s.get(id);
    g.onsuccess = () => {
      const b = g.result;
      if (!b) return;
      b.lastPage = page;
      if (totalPages) b.totalPages = totalPages;
      b.lastViewedAt = Date.now();
      s.put(b);
    };
  } catch (_) {}
}
window.libSetLastPosition = libSetLastPosition;

// =============================================================
// Hook : auto-save sur ouverture PDF
// =============================================================
const _origLoadPdfFile = window.loadPdfFile;
if (_origLoadPdfFile) {
  window.loadPdfFile = async function(file) {
    await _origLoadPdfFile(file);
    try {
      const buf = await file.arrayBuffer();
      const existing = await libGetAll();
      const titleGuess = (window.state && window.state.bookTitle) || file.name.replace(/\.pdf$/i, '');
      // Déjà connu si même fichier OU même titre (ex : « livre (1).pdf » retéléchargé)
      const dup = existing.find(b => (b.name === file.name && b.size === file.size)
        || _libNorm(b.title || b.name) === _libNorm(titleGuess));
      if (dup) {
        // Livre déjà connu : enregistrer l'ID pour le tracking de position
        if (window.pdf) window.pdf.bookId = dup.id;
      } else {
        const newId = await libAdd({
          title: (window.state && window.state.bookTitle) || file.name.replace(/\.pdf$/i,''),
          name: file.name,
          size: file.size,
          mime: 'application/pdf',
          data: buf,
          addedAt: Date.now(),
          lastPage: 1,
          lastViewedAt: Date.now()
        });
        if (window.pdf) window.pdf.bookId = newId;
        if (window.showToast) window.showToast('Ajouté à la bibliothèque');
      }
    } catch (e) { console.warn('lib save failed', e); }
  };
}

// =============================================================
// UI : Modal Bibliothèque
// =============================================================
function injectLibraryUI() {
  const modal = document.createElement('div');
  modal.id = 'lib-modal';
  modal.innerHTML = `
    <div class="lib-overlay"></div>
    <div class="lib-content">
      <div class="lib-header">
        <h3>${icon('library_books', 15)} Ma bibliothèque</h3>
        <div class="lib-header-actions">
          <button class="lib-import" title="Importer un PDF">+ Importer</button>
          <button class="lib-close">✕</button>
        </div>
      </div>
      <div class="lib-body" id="lib-body"></div>
      <input id="lib-import-file" type="file" accept="application/pdf" style="display:none" multiple/>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.lib-close').onclick = () => modal.classList.remove('open');
  modal.querySelector('.lib-overlay').onclick = () => modal.classList.remove('open');
  modal.querySelector('.lib-import').onclick = () => modal.querySelector('#lib-import-file').click();
  modal.querySelector('#lib-import-file').onchange = async (e) => {
    for (const f of e.target.files) { if (window.loadPdfFile) await window.loadPdfFile(f); }
    e.target.value = '';
    await renderLibrary();
  };

  // Bouton dans le top-bar (réinjecté à chaque rendu)
  const _injectBtns = () => {
    document.querySelectorAll('.top-bar').forEach(bar => {
      if (bar.dataset.libBtn) return;
      bar.dataset.libBtn = '1';
      const btn = document.createElement('button');
      btn.className = 'btn-pdf-toggle';
      btn.title = 'Bibliothèque';
      btn.innerHTML = icon('library_books');
      btn.style.marginRight = '6px';
      btn.onclick = openLibrary;
      const pdfBtn = bar.querySelector('#btn-pdf-toggle');
      if (pdfBtn) bar.insertBefore(btn, pdfBtn);
      else bar.appendChild(btn);
    });
  };
  const observer = new MutationObserver(_injectBtns);
  const appEl = document.getElementById('app');
  if (appEl) observer.observe(appEl, { childList: true, subtree: true });
  _injectBtns(); // Traiter les top-bars déjà présents
}

async function openLibrary() {
  document.getElementById('lib-modal').classList.add('open');
  await renderLibrary();
}

async function renderLibrary() {
  const body = document.getElementById('lib-body');
  const books = await libGetAll();
  if (books.length === 0) {
    body.innerHTML = `<div class="lib-empty">Aucun livre.<br><br>Ouvre un PDF, il sera automatiquement sauvegardé ici.<br>Ou clique sur <strong>+ Importer</strong> en haut à droite.</div>`;
    return;
  }
  // Tri : derniers consultés / récents en premier
  books.sort((a, b) => (b.lastViewedAt || b.addedAt) - (a.lastViewedAt || a.addedAt));
  body.innerHTML = books.map(b => {
    const progress = (b.lastPage && b.totalPages) ? Math.round((b.lastPage / b.totalPages) * 100) : 0;
    const hasProgress = b.lastPage && b.lastPage > 1;
    return `
    <div class="lib-book" data-id="${b.id}">
      <div class="lib-book-info">
        <strong>${escHtmlLib(b.title)}</strong>
        <small>${(b.size/1024/1024).toFixed(1)} Mo · Ajouté ${new Date(b.addedAt).toLocaleDateString('fr-FR')}${b.lastViewedAt && b.lastViewedAt !== b.addedAt ? ` · Vu ${new Date(b.lastViewedAt).toLocaleDateString('fr-FR')}` : ''}</small>
        ${hasProgress ? `
          <div class="lib-progress" title="${b.lastPage}/${b.totalPages || '?'} (${progress}%)">
            <div class="lib-progress-bar"><div class="lib-progress-fill" style="width:${progress}%"></div></div>
            <span class="lib-progress-text">page ${b.lastPage}${b.totalPages ? '/' + b.totalPages : ''} · ${progress}%</span>
          </div>
        ` : ''}
      </div>
      <div class="lib-book-actions">
        ${hasProgress ? `<button class="lib-action lib-resume" data-act="resume" title="Reprendre à la page ${b.lastPage}">${icon('play_arrow', 15)} Reprendre</button>` : ''}
        <button class="lib-action" data-act="open" title="Ouvrir à la première page">${icon('menu_book', 15)} ${hasProgress ? 'Début' : 'Ouvrir'}</button>
        <button class="lib-action" data-act="text" title="Lire en texte sur le web">${icon('article', 15)} Lire</button>
        <button class="lib-action" data-act="epub" title="Télécharger en EPUB">${icon('auto_stories', 15)} EPUB</button>
        <button class="lib-action lib-del" data-act="delete" title="Supprimer">${icon('delete', 15)}</button>
      </div>
    </div>`;
  }).join('');
  body.querySelectorAll('.lib-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.closest('.lib-book').dataset.id);
      const act = btn.dataset.act;
      if (act === 'delete') {
        if (!confirm('Supprimer ce livre ?')) return;
        await libDelete(id);
        await renderLibrary();
      } else if (act === 'open' || act === 'resume') {
        const book = await libGet(id);
        const file = new File([book.data], book.name, { type: 'application/pdf' });
        document.getElementById('lib-modal').classList.remove('open');
        // Si "Reprendre" : démarrer à la dernière page
        if (act === 'resume' && book.lastPage && window.pdf) {
          window.pdf.startPage = book.lastPage;
        }
        await _origLoadPdfFile(file);
        if (window.pdf) window.pdf.bookId = id;
        if (act === 'resume' && book.lastPage) {
          if (window.showToast) window.showToast(`Reprise à la page ${book.lastPage}`);
        }
      } else if (act === 'text') {
        await viewBookAsText(id);
      } else if (act === 'epub') {
        await downloadAsEpub(id);
      }
    });
  });
}

// =============================================================
// Extraction texte depuis PDF
// =============================================================
async function extractPdfText(buf) {
  const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let pageText = '';
    let lastY = null;
    for (const item of tc.items) {
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) pageText += '\n';
      pageText += item.str;
      if (item.hasEOL) pageText += '\n'; else pageText += ' ';
      lastY = item.transform[5];
    }
    pages.push(pageText.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
  }
  return pages;
}

async function viewBookAsText(id) {
  const book = await libGet(id);
  if (window.showToast) window.showToast('Extraction du texte…');
  const body = document.getElementById('lib-body');
  body.innerHTML = `<div class="lib-empty">Extraction en cours… ${icon('hourglass_top', 14)}</div>`;
  const pages = await extractPdfText(book.data);
  body.innerHTML = `
    <div class="lib-reader">
      <div class="lib-reader-bar">
        <button id="lib-back">← Retour</button>
        <strong>${escHtmlLib(book.title)}</strong>
        <div style="display:flex;gap:6px">
          <button id="lib-dl-txt">↓ .txt</button>
          <button id="lib-dl-epub">↓ .epub</button>
        </div>
      </div>
      <div class="lib-reader-content">
        ${pages.map((p,i) => `<section class="lib-page"><h4>Page ${i+1}</h4><div class="lib-page-text">${escHtmlLib(p).replace(/\n/g,'<br/>')}</div></section>`).join('')}
      </div>
    </div>
  `;
  document.getElementById('lib-back').onclick = renderLibrary;
  document.getElementById('lib-dl-txt').onclick = () => {
    const blob = new Blob([pages.map((p,i) => `--- Page ${i+1} ---\n\n${p}`).join('\n\n')], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = book.title.replace(/[^a-z0-9]+/gi,'-') + '.txt';
    a.click();
  };
  document.getElementById('lib-dl-epub').onclick = () => downloadAsEpub(id, pages);
}

// =============================================================
// Conversion EPUB
// =============================================================
async function downloadAsEpub(id, prePages) {
  if (!window.JSZip) { if (window.showToast) window.showToast('JSZip non chargé'); return; }
  const book = await libGet(id);
  if (window.showToast) window.showToast('Génération EPUB…');
  const pages = prePages || await extractPdfText(book.data);
  const zip = new JSZip();

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.folder('META-INF').file('container.xml',
`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

  const oebps = zip.folder('OEBPS');
  const uid = 'urn:uuid:' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random());
  const title = book.title;

  // 1 chapitre toutes les 10 pages
  const CHUNK = 10;
  const chunks = [];
  for (let i = 0; i < pages.length; i += CHUNK) chunks.push(pages.slice(i, i + CHUNK));

  chunks.forEach((chunk, idx) => {
    const html = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="fr">
<head><title>Section ${idx+1}</title><meta charset="utf-8"/>
<style>body{font-family:serif;line-height:1.6}p{margin:0 0 1em;text-indent:0}hr{border:none;border-top:1px dashed #999;margin:2em 0}</style>
</head><body>
<h2>Section ${idx+1} (pages ${idx*CHUNK+1} – ${idx*CHUNK+chunk.length})</h2>
${chunk.map((p,i) => `<h3>Page ${idx*CHUNK+i+1}</h3>` + p.split('\n\n').map(par => `<p>${escHtmlLib(par).replace(/\n/g,'<br/>')}</p>`).join('')).join('\n<hr/>\n')}
</body></html>`;
    oebps.file(`chapter${idx+1}.xhtml`, html);
  });

  const manifest = chunks.map((_,i) => `<item id="ch${i+1}" href="chapter${i+1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n');
  const spine = chunks.map((_,i) => `<itemref idref="ch${i+1}"/>`).join('\n');

  oebps.file('content.opf',
`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${uid}</dc:identifier>
<dc:title>${escHtmlLib(title)}</dc:title>
<dc:language>fr</dc:language>
<dc:creator>Lecture Intelligente</dc:creator>
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}/,'')}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifest}
</manifest>
<spine>${spine}</spine>
</package>`);

  oebps.file('nav.xhtml',
`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Sommaire</title><meta charset="utf-8"/></head>
<body><nav epub:type="toc"><h1>Sommaire</h1><ol>
${chunks.map((_,i)=>`<li><a href="chapter${i+1}.xhtml">Section ${i+1}</a></li>`).join('')}
</ol></nav></body></html>`);

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = title.replace(/[^a-z0-9]+/gi,'-') + '.epub';
  a.click();
  URL.revokeObjectURL(a.href);
  if (window.showToast) window.showToast('EPUB téléchargé ✓');
}

// =============================================================
// Styles
// =============================================================
const _libStyle = document.createElement('style');
_libStyle.textContent = `
#lib-modal { position: fixed; inset: 0; z-index: 500; display: none; }
#lib-modal.open { display: block; }
.lib-overlay { position: absolute; inset: 0; background: rgba(15,15,15,0.4); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
.lib-content { position: absolute; top: 5vh; left: 50%; transform: translateX(-50%); width: 90vw; max-width: 820px; height: 90vh; height: 90dvh; background: var(--bg); border-radius: var(--radius-lg); display: flex; flex-direction: column; box-shadow: var(--shadow-lg); overflow: hidden; }
.lib-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.lib-header h3 { font-size: 15px; font-weight: 600; color: var(--text); }
.lib-header-actions { display: flex; gap: 4px; }
.lib-import { padding: 6px 12px; background: var(--accent); color: #fff; border: none; border-radius: var(--radius); font-family: inherit; font-size: 13px; cursor: pointer; font-weight: 500; height: 28px; transition: background .1s; }
.lib-import:hover { background: var(--accent-hover); }
.lib-close { background: transparent; border: none; font-size: 16px; cursor: pointer; color: var(--text2); padding: 4px 8px; border-radius: var(--radius); height: 28px; min-width: 28px; transition: background .1s; }
.lib-close:hover { background: var(--hover); color: var(--text); }
.lib-body { flex: 1; overflow-y: auto; padding: 14px 16px; }
.lib-empty { text-align: center; color: var(--text2); padding: 3rem 1rem; font-size: 14px; line-height: 1.6; }
.lib-book { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-radius: var(--radius); margin-bottom: 2px; gap: 12px; flex-wrap: wrap; transition: background .1s; }
.lib-book:hover { background: var(--hover); }
.lib-book-info { flex: 1; min-width: 180px; }
.lib-book-info strong { display: block; font-weight: 600; margin-bottom: 2px; font-size: 14px; color: var(--text); }
.lib-book-info small { font-size: 12px; color: var(--text2); }
.lib-book-actions { display: flex; gap: 2px; flex-wrap: wrap; }
.lib-action { padding: 4px 10px; border: none; background: transparent; color: var(--text2); border-radius: var(--radius); font-family: inherit; font-size: 13px; cursor: pointer; height: 28px; transition: background .1s, color .1s; box-shadow: inset 0 0 0 1px var(--border); }
.lib-action:hover { background: var(--hover); color: var(--text); }
.lib-action.lib-del:hover { background: rgba(224,62,62,0.12); color: var(--danger); box-shadow: inset 0 0 0 1px rgba(224,62,62,0.3); }
.lib-action.lib-resume { background: var(--accent); color: #fff; box-shadow: none; font-weight: 500; }
.lib-action.lib-resume:hover { background: var(--accent-hover); color: #fff; }
.lib-progress { margin-top: 6px; max-width: 280px; }
.lib-progress-bar { height: 4px; background: var(--bg3); border-radius: 2px; overflow: hidden; margin-bottom: 4px; }
.lib-progress-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width .3s; }
.lib-progress-text { font-size: 11px; color: var(--text2); }
.lib-reader { display: flex; flex-direction: column; height: 100%; }
.lib-reader-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 0 0 12px; border-bottom: 1px solid var(--border); margin-bottom: 16px; flex-wrap: wrap; }
.lib-reader-bar button { padding: 4px 10px; border: none; background: transparent; color: var(--text2); border-radius: var(--radius); font-family: inherit; font-size: 13px; cursor: pointer; height: 28px; transition: background .1s; box-shadow: inset 0 0 0 1px var(--border); }
.lib-reader-bar button:hover { background: var(--hover); color: var(--text); }
.lib-reader-bar strong { font-size: 14px; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.lib-reader-content { flex: 1; overflow-y: auto; padding-right: 6px; }
.lib-page { margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--border); }
.lib-page h4 { font-size: 12px; color: var(--text3); margin-bottom: 8px; font-weight: 500; }
.lib-page-text { font-size: 15px; line-height: 1.65; color: var(--text); white-space: pre-wrap; }
@media (max-width: 600px) {
  .lib-content { width: 100vw; height: 100vh; height: 100dvh; top: 0; border-radius: 0; }
}
`;
document.head.appendChild(_libStyle);

// =============================================================
// Init
// =============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectLibraryUI);
} else {
  injectLibraryUI();
}
