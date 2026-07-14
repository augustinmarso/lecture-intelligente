// =============================================================
// chapter-detect.js — Détection auto du chapitre courant
// =============================================================

// ----- Pour PDF : utiliser l'outline (TOC) -----
async function getCurrentChapterFromPdf() {
  if (!window.pdf || !window.pdf.doc) return null;
  let outline;
  try { outline = await window.pdf.doc.getOutline(); }
  catch (e) { return null; }
  if (!outline || !outline.length) return null;

  // Aplatir l'outline en collectant titre + page
  const flat = [];
  async function walk(items) {
    for (const item of items) {
      try {
        let dest = item.dest;
        if (typeof dest === 'string') dest = await window.pdf.doc.getDestination(dest);
        if (dest && dest[0]) {
          const pageIdx = await window.pdf.doc.getPageIndex(dest[0]);
          flat.push({ title: item.title, page: pageIdx + 1 });
        }
      } catch (_) {}
      if (item.items && item.items.length) await walk(item.items);
    }
  }
  await walk(outline);

  if (!flat.length) return null;

  // Trier par page et trouver la dernière entrée dont page <= pdf.page
  flat.sort((a, b) => a.page - b.page);
  let best = null;
  for (const it of flat) {
    if (it.page <= window.pdf.page) best = it;
    else break;
  }
  return best ? best.title.trim() : null;
}

// ----- Liste COMPLÈTE des chapitres (sommaire / outline) du PDF -----
// Renvoie [{title, page, level}] à plat, niveaux préservés pour l'indentation.
async function getPdfChapters() {
  if (!window.pdf || !window.pdf.doc) return [];
  let outline;
  try { outline = await window.pdf.doc.getOutline(); }
  catch (_) { return []; }
  if (!outline || !outline.length) return [];
  const flat = [];
  async function walk(items, level) {
    for (const item of items) {
      let page = null;
      try {
        let dest = item.dest;
        if (typeof dest === 'string') dest = await window.pdf.doc.getDestination(dest);
        if (dest && dest[0]) page = (await window.pdf.doc.getPageIndex(dest[0])) + 1;
      } catch (_) {}
      const title = (item.title || '').trim();
      if (title) flat.push({ title, page, level });
      if (item.items && item.items.length) await walk(item.items, level + 1);
    }
  }
  await walk(outline, 0);
  return flat;
}
window.getPdfChapters = getPdfChapters;

function _escChap(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Ouvre/ferme le panneau des chapitres (sommaire cliquable)
async function togglePdfChapters() {
  let panel = document.getElementById('pdf-chapters-panel');
  if (panel && panel.classList.contains('open')) { panel.classList.remove('open'); return; }
  const chapters = await getPdfChapters();
  if (!chapters.length) {
    if (window.showToast) window.showToast('Ce PDF n’a pas de sommaire intégré');
    return;
  }
  const host = document.getElementById('pdf-panel');
  if (!host) return;
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'pdf-chapters-panel';
    host.appendChild(panel);
  }
  const cur = window.pdf ? window.pdf.page : 1;
  let activeIdx = -1;
  chapters.forEach((c, i) => { if (c.page && c.page <= cur) activeIdx = i; });
  panel.innerHTML = `
    <div class="pcp-head">
      <strong>${icon('toc', 16)} Chapitres <span class="pcp-count">${chapters.length}</span></strong>
      <button class="pcp-close" title="Fermer">${icon('close', 16)}</button>
    </div>
    <div class="pcp-list">
      ${chapters.map((c, i) => `
        <button class="pcp-item${i === activeIdx ? ' active' : ''}" data-page="${c.page || ''}" style="padding-left:${12 + c.level * 15}px" title="${_escChap(c.title)}">
          <span class="pcp-title">${_escChap(c.title)}</span>
          ${c.page ? `<span class="pcp-page">p.${c.page}</span>` : ''}
        </button>`).join('')}
    </div>`;
  panel.classList.add('open');
  panel.querySelector('.pcp-close').onclick = () => panel.classList.remove('open');
  panel.querySelectorAll('.pcp-item').forEach(el => el.onclick = () => {
    const p = parseInt(el.dataset.page);
    if (p && window.scrollToPage) window.scrollToPage(p);
    panel.classList.remove('open');
  });
  const act = panel.querySelector('.pcp-item.active');
  if (act) act.scrollIntoView({ block: 'center' });
}
window.togglePdfChapters = togglePdfChapters;

// Fermer le panneau : Échap, ou clic en dehors
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const p = document.getElementById('pdf-chapters-panel');
    if (p && p.classList.contains('open')) { p.classList.remove('open'); e.stopPropagation(); }
  }
});
document.addEventListener('click', (e) => {
  const p = document.getElementById('pdf-chapters-panel');
  if (!p || !p.classList.contains('open')) return;
  if (p.contains(e.target) || e.target.closest('#pdf-chapters')) return;
  p.classList.remove('open');
}, true);

// ----- Pour EPUB : extraire le titre depuis le HTML de la section -----
function getCurrentChapterFromEpub() {
  const contentEl = document.getElementById('epub-content');
  if (!contentEl) return null;
  const h = contentEl.querySelector('h1, h2, h3');
  if (h) return h.textContent.trim().replace(/\s+/g, ' ').slice(0, 120);
  // Fallback : 1ère ligne de texte
  const txt = contentEl.textContent.trim().split('\n')[0];
  return txt ? txt.slice(0, 80) : null;
}

// ----- Action : détecte et remplit state.chapterTitle -----
async function setChapterFromCurrentView() {
  let title = null;
  let source = '';

  if (document.querySelector('.epub-reader-panel')) {
    title = getCurrentChapterFromEpub();
    source = 'EPUB';
  } else if (window.pdf && window.pdf.doc) {
    title = await getCurrentChapterFromPdf();
    source = 'PDF';
    if (!title) {
      // fallback : "Page N"
      title = `Page ${window.pdf.page}`;
    }
  }

  if (!title) {
    if (window.showToast) window.showToast('Pas de PDF/EPUB ouvert');
    return;
  }

  if (window.state) {
    window.state.chapterTitle = title;
    // Si pas en mode chapitre, basculer
    if (window.state.noteType !== 'chapitre') {
      window.state.noteType = 'chapitre';
    }
    // Re-render si la fonction existe
    if (typeof window.render === 'function') window.render();
  }
  if (window.showToast) window.showToast(`Chapitre défini : ${title.slice(0,50)}${title.length>50?'…':''}`);

  // Met à jour visuellement le champ s'il est ouvert
  const inp = document.getElementById('chapter-title');
  if (inp) inp.value = title;
}

window.setChapterFromCurrentView = setChapterFromCurrentView;
window.getCurrentChapterFromPdf = getCurrentChapterFromPdf;

// =============================================================
// Injecte le bouton "📍 Ce chapitre" dans :
//  - la toolbar PDF
//  - la toolbar EPUB
// =============================================================
function _injectChapterButton() {
  const _doInject = () => {
    // Toolbar PDF
    const pdfToolbar = document.querySelector('#pdf-panel .pdf-toolbar');
    if (pdfToolbar && !pdfToolbar.dataset.chapBtn) {
      pdfToolbar.dataset.chapBtn = '1';

      // Bouton « Chapitres » : ouvre le sommaire cliquable du PDF
      const chapBtn = document.createElement('button');
      chapBtn.id = 'pdf-chapters';
      chapBtn.title = 'Chapitres du PDF (sommaire)';
      chapBtn.innerHTML = icon('toc', 16);
      chapBtn.onclick = (e) => { e.stopPropagation(); togglePdfChapters(); };
      const fit = pdfToolbar.querySelector('#pdf-fit');
      if (fit) fit.insertAdjacentElement('afterend', chapBtn);
      else pdfToolbar.appendChild(chapBtn);

      // Bouton « Ce chapitre » : fixe le chapitre courant sur la note
      const btn = document.createElement('button');
      btn.id = 'pdf-set-chapter';
      btn.title = 'Définir le chapitre courant comme chapitre de la note';
      btn.innerHTML = icon('bookmark', 15) + ' Ce chapitre';
      btn.style.background = 'var(--bg2)';
      btn.onclick = setChapterFromCurrentView;
      const hl = pdfToolbar.querySelector('#pdf-highlight');
      if (hl) hl.insertAdjacentElement('afterend', btn);
      else pdfToolbar.appendChild(btn);
    }

    // Toolbar EPUB
    const epubBar = document.querySelector('.epub-reader-panel .epub-bar');
    if (epubBar && !epubBar.dataset.chapBtn) {
      epubBar.dataset.chapBtn = '1';
      const btn = document.createElement('button');
      btn.id = 'epub-set-chapter';
      btn.title = 'Définir cette section comme chapitre de la note';
      btn.innerHTML = icon('bookmark', 15);
      btn.className = 'lib-action';
      btn.onclick = setChapterFromCurrentView;
      const nav = epubBar.querySelector('.epub-nav');
      if (nav) nav.insertBefore(btn, nav.firstChild);
      else epubBar.appendChild(btn);
    }
  };
  new MutationObserver(_doInject).observe(document.body, { childList: true, subtree: true });
  _doInject();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _injectChapterButton);
} else {
  _injectChapterButton();
}

// ----- Styles du panneau « Chapitres » -----
const _chapStyle = document.createElement('style');
_chapStyle.textContent = `
#pdf-chapters-panel {
  position: absolute; top: 52px; left: 10px; z-index: 60;
  width: min(340px, calc(100% - 20px)); max-height: calc(100% - 72px);
  display: none; flex-direction: column; overflow: hidden;
  background: var(--bg); border: 1px solid var(--border2); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg, 0 12px 32px rgba(0,0,0,.22));
}
#pdf-chapters-panel.open { display: flex; }
.pcp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 12px; border-bottom: 1px solid var(--border); background: var(--bg2); }
.pcp-head strong { font-size: 13px; font-weight: 600; color: var(--text); display: inline-flex; align-items: center; gap: 6px; }
.pcp-count { font-size: 11px; color: var(--text3); font-weight: 500; }
.pcp-close { border: none; background: transparent; color: var(--text2); cursor: pointer; padding: 2px; border-radius: var(--radius); display: inline-flex; }
.pcp-close:hover { background: var(--hover); color: var(--text); }
.pcp-list { overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 1px; }
.pcp-item { display: flex; align-items: baseline; gap: 8px; width: 100%; text-align: left;
  border: none; background: transparent; font-family: inherit; font-size: 13px; color: var(--text);
  padding: 7px 10px; border-radius: var(--radius); cursor: pointer; transition: background .1s; }
.pcp-item:hover { background: var(--hover); }
.pcp-item.active { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--text); font-weight: 600; }
.pcp-title { flex: 1; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pcp-page { flex: 0 0 auto; font-size: 11px; color: var(--text3); font-variant-numeric: tabular-nums; }
`;
document.head.appendChild(_chapStyle);
