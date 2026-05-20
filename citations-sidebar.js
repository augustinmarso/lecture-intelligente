// =============================================================
// citations-sidebar.js — Panneau de citations à droite (pas par-dessus le PDF)
// Remplace la popup flottante par un panneau permanent dans la colonne notes
// =============================================================

function _escCit(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

let _selectionPreviewText = '';
let _sidebarCollapsed = false;

function _injectCitationsSidebar() {
  const sidebar = document.createElement('div');
  sidebar.id = 'citations-sidebar';
  sidebar.innerHTML = `
    <button class="cit-collapse" title="Replier/déplier">📜 <span id="cit-count">0</span></button>
    <div class="cit-inner">
      <div class="cit-header">
        <strong>📜 Citations</strong>
        <span id="cit-count-full">0 enregistrée(s)</span>
      </div>
      <div id="cit-selection-preview" style="display:none">
        <small>Texte sélectionné dans le PDF :</small>
        <blockquote id="cit-preview-text"></blockquote>
        <button id="cit-save-btn">💾 Enregistrer cette citation</button>
        <small class="cit-hint">Raccourci : <kbd>Ctrl</kbd>+<kbd>H</kbd></small>
      </div>
      <div id="cit-empty-hint">Sélectionne du texte dans le PDF/EPUB à gauche, puis enregistre-le ici.</div>
      <div id="cit-list"></div>
    </div>
  `;
  document.body.appendChild(sidebar);

  // Toggle collapse
  sidebar.querySelector('.cit-collapse').onclick = () => {
    _sidebarCollapsed = !_sidebarCollapsed;
    sidebar.classList.toggle('collapsed', _sidebarCollapsed);
    try { localStorage.setItem('cit-sidebar-collapsed', _sidebarCollapsed ? '1' : '0'); } catch (_) {}
  };

  // Bouton enregistrer
  document.getElementById('cit-save-btn').onclick = () => {
    if (typeof window.captureHighlight === 'function') {
      window.captureHighlight();
    }
  };

  // Restore collapsed state
  try {
    if (localStorage.getItem('cit-sidebar-collapsed') === '1') {
      _sidebarCollapsed = true;
      sidebar.classList.add('collapsed');
    }
  } catch (_) {}
}

function refreshCitationsSidebar() {
  if (!window.state) return;
  const list = document.getElementById('cit-list');
  const count = document.getElementById('cit-count');
  const countFull = document.getElementById('cit-count-full');
  const emptyHint = document.getElementById('cit-empty-hint');
  if (!list) return;
  const highlights = window.state.highlights || [];
  if (count) count.textContent = highlights.length;
  if (countFull) countFull.textContent = `${highlights.length} enregistrée${highlights.length>1?'s':''}`;
  if (emptyHint) emptyHint.style.display = highlights.length === 0 ? 'block' : 'none';
  list.innerHTML = highlights.slice().reverse().map((h, i) => {
    const realIdx = highlights.length - 1 - i;
    return `<div class="cit-card">
      <div class="cit-meta">Page ${h.page} · ${new Date(h.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
      <blockquote>${_escCit(h.text)}</blockquote>
      <button class="cit-del" data-idx="${realIdx}" title="Supprimer">✕</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.cit-del').forEach(b => {
    b.onclick = () => {
      const idx = parseInt(b.dataset.idx);
      window.state.highlights.splice(idx, 1);
      refreshCitationsSidebar();
      if (window.renderHighlightsBar) window.renderHighlightsBar();
      if (window.refreshCitationsLive) window.refreshCitationsLive();
    };
  });
}

window.refreshCitationsSidebar = refreshCitationsSidebar;

// =============================================================
// Mise à jour live du preview quand on sélectionne du texte
// =============================================================
function _updateSelectionPreview() {
  const preview = document.getElementById('cit-selection-preview');
  const previewText = document.getElementById('cit-preview-text');
  if (!preview || !previewText) return;
  const sel = window.getSelection();
  const txt = sel ? sel.toString().trim() : '';
  if (!txt) {
    preview.style.display = 'none';
    _selectionPreviewText = '';
    return;
  }
  // Vérifier que la sélection est bien dans le textLayer (PDF) ou epub-content (EPUB)
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el = node.nodeType === 1 ? node : node.parentElement;
  if (!el || (!el.closest('.textLayer') && !el.closest('.epub-content'))) {
    preview.style.display = 'none';
    return;
  }
  _selectionPreviewText = txt;
  previewText.textContent = txt.length > 200 ? txt.slice(0, 200) + '…' : txt;
  preview.style.display = 'block';
}

document.addEventListener('mouseup', () => setTimeout(_updateSelectionPreview, 30));
document.addEventListener('selectionchange', () => setTimeout(_updateSelectionPreview, 30));

// Désactiver la popup flottante de index.html en hijackant hideHlPopup → always hide
window.addEventListener('load', () => {
  // La popup .hl-popup existe encore dans le DOM mais on la cache
  const style = document.createElement('style');
  style.textContent = '.hl-popup { display: none !important; }';
  document.head.appendChild(style);
});

// Wrap captureHighlight pour refresh aussi la sidebar
window.addEventListener('load', () => {
  const orig = window.captureHighlight;
  if (typeof orig === 'function' && !orig.__sidebarWrapped) {
    window.captureHighlight = function() {
      orig();
      refreshCitationsSidebar();
      // Cacher le preview après enregistrement
      const preview = document.getElementById('cit-selection-preview');
      if (preview) preview.style.display = 'none';
    };
    window.captureHighlight.__sidebarWrapped = true;
  }
});

// =============================================================
// Styles
// =============================================================
const _citStyle = document.createElement('style');
_citStyle.textContent = `
#citations-sidebar {
  position: fixed;
  top: 80px;
  right: 16px;
  width: 320px;
  max-height: calc(100vh - 100px);
  background: var(--bg);
  border: 0.5px solid var(--border2);
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 20px rgba(0,0,0,.12);
  z-index: 40;
  display: flex;
  flex-direction: column;
  transition: all .2s ease;
}
#citations-sidebar.collapsed {
  width: auto;
  max-height: 44px;
}
#citations-sidebar.collapsed .cit-inner { display: none; }
.cit-collapse {
  padding: 10px 14px;
  background: var(--bg2);
  border: none;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
}
#citations-sidebar.collapsed .cit-collapse { border-radius: var(--radius-lg); background: var(--accent); color: #fff; }
.cit-collapse:hover { background: var(--bg3); }
.cit-collapse #cit-count { background: var(--accent); color: #fff; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; min-width: 22px; text-align: center; }
#citations-sidebar.collapsed .cit-collapse #cit-count { background: rgba(255,255,255,.25); }
.cit-inner {
  padding: 12px 14px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cit-header { display: flex; justify-content: space-between; align-items: baseline; }
.cit-header strong { font-size: 13px; }
.cit-header span { font-size: 11px; color: var(--text2); }
#cit-selection-preview {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg2));
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-radius: var(--radius);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
#cit-selection-preview small { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--text2); font-weight: 500; }
#cit-selection-preview blockquote { font-family: 'Lora', serif; font-size: 13px; line-height: 1.5; font-style: italic; color: var(--text); padding-left: 8px; border-left: 2px solid var(--accent); }
#cit-save-btn { padding: 8px 12px; background: var(--accent); color: #fff; border: none; border-radius: var(--radius); font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
#cit-save-btn:hover { opacity: .9; }
.cit-hint { color: var(--text3); font-size: 10px; }
.cit-hint kbd { padding: 1px 5px; border: 0.5px solid var(--border2); border-radius: 3px; background: var(--bg2); font-family: monospace; font-size: 10px; }
#cit-empty-hint { font-size: 12px; color: var(--text2); padding: 16px 8px; text-align: center; line-height: 1.5; font-style: italic; }
#cit-list { display: flex; flex-direction: column; gap: 8px; }
.cit-card { position: relative; padding: 8px 28px 8px 10px; background: var(--bg2); border-radius: var(--radius); border-left: 3px solid var(--accent); }
.cit-meta { font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
.cit-card blockquote { font-family: 'Lora', serif; font-size: 12px; line-height: 1.4; color: var(--text); font-style: italic; }
.cit-del { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 50%; border: none; background: transparent; color: var(--text3); cursor: pointer; font-size: 11px; }
.cit-del:hover { background: var(--bg3); color: var(--accent); }

@media (max-width: 1100px) {
  #citations-sidebar { right: 8px; width: 260px; }
}
@media (max-width: 720px) {
  #citations-sidebar { top: auto; bottom: 12px; right: 12px; left: 12px; width: auto; max-height: 50vh; }
  #citations-sidebar.collapsed { max-height: 44px; right: 12px; left: auto; }
}
`;
document.head.appendChild(_citStyle);

// =============================================================
// Init
// =============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _injectCitationsSidebar);
} else {
  _injectCitationsSidebar();
}
