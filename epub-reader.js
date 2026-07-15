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
    if (!item) continue;
    // Certains OPF omettent le media-type : on accepte aussi par extension
    const isHtml = (item.type && item.type.includes('html')) || /\.x?html?$/i.test(item.href || '');
    if (!isHtml) continue;
    const path = _epubResolvePath(opfDir, item.href);
    const file = zip.file(path) || zip.file(decodeURIComponent(path));
    if (!file) continue;
    const html = await file.async('text');
    chapters.push({ id, path, html });
  }

  const toc = await _parseEpubToc(zip, opfDoc, opfDir, manifest, chapters);

  return { title, chapters, toc, zip, opfDir };
}

// Résout un href relatif (avec ./ et ../) par rapport à un dossier du zip
function _epubResolvePath(baseDir, href) {
  const clean = (href || '').split('#')[0].split('?')[0];
  const parts = (baseDir ? baseDir + '/' + clean : clean).split('/');
  const out = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

// =============================================================
// Table des matières réelle de l'EPUB : nav.xhtml (EPUB3),
// sinon toc.ncx (EPUB2), sinon les titres trouvés dans les sections.
// Renvoie [{label, index, level}] où index pointe dans chapters[].
// =============================================================
async function _parseEpubToc(zip, opfDoc, opfDir, manifest, chapters) {
  const parser = new DOMParser();
  const idxByPath = {};
  chapters.forEach((ch, i) => { idxByPath[ch.path] = i; idxByPath[decodeURIComponent(ch.path)] = i; });
  const resolveIdx = (baseDir, href) => {
    if (!href) return -1;
    const p = _epubResolvePath(baseDir, href);
    if (p in idxByPath) return idxByPath[p];
    const d = decodeURIComponent(p);
    return d in idxByPath ? idxByPath[d] : -1;
  };
  const entries = [];
  const push = (label, idx, level) => {
    label = (label || '').replace(/\s+/g, ' ').trim();
    if (label && idx >= 0) entries.push({ label, index: idx, level: level || 0 });
  };

  // --- EPUB3 : document de navigation (manifest item properties~=nav) ---
  try {
    let navHref = null;
    for (const id of Object.keys(manifest)) {
      const el = opfDoc.querySelector(`manifest > item[id="${CSS.escape ? CSS.escape(id) : id}"]`);
      const props = el ? (el.getAttribute('properties') || '') : '';
      if (props.split(/\s+/).includes('nav')) { navHref = manifest[id].href; break; }
    }
    if (navHref) {
      const navPath = _epubResolvePath(opfDir, navHref);
      const navDir = navPath.lastIndexOf('/') >= 0 ? navPath.substring(0, navPath.lastIndexOf('/')) : '';
      const navFile = zip.file(navPath);
      if (navFile) {
        const doc = parser.parseFromString(await navFile.async('text'), 'text/html');
        let nav = null;
        doc.querySelectorAll('nav').forEach(n => {
          const t = n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || n.getAttribute('role') || '';
          if (!nav && /toc|doc-toc/.test(t)) nav = n;
        });
        if (!nav) nav = doc.querySelector('nav');
        if (nav) {
          const walk = (ol, level) => {
            for (const li of ol.children) {
              if (li.tagName !== 'LI') continue;
              const a = li.querySelector(':scope > a[href]');
              if (a) push(a.textContent, resolveIdx(navDir, a.getAttribute('href')), level);
              const sub = li.querySelector(':scope > ol');
              if (sub) walk(sub, level + 1);
            }
          };
          const rootOl = nav.querySelector('ol');
          if (rootOl) walk(rootOl, 0);
        }
      }
    }
  } catch (e) { console.warn('EPUB nav.xhtml illisible', e); }

  // --- EPUB2 : toc.ncx (spine@toc ou manifest media-type ncx) ---
  if (!entries.length) {
    try {
      let ncxHref = null;
      const spineEl = opfDoc.querySelector('spine');
      const tocId = spineEl ? spineEl.getAttribute('toc') : null;
      if (tocId && manifest[tocId]) ncxHref = manifest[tocId].href;
      if (!ncxHref) {
        for (const id of Object.keys(manifest)) {
          if ((manifest[id].type || '').includes('dtbncx')) { ncxHref = manifest[id].href; break; }
        }
      }
      if (ncxHref) {
        const ncxPath = _epubResolvePath(opfDir, ncxHref);
        const ncxDir = ncxPath.lastIndexOf('/') >= 0 ? ncxPath.substring(0, ncxPath.lastIndexOf('/')) : '';
        const ncxFile = zip.file(ncxPath);
        if (ncxFile) {
          const doc = parser.parseFromString(await ncxFile.async('text'), 'text/xml');
          const walk = (el, level) => {
            for (const np of el.children) {
              if (np.tagName !== 'navPoint') continue;
              const lbl = np.querySelector(':scope > navLabel > text');
              const content = np.querySelector(':scope > content');
              push(lbl ? lbl.textContent : '', resolveIdx(ncxDir, content ? content.getAttribute('src') : ''), level);
              walk(np, level + 1);
            }
          };
          const navMap = doc.querySelector('navMap');
          if (navMap) walk(navMap, 0);
        }
      }
    } catch (e) { console.warn('EPUB toc.ncx illisible', e); }
  }

  // --- Repli : un titre par section (h1-h3, sinon « Section N ») ---
  if (!entries.length) {
    chapters.forEach((ch, i) => {
      const m = (ch.html || '').match(/<(h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/i);
      const label = m ? m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
      entries.push({ label: label || `Section ${i + 1}`, index: i, level: 0 });
    });
  }

  // Dédoublonner les entrées consécutives pointant sur la même section avec le même libellé
  return entries.filter((e, i) => !i || e.index !== entries[i - 1].index || e.label !== entries[i - 1].label);
}

let _epubKeyHandler = null;
let _epubPanelMode = null; // 'pdf-panel' | 'lib-modal'
let _epubBlobUrls = [];    // URLs blob créées pour les images (révoquées à la fermeture)

function _closeEpubPanel() {
  if (_epubKeyHandler) { document.removeEventListener('keydown', _epubKeyHandler); _epubKeyHandler = null; }
  _epubBlobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
  _epubBlobUrls = [];
  window.epubGetCurrentChapter = null;
  // Restaurer la toolbar PDF si on l'a cachée
  document.querySelectorAll('#pdf-panel .pdf-toolbar, #pdf-panel .highlights-bar').forEach(el => el.style.display = '');
  // Vider le viewer (l'utilisateur peut recharger un PDF s'il le souhaite)
  const viewer = document.getElementById('pdf-viewer');
  if (viewer) {
    viewer.innerHTML = `<div class="pdf-empty">Aucun PDF ouvert.<br><label>Sélectionner un fichier<input type="file" accept="application/pdf" style="display:none" onchange="loadPdfFromInput(event)"/></label></div>`;
    if (window.renderPdfEmptyLibrary) window.renderPdfEmptyLibrary();
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

  // Le lecteur EPUB remplace le PDF dans le même panneau : on libère le
  // document PDF.js (mémoire) et on coupe son rattachement bibliothèque,
  // sinon Ctrl+H et le suivi de position continuent sur l'ancien PDF.
  if (window.pdf && window.pdf.doc) {
    try { window.pdf.doc.destroy(); } catch (_) {}
    window.pdf.doc = null;
    window.pdf.bookId = null;
    window.pdf.total = 0;
  }

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
  // 📍 Restaurer la position de lecture si on a déjà lu cet EPUB.
  // La clé inclut le nombre de sections : deux livres homonymes (ou une
  // conversion PDF→EPUB vs un vrai EPUB) ne partagent plus leur position.
  const slug = (title || 'unknown').replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const posKey = `epub-pos2-${slug}-${epub.chapters.length}`;
  const legacyPosKey = 'epub-pos-' + slug;
  let current = 0;
  try {
    const saved = parseInt(localStorage.getItem(posKey) || localStorage.getItem(legacyPosKey) || '0');
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

  // Réécrit les <img>/<image> de la section vers des URLs blob tirées du zip
  // (les chemins internes de l'EPUB ne sont pas résolubles par le navigateur).
  const _epubMime = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', bmp:'image/bmp', avif:'image/avif' };
  async function resolveImages(contentEl, ch) {
    const baseDir = ch.path.lastIndexOf('/') >= 0 ? ch.path.substring(0, ch.path.lastIndexOf('/')) : '';
    const nodes = contentEl.querySelectorAll('img[src], image');
    for (const node of nodes) {
      const isSvgImage = node.tagName.toLowerCase() === 'image';
      const src = isSvgImage
        ? (node.getAttribute('href') || node.getAttribute('xlink:href'))
        : node.getAttribute('src');
      if (!src || /^(https?:|data:|blob:)/i.test(src)) continue;
      const path = _epubResolvePath(baseDir, src);
      const f = epub.zip.file(path) || epub.zip.file(decodeURIComponent(path));
      if (!f) continue;
      try {
        const ext = (path.split('.').pop() || '').toLowerCase();
        const blob = new Blob([await f.async('arraybuffer')], { type: _epubMime[ext] || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        _epubBlobUrls.push(url);
        if (isSvgImage) { node.setAttribute('href', url); node.setAttribute('xlink:href', url); }
        else node.setAttribute('src', url);
      } catch (_) {}
    }
  }

  // Entrée du sommaire correspondant à la section affichée (la plus proche ≤ current)
  function tocEntryForCurrent() {
    let best = null;
    for (const t of (epub.toc || [])) {
      // > strict : à section égale, on garde la première entrée (le chapitre
      // parent, pas ses sous-ancres)
      if (t.index <= current && (!best || t.index > best.index)) best = t;
    }
    return best;
  }
  window.epubGetCurrentChapter = () => {
    const t = tocEntryForCurrent();
    return t ? t.label : null;
  };

  function renderCh() {
    const ch = epub.chapters[current];
    const contentEl = document.getElementById('epub-content');
    if (ch && contentEl) {
      contentEl.innerHTML = extractBody(ch.html);
      contentEl.scrollTop = 0;
      resolveImages(contentEl, ch);
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

  // Panneau « Chapitres » : sommaire cliquable (équivalent EPUB de togglePdfChapters)
  function toggleEpubToc() {
    const host = document.querySelector('.epub-reader-panel');
    if (!host) return;
    let tocPanel = host.querySelector('.epub-toc-panel');
    if (tocPanel) { tocPanel.remove(); return; }
    const toc = epub.toc || [];
    if (!toc.length) {
      if (window.showToast) window.showToast('Cet EPUB n\'a pas de sommaire');
      return;
    }
    const active = tocEntryForCurrent();
    tocPanel = document.createElement('div');
    tocPanel.className = 'epub-toc-panel';
    tocPanel.innerHTML = `
      <div class="pcp-head">
        <strong>${icon('toc', 16)} Chapitres <span class="pcp-count">${toc.length}</span></strong>
        <button class="pcp-close" title="Fermer">${icon('close', 16)}</button>
      </div>
      <div class="pcp-list">
        ${toc.map((t, i) => `
          <button class="pcp-item${active === t ? ' active' : ''}" data-toc="${i}" style="padding-left:${12 + t.level * 15}px" title="${(t.label||'').replace(/"/g,'&quot;')}">
            <span class="pcp-title">${(t.label||'').replace(/</g,'&lt;')}</span>
            <span class="pcp-page">${t.index + 1}</span>
          </button>`).join('')}
      </div>`;
    host.appendChild(tocPanel);
    tocPanel.querySelector('.pcp-close').onclick = () => tocPanel.remove();
    tocPanel.querySelectorAll('.pcp-item').forEach(el => el.onclick = () => {
      const t = toc[parseInt(el.dataset.toc)];
      if (t) { current = t.index; renderCh(); }
      tocPanel.remove();
    });
    const act = tocPanel.querySelector('.pcp-item.active');
    if (act) act.scrollIntoView({ block: 'center' });
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
          <button id="epub-toc" class="lib-action" title="Chapitres (sommaire)">${icon('toc', 15)}</button>
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
  document.getElementById('epub-toc').onclick = toggleEpubToc;
  document.getElementById('epub-prev').onclick = () => { if (current > 0) { current--; renderCh(); } };
  document.getElementById('epub-next').onclick = () => { if (current < epub.chapters.length-1) { current++; renderCh(); } };

  if (_epubKeyHandler) document.removeEventListener('keydown', _epubKeyHandler);
  _epubKeyHandler = (e) => {
    const contentEl = document.getElementById('epub-content');
    // offsetParent nul = lecteur présent mais panneau masqué (toggle) → ignorer
    if (!contentEl || !contentEl.offsetParent) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); document.getElementById('epub-prev').click(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); document.getElementById('epub-next').click(); }
    if (e.key === 'Escape') {
      e.preventDefault();
      const tocPanel = document.querySelector('.epub-toc-panel');
      if (tocPanel) tocPanel.remove();
      else _closeEpubPanel();
    }
  };
  document.addEventListener('keydown', _epubKeyHandler);

  renderCh();
}

window.showEpubReader = showEpubReader;
window.closeEpubReader = _closeEpubPanel;

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
  try {
    const book = await libGet(id);
    if (!book || !book.data) {
      if (window.showToast) window.showToast('Livre introuvable dans la bibliothèque');
      return;
    }
    if (window.showToast) window.showToast('Conversion PDF → EPUB…');
    const pages = await extractPdfText(book.data);
    const blob = await _buildEpubBlobInline(book.title, pages);
    await showEpubReader(blob, book.title);
  } catch (e) {
    console.error('readPdfAsEpubWeb', e);
    if (window.showToast) window.showToast('Échec de la conversion PDF → EPUB');
  }
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
  position: relative; /* ancre le panneau « Chapitres » */
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

/* Panneau « Chapitres » (réutilise les classes pcp-* de chapter-detect.js) */
.epub-toc-panel {
  position: absolute; top: 48px; left: 10px; z-index: 60;
  width: min(340px, calc(100% - 20px)); max-height: calc(100% - 68px);
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--epub-bg); border: 1px solid var(--epub-border); border-radius: var(--radius-lg, 12px);
  box-shadow: var(--shadow-lg, 0 12px 32px rgba(0,0,0,.22));
  color: var(--epub-text);
}
.epub-toc-panel .pcp-head { background: color-mix(in srgb, var(--epub-bg) 92%, var(--epub-text) 8%); border-color: var(--epub-border); }
.epub-toc-panel .pcp-item { color: var(--epub-text); }
.epub-toc-panel .pcp-item.active { background: color-mix(in srgb, var(--epub-accent) 14%, transparent); }
.epub-toc-panel .pcp-page { color: var(--epub-text-muted); }

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
