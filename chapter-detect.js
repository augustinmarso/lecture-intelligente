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
