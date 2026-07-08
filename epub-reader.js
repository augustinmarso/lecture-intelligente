// =============================================================
// epub-reader.js — Lecteur EPUB en navigateur (basé sur JSZip)
// =============================================================

async function openEpubBlob(fileOrBlob) {
  if (!window.JSZip) throw new Error('JSZip non chargé');
  const zip = await JSZip.loadAsync(fileOrBlob);

  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('container.xml manquant');
  const containerXml = await containerFile.async('text');
  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, 'text/xml');
  const rootfile = containerDoc.querySelector('rootfile');
  const opfPath = rootfile.getAttribute('full-path');
  const opfDir = opfPath.lastIndexOf('/') >= 0 ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';

  const opfXml = await zip.file(opfPath).async('text');
  const opfDoc = parser.parseFromString(opfXml, 'text/xml');

  const titleEl = opfDoc.getElementsByTagName('dc:title')[0] || opfDoc.querySelector('title');
  const title = titleEl ? titleEl.textContent.trim() : 'Livre EPUB';

  const manifest = {};
  opfDoc.querySelectorAll('manifest > item').forEach(item => {
    manifest[item.getAttribute('id')] = {
      href: item.getAttribute('href'),
      type: item.getAttribute('media-type')
    };
  });

  const spineIds = [];
  opfDoc.querySelectorAll('spine > itemref').forEach(ref => {
    spineIds.push(ref.getAttribute('idref'));
  });

  const chapters = [];
  for (const id of spineIds) {
    const item = manifest[id];
    if (!item || !item.type || !item.type.includes('html')) continue;
    const path = opfDir ? opfDir + '/' + item.href : item.href;
    const file = zip.file(path);
    if (!file) continue;
    const html = await file.async('text');
    chapters.push({ id, path, html });
  }

  return { title, chapters, zip, opfDir };
}

let _epubKeyHandler = null;
let _epubPanelMode = null; // 'pdf-panel' | 'lib-modal'

function _closeEpubPanel() {
  if (_epubKeyHandler) { document.removeEventListener('keydown', _epubKeyHandler); _epubKeyHandler = null; }
  // Restaurer la toolbar PDF si on l'a cachée
  document.querySelectorAll('#pdf-panel .pdf-toolbar, #pdf-panel .highlights-bar').forEach(el => el.style.display = '');
  // Vider le viewer (l'utilisateur peut recharger un PDF s'il le souhaite)
  const viewer = document.getElementById('pdf-viewer');
  if (viewer) {
    viewer.innerHTML = `<div class="pdf-empty">Aucun PDF ouvert.<br><label>Sélectionner un fichier<input type="file" accept="application/pdf" style="display:none" onchange="loadPdfFromInput(event)"/></label></div>`;
  }
  _epubPanelMode = null;
}

async function showEpubReader(fileOrBlob, displayTitle) {
  if (window.showToast) window.showToast('Ouverture de l\'EPUB…');
  let epub;
  try {
    epub = await openEpubBlob(fileOrBlob);
  } catch (e) {
    if (window.showToast) window.showToast('EPUB invalide : ' + e.message);
    console.error(e);
    return;
  }

  // Fermer la modal bibliothèque s'il est ouverte
  const libModal = document.getElementById('lib-modal');
  if (libModal) libModal.classList.remove('open');

  // Ouvrir le panneau PDF (à gauche, là où on lit normalement)
  if (window.state) window.state.pdfPanelOpen = true;
  const panel = document.getElementById('pdf-panel');
  if (panel) panel.classList.add('active');
  const toggleBtn = document.getElementById('btn-pdf-toggle');
  if (toggleBtn) toggleBtn.classList.add('active');

  // Cacher la toolbar PDF + barre highlights pendant la lecture EPUB
  document.querySelectorAll('#pdf-panel .pdf-toolbar, #pdf-panel .highlights-bar').forEach(el => el.style.display = 'none');

  const viewer = document.getElementById('pdf-viewer');
  if (!viewer) return;
  _epubPanelMode = 'pdf-panel';

  const title = displayTitle || epub.title;
  // 📍 Restaurer la position de lecture si on a déjà lu cet EPUB
  const posKey = 'epub-pos-' + (title || 'unknown').replace(/[^a-z0-9]/gi, '-').toLowerCase();
  let current = 0;
  try {
    const saved = parseInt(localStorage.getItem(posKey) || '0');
    if (saved > 0 && saved < epub.chapters.length) {
      current = saved;
      if (window.showToast) window.showToast(`Reprise section ${current + 1}/${epub.chapters.length}`);
    }
  } catch (_) {}

  function extractBody(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return doc.body ? doc.body.innerHTML : html;
  }

  function renderCh() {
    const ch = epub.chapters[current];
    const contentEl = document.getElementById('epub-content');
    if (ch && contentEl) {
      contentEl.innerHTML = extractBody(ch.html);
      contentEl.scrollTop = 0;
    }
    const prog = document.getElementById('epub-progress');
    if (prog) prog.textContent = `${current+1} / ${epub.chapters.length}`;
    const prev = document.getElementById('epub-prev');
    const next = document.getElementById('epub-next');
    if (prev) prev.disabled = current === 0;
    if (next) next.disabled = current >= epub.chapters.length - 1;
    // 💾 Sauvegarder la position de lecture
    try { localStorage.setItem(posKey, String(current)); } catch (_) {}
  }

  // Charger préférences
  const prefs = _loadEpubPrefs();

  // Remplacer le contenu du pdf-viewer par le lecteur EPUB
  viewer.innerHTML = `
    <div class="epub-reader-panel" data-theme="${prefs.theme}" data-width="${prefs.width}" data-font="${prefs.font}" style="--epub-fs:${prefs.fontSize}px;--epub-lh:${prefs.lineHeight}">
      <div class="epub-bar">
        <button id="epub-back" class="lib-action" title="Fermer le lecteur EPUB (Esc)">✕</button>
        <strong title="${(title||'').replace(/"/g,'&quot;')}">${(title||'').replace(/</g,'&lt;')}</strong>
        <div class="epub-toolbar-actions">
          <button id="epub-settings-toggle" class="lib-action" title="Réglages d'affichage">${icon('tune', 15)}</button>
          <div class="epub-nav">
            <button id="epub-prev" class="lib-action" title="Précédent (←)">‹</button>
            <span id="epub-progress">–</span>
            <button id="epub-next" class="lib-action" title="Suivant (→)">›</button>
          </div>
        </div>
      </div>
      <div class="epub-settings" id="epub-settings" style="display:none">
        <div class="epub-set-row">
          <label>Taille</label>
          <div class="epub-set-btns">
            <button data-fs="-1" title="Plus petit">A−</button>
            <span class="epub-set-val" id="epub-fs-val">${prefs.fontSize}</span>
            <button data-fs="+1" title="Plus grand">A+</button>
          </div>
        </div>
        <div class="epub-set-row">
          <label>Interligne</label>
          <div class="epub-set-btns">
            <button data-lh="-0.1">−</button>
            <span class="epub-set-val" id="epub-lh-val">${prefs.lineHeight.toFixed(2)}</span>
            <button data-lh="+0.1">+</button>
          </div>
        </div>
        <div class="epub-set-row">
          <label>Largeur</label>
          <div class="epub-set-btns epub-pill-group" data-group="width">
            <button data-w="narrow" class="${prefs.width==='narrow'?'active':''}">Étroit</button>
            <button data-w="normal" class="${prefs.width==='normal'?'active':''}">Normal</button>
            <button data-w="wide" class="${prefs.width==='wide'?'active':''}">Large</button>
          </div>
        </div>
        <div class="epub-set-row">
          <label>Thème</label>
          <div class="epub-set-btns epub-pill-group" data-group="theme">
            <button data-t="auto" class="${prefs.theme==='auto'?'active':''}">Auto</button>
            <button data-t="light" class="${prefs.theme==='light'?'active':''}">Clair</button>
            <button data-t="sepia" class="${prefs.theme==='sepia'?'active':''}">Sépia</button>
            <button data-t="dark" class="${prefs.theme==='dark'?'active':''}">Sombre</button>
          </div>
        </div>
        <div class="epub-set-row">
          <label>Police</label>
          <div class="epub-set-btns epub-pill-group" data-group="font">
            <button data-f="serif" class="${prefs.font==='serif'?'active':''}">Serif</button>
            <button data-f="sans" class="${prefs.font==='sans'?'active':''}">Sans-serif</button>
            <button data-f="dys" class="${prefs.font==='dys'?'active':''}" title="Police adaptée dyslexie">Dyslexie</button>
          </div>
        </div>
      </div>
      <div class="epub-content" id="epub-content"></div>
    </div>
  `;

  // Wire settings
  _wireEpubSettings();

  document.getElementById('epub-back').onclick = _closeEpubPanel;
  document.getElementById('epub-prev').onclick = () => { if (current > 0) { current--; renderCh(); } };
  document.getElementById('epub-next').onclick = () => { if (current < epub.chapters.length-1) { current++; renderCh(); } };

  if (_epubKeyHandler) document.removeEventListener('keydown', _epubKeyHandler);
  _epubKeyHandler = (e) => {
    if (!document.getElementById('epub-content')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); document.getElementById('epub-prev').click(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); document.getElementById('epub-next').click(); }
    if (e.key === 'Escape') { e.preventDefault(); _closeEpubPanel(); }
  };
  document.addEventListener('keydown', _epubKeyHandler);

  renderCh();
}

window.showEpubReader = showEpubReader;

// =============================================================
// Préférences EPUB (taille, thème, largeur) — persistées localStorage
// =============================================================
const EPUB_PREFS_KEY = 'epub-reader-prefs-v1';
function _loadEpubPrefs() {
  try {
    const raw = localStorage.getItem(EPUB_PREFS_KEY);
    if (raw) return Object.assign(_defaultEpubPrefs(), JSON.parse(raw));
  } catch (_) {}
  return _defaultEpubPrefs();
}
function _defaultEpubPrefs() {
  return { fontSize: 18, lineHeight: 1.7, width: 'normal', theme: 'auto', font: 'serif' };
}
function _saveEpubPrefs(p) { try { localStorage.setItem(EPUB_PREFS_KEY, JSON.stringify(p)); } catch (_) {} }
function _applyEpubPrefs(p) {
  const panel = document.querySelector('.epub-reader-panel');
  if (!panel) return;
  panel.style.setProperty('--epub-fs', p.fontSize + 'px');
  panel.style.setProperty('--epub-lh', p.lineHeight);
  panel.dataset.width = p.width;
  panel.dataset.theme = p.theme;
  panel.dataset.font = p.font;
  const fsv = document.getElementById('epub-fs-val');
  const lhv = document.getElementById('epub-lh-val');
  if (fsv) fsv.textContent = p.fontSize;
  if (lhv) lhv.textContent = p.lineHeight.toFixed(2);
}

function _wireEpubSettings() {
  const toggle = document.getElementById('epub-settings-toggle');
  const panel = document.getElementById('epub-settings');
  if (toggle && panel) {
    toggle.onclick = () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    };
  }
  document.querySelectorAll('.epub-settings [data-fs]').forEach(b => {
    b.onclick = () => {
      const p = _loadEpubPrefs();
      const delta = parseInt(b.dataset.fs);
      p.fontSize = Math.max(12, Math.min(28, p.fontSize + delta));
      _saveEpubPrefs(p); _applyEpubPrefs(p);
    };
  });
  document.querySelectorAll('.epub-settings [data-lh]').forEach(b => {
    b.onclick = () => {
      const p = _loadEpubPrefs();
      const delta = parseFloat(b.dataset.lh);
      p.lineHeight = Math.max(1.2, Math.min(2.4, +(p.lineHeight + delta).toFixed(2)));
      _saveEpubPrefs(p); _applyEpubPrefs(p);
    };
  });
  document.querySelectorAll('.epub-settings [data-w]').forEach(b => {
    b.onclick = () => {
      const p = _loadEpubPrefs();
      p.width = b.dataset.w;
      document.querySelectorAll('.epub-pill-group[data-group="width"] button').forEach(x => x.classList.toggle('active', x.dataset.w === p.width));
      _saveEpubPrefs(p); _applyEpubPrefs(p);
    };
  });
  document.querySelectorAll('.epub-settings [data-t]').forEach(b => {
    b.onclick = () => {
      const p = _loadEpubPrefs();
      p.theme = b.dataset.t;
      document.querySelectorAll('.epub-pill-group[data-group="theme"] button').forEach(x => x.classList.toggle('active', x.dataset.t === p.theme));
      _saveEpubPrefs(p); _applyEpubPrefs(p);
    };
  });
  document.querySelectorAll('.epub-settings [data-f]').forEach(b => {
    b.onclick = () => {
      const p = _loadEpubPrefs();
      p.font = b.dataset.f;
      document.querySelectorAll('.epub-pill-group[data-group="font"] button').forEach(x => x.classList.toggle('active', x.dataset.f === p.font));
      _saveEpubPrefs(p); _applyEpubPrefs(p);
    };
  });
}

// =============================================================
// Hook bibliothèque : ajoute boutons "📖 Lire EPUB" + "+ EPUB"
// =============================================================
function _attachEpubLibButtons() {
  const obs = new MutationObserver(() => {
    // Bouton import EPUB dans le header de la modal
    const headerActions = document.querySelector('#lib-modal .lib-header-actions');
    if (headerActions && !headerActions.dataset.epubWired) {
      headerActions.dataset.epubWired = '1';
      const btn = document.createElement('button');
      btn.className = 'lib-import';
      btn.textContent = '+ EPUB';
      btn.title = 'Importer un fichier .epub';
      btn.style.background = 'var(--bg2)';
      btn.style.color = 'var(--text)';
      btn.onclick = () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.epub,application/epub+zip';
        inp.onchange = async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          await showEpubReader(f);
        };
        inp.click();
      };
      const closeBtn = headerActions.querySelector('.lib-close');
      if (closeBtn) headerActions.insertBefore(btn, closeBtn);
      else headerActions.appendChild(btn);
    }

    // Bouton "📖 Lire EPUB" sur chaque livre
    document.querySelectorAll('.lib-book').forEach(card => {
      if (card.dataset.epubReadWired) return;
      const actions = card.querySelector('.lib-book-actions');
      if (!actions) return;
      const epubBtn = actions.querySelector('[data-act="epub"]');
      if (!epubBtn) return;
      card.dataset.epubReadWired = '1';
      const readBtn = document.createElement('button');
      readBtn.className = 'lib-action';
      readBtn.dataset.act = 'read-epub';
      readBtn.title = 'Lire en EPUB dans le navigateur';
      readBtn.innerHTML = icon('auto_stories', 15) + ' EPUB Web';
      readBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = parseInt(card.dataset.id);
        await readPdfAsEpubWeb(id);
      };
      actions.insertBefore(readBtn, epubBtn);
    });
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// Convertit le PDF en EPUB et l'ouvre directement dans le lecteur web
async function readPdfAsEpubWeb(id) {
  if (!window.JSZip || typeof libGet !== 'function' || typeof extractPdfText !== 'function') {
    if (window.showToast) window.showToast('Module non prêt');
    return;
  }
  const book = await libGet(id);
  if (window.showToast) window.showToast('Conversion PDF → EPUB…');
  const pages = await extractPdfText(book.data);
  const blob = await _buildEpubBlobInline(book.title, pages);
  await showEpubReader(blob, book.title);
}

// Reconstruit un EPUB blob (logique dupliquée légère pour rester autonome)
async function _buildEpubBlobInline(title, pages) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.folder('META-INF').file('container.xml',
`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  const oebps = zip.folder('OEBPS');
  const uid = 'urn:uuid:' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random());
  const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const CHUNK = 10;
  const chunks = [];
  for (let i = 0; i < pages.length; i += CHUNK) chunks.push(pages.slice(i, i + CHUNK));

  chunks.forEach((chunk, idx) => {
    const html = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="fr">
<head><title>Section ${idx+1}</title><meta charset="utf-8"/>
<style>body{font-family:serif;line-height:1.6}p{margin:0 0 1em}h2{margin:0 0 1em}h3{margin:1.5em 0 .5em;font-size:1em;color:#555}hr{border:none;border-top:1px dashed #999;margin:2em 0}</style>
</head><body>
<h2>Section ${idx+1} (pages ${idx*CHUNK+1} – ${idx*CHUNK+chunk.length})</h2>
${chunk.map((p,i) => `<h3>Page ${idx*CHUNK+i+1}</h3>` + p.split('\n\n').map(par => `<p>${esc(par).replace(/\n/g,'<br/>')}</p>`).join('')).join('\n<hr/>\n')}
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
<dc:title>${esc(title)}</dc:title>
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

  return await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
}

// =============================================================
// Styles
// =============================================================
const _epubStyle = document.createElement('style');
_epubStyle.textContent = `
/* ======= LECTEUR EPUB — Layout ======= */
#pdf-viewer:has(.epub-reader-panel) { padding: 0; align-items: stretch; justify-content: stretch; background: var(--bg); }
.epub-reader-panel {
  --epub-fs: 18px;
  --epub-lh: 1.7;
  --epub-bg: var(--bg);
  --epub-text: var(--text);
  --epub-text-muted: var(--text2);
  --epub-accent: var(--accent);
  --epub-border: var(--border);
  display: flex; flex-direction: column; flex: 1; width: 100%; min-height: 100%;
  background: var(--epub-bg); color: var(--epub-text);
}

/* Toolbar */
.epub-bar { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 0.5px solid var(--epub-border); background: color-mix(in srgb, var(--epub-bg) 92%, var(--epub-text) 8%); flex-wrap: wrap; }
.epub-bar strong { font-family: 'Newsreader', Georgia, serif; font-size: 14px; font-weight: 500; flex: 1; min-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--epub-text); }
.epub-toolbar-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.epub-nav { display: flex; align-items: center; gap: 4px; }
.epub-nav span { font-size: 12px; color: var(--epub-text-muted); min-width: 56px; text-align: center; }
.epub-bar .lib-action { background: transparent; color: var(--epub-text); border-color: var(--epub-border); }
.epub-bar .lib-action:hover:not(:disabled) { background: color-mix(in srgb, var(--epub-text) 8%, transparent); }

/* Settings panel */
.epub-settings { padding: 12px 16px; border-bottom: 0.5px solid var(--epub-border); background: color-mix(in srgb, var(--epub-bg) 95%, var(--epub-text) 5%); display: flex; flex-direction: column; gap: 10px; }
.epub-set-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.epub-set-row > label { font-size: 12px; font-weight: 500; color: var(--epub-text-muted); min-width: 70px; text-transform: uppercase; letter-spacing: .04em; }
.epub-set-btns { display: flex; align-items: center; gap: 4px; }
.epub-set-btns button { padding: 5px 12px; border: 0.5px solid var(--epub-border); background: transparent; color: var(--epub-text); border-radius: 6px; font-family: inherit; font-size: 12px; font-weight: 500; cursor: pointer; transition: all .15s; }
.epub-set-btns button:hover { background: color-mix(in srgb, var(--epub-text) 8%, transparent); }
.epub-set-btns button.active { background: var(--epub-text); color: var(--epub-bg); border-color: var(--epub-text); }
.epub-set-val { font-variant-numeric: tabular-nums; font-size: 13px; min-width: 36px; text-align: center; color: var(--epub-text-muted); }
.epub-pill-group { display: flex; gap: 0; }
.epub-pill-group button { border-radius: 0; }
.epub-pill-group button:first-child { border-radius: 6px 0 0 6px; }
.epub-pill-group button:last-child { border-radius: 0 6px 6px 0; }
.epub-pill-group button + button { border-left: none; }

/* Reading area */
.epub-content {
  flex: 1; overflow-y: auto; width: 100%;
  padding: 2.5rem 2rem 4rem;
  font-size: var(--epub-fs);
  line-height: var(--epub-lh);
  color: var(--epub-text);
  margin: 0 auto;
  scroll-behavior: smooth;
}
.epub-reader-panel[data-width="narrow"] .epub-content { max-width: 540px; }
.epub-reader-panel[data-width="normal"] .epub-content { max-width: 680px; }
.epub-reader-panel[data-width="wide"] .epub-content { max-width: 960px; }

/* Typographie */
.epub-reader-panel[data-font="serif"] .epub-content { font-family: 'Newsreader', Georgia, 'Times New Roman', serif; }
.epub-reader-panel[data-font="sans"] .epub-content { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.epub-reader-panel[data-font="dys"] .epub-content { font-family: 'Comic Sans MS', 'Comic Sans', 'Trebuchet MS', sans-serif; letter-spacing: .02em; }

.epub-content h1, .epub-content h2, .epub-content h3, .epub-content h4 { font-family: inherit; font-weight: 600; line-height: 1.25; margin: 1.8em 0 .6em; color: var(--epub-text); }
.epub-content h1 { font-size: 1.7em; margin-top: 0; }
.epub-content h2 { font-size: 1.4em; }
.epub-content h3 { font-size: 1.15em; }
.epub-content h4 { font-size: 1em; color: var(--epub-text-muted); letter-spacing: .04em; text-transform: uppercase; }

.epub-content p {
  margin: 0;
  text-align: justify;
  text-justify: inter-word;
  hyphens: auto;
  -webkit-hyphens: auto;
  word-spacing: 0;
}
.epub-content p + p { text-indent: 1.4em; }
.epub-content p + p:not(:first-child) { margin-top: 0; }
.epub-content blockquote { margin: 1.5em 0; padding: .25em 0 .25em 1.2em; border-left: 3px solid var(--epub-accent); font-style: italic; color: var(--epub-text-muted); }
.epub-content em, .epub-content i { font-style: italic; }
.epub-content strong, .epub-content b { font-weight: 600; }
.epub-content img { max-width: 100%; height: auto; display: block; margin: 1.5em auto; border-radius: 4px; }
.epub-content hr { border: none; border-top: 0.5px solid var(--epub-border); margin: 2.5em auto; max-width: 60%; opacity: .6; }
.epub-content a { color: var(--epub-accent); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
.epub-content ul, .epub-content ol { margin: 1em 0 1em 1.5em; padding-left: 1em; }
.epub-content li { margin-bottom: .4em; }
.epub-content sup, .epub-content sub { font-size: .75em; }
.epub-content table { border-collapse: collapse; margin: 1.5em 0; width: 100%; }
.epub-content th, .epub-content td { padding: .5em .75em; border: 0.5px solid var(--epub-border); text-align: left; }
.epub-content code { font-family: 'SFMono-Regular', Menlo, Consolas, monospace; font-size: .9em; background: color-mix(in srgb, var(--epub-text) 6%, transparent); padding: 1px 6px; border-radius: 3px; }

/* ===== THÈMES ===== */
/* Auto = laisse hériter du :root */
.epub-reader-panel[data-theme="light"] {
  --epub-bg: #fefcf7;
  --epub-text: #1a1916;
  --epub-text-muted: #5a5954;
  --epub-border: rgba(26,25,22,0.12);
  --epub-accent: #c2410c;
}
.epub-reader-panel[data-theme="sepia"] {
  --epub-bg: #f4ecd8;
  --epub-text: #3a2f1a;
  --epub-text-muted: #6b5b3a;
  --epub-border: rgba(58,47,26,0.18);
  --epub-accent: #b45309;
}
.epub-reader-panel[data-theme="dark"] {
  --epub-bg: #1a1916;
  --epub-text: #e8e4d8;
  --epub-text-muted: #a0998a;
  --epub-border: rgba(232,228,216,0.12);
  --epub-accent: #f97316;
}

/* Scrollbar discrète */
.epub-content::-webkit-scrollbar { width: 8px; }
.epub-content::-webkit-scrollbar-thumb { background: var(--epub-border); border-radius: 4px; }
.epub-content::-webkit-scrollbar-thumb:hover { background: var(--epub-text-muted); }

/* ===== Responsive mobile ===== */
@media (max-width: 720px) {
  .epub-content { padding: 1.5rem 1.25rem 3rem; }
  .epub-bar { padding: 8px 10px; }
  .epub-bar strong { font-size: 13px; min-width: 0; }
  .epub-nav span { min-width: 44px; font-size: 11px; }
  .epub-set-row > label { min-width: 60px; font-size: 11px; }
}
@media (max-width: 480px) {
  .epub-reader-panel { --epub-fs: max(16px, var(--epub-fs)); }
  .epub-content { padding: 1rem .9rem 2.5rem; }
  .epub-content h1 { font-size: 1.4em; }
  .epub-content h2 { font-size: 1.2em; }
  .epub-set-row { gap: 8px; }
  .epub-set-btns button { padding: 6px 10px; font-size: 11px; }
}
`;
document.head.appendChild(_epubStyle);

// =============================================================
// Init
// =============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _attachEpubLibButtons);
} else {
  _attachEpubLibButtons();
}
