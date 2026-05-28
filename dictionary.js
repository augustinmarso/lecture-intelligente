// =============================================================
// dictionary.js — Dictionnaire intégré façon Kindle
// Double-clic sur un mot dans PDF/EPUB → popup avec définition
// API gratuite : dictionaryapi.dev + fallback Wiktionary
// =============================================================

const DICT_CACHE_KEY = 'dict-cache-v1';
const DICT_SAVED_KEY = 'dict-saved-words-v1';
const DICT_LANG_KEY = 'dict-lang-v1';

function _dictLang() {
  return localStorage.getItem(DICT_LANG_KEY) || 'fr';
}
function _dictSetLang(l) {
  localStorage.setItem(DICT_LANG_KEY, l);
}

function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Cache mémoire + localStorage
let _dictCache = null;
function _loadCache() {
  if (_dictCache) return _dictCache;
  try { _dictCache = JSON.parse(localStorage.getItem(DICT_CACHE_KEY) || '{}'); }
  catch (_) { _dictCache = {}; }
  return _dictCache;
}
function _saveCache() {
  try { localStorage.setItem(DICT_CACHE_KEY, JSON.stringify(_dictCache)); } catch (_) {}
}

async function fetchDefinition(word) {
  word = word.trim().toLowerCase();
  if (!word || word.length < 2 || word.length > 50) return null;
  const lang = _dictLang();
  const cache = _loadCache();
  const cacheKey = `${lang}::${word}`;
  if (cache[cacheKey]) return cache[cacheKey];

  // Try dictionaryapi.dev
  try {
    const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/${lang}/${encodeURIComponent(word)}`);
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length) {
        const result = { source: 'dictionaryapi.dev', entries: data };
        cache[cacheKey] = result;
        _saveCache();
        return result;
      }
    }
  } catch (e) { console.warn('dict api error', e); }

  // Fallback: Wiktionary (REST API)
  try {
    const wikiLang = lang === 'fr' ? 'fr' : lang;
    const r = await fetch(`https://${wikiLang}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
    if (r.ok) {
      const data = await r.json();
      const result = { source: 'wiktionary', wiki: data };
      cache[cacheKey] = result;
      _saveCache();
      return result;
    }
  } catch (e) { console.warn('wiktionary error', e); }

  return null;
}

// =============================================================
// Liste des mots sauvegardés
// =============================================================
function getSavedWords() {
  try { return JSON.parse(localStorage.getItem(DICT_SAVED_KEY) || '[]'); }
  catch (_) { return []; }
}
function saveWord(word, definition, context) {
  const list = getSavedWords();
  const lang = _dictLang();
  if (list.some(w => w.word === word && w.lang === lang)) return false;
  list.unshift({ word, lang, definition, context: context || '', savedAt: Date.now() });
  try { localStorage.setItem(DICT_SAVED_KEY, JSON.stringify(list.slice(0, 500))); } catch (_) {}
  return true;
}
function removeWord(word, lang) {
  let list = getSavedWords();
  list = list.filter(w => !(w.word === word && w.lang === lang));
  try { localStorage.setItem(DICT_SAVED_KEY, JSON.stringify(list)); } catch (_) {}
}

// =============================================================
// Rendering définition
// =============================================================
function _renderDef(word, data) {
  if (!data) {
    return `<div class="dict-empty">Aucune définition trouvée pour <strong>${_esc(word)}</strong>.</div>
      <div class="dict-actions">
        <a href="https://${_dictLang() === 'fr' ? 'fr' : 'en'}.wiktionary.org/wiki/${encodeURIComponent(word)}" target="_blank" rel="noopener" class="dict-link">Voir sur Wiktionnaire ↗</a>
      </div>`;
  }

  if (data.source === 'dictionaryapi.dev') {
    const entry = data.entries[0];
    const phonetic = entry.phonetic || (entry.phonetics?.find(p => p.text)?.text || '');
    let html = `<div class="dict-head">
      <h3>${_esc(entry.word || word)}</h3>
      ${phonetic ? `<span class="dict-phonetic">${_esc(phonetic)}</span>` : ''}
    </div>`;
    entry.meanings.slice(0, 3).forEach(m => {
      html += `<div class="dict-meaning">
        <div class="dict-pos">${_esc(m.partOfSpeech)}</div>
        <ol class="dict-defs">${m.definitions.slice(0, 3).map(d =>
          `<li>${_esc(d.definition)}${d.example ? `<em class="dict-ex">"${_esc(d.example)}"</em>` : ''}</li>`
        ).join('')}</ol>
      </div>`;
    });
    return html;
  }

  if (data.source === 'wiktionary') {
    let html = `<div class="dict-head"><h3>${_esc(word)}</h3></div>`;
    const lang = _dictLang();
    const langData = data.wiki[lang] || data.wiki['fr'] || data.wiki['en'] || Object.values(data.wiki)[0];
    if (langData && langData.length) {
      langData.slice(0, 3).forEach(item => {
        html += `<div class="dict-meaning">
          <div class="dict-pos">${_esc(item.partOfSpeech || '')}</div>
          <ol class="dict-defs">${(item.definitions || []).slice(0, 3).map(d =>
            `<li>${(d.definition || '').replace(/<[^>]+>/g, '')}</li>`
          ).join('')}</ol>
        </div>`;
      });
    }
    return html;
  }
  return '';
}

// =============================================================
// Popup style Kindle
// =============================================================
let _dictPopup = null;

function _ensurePopup() {
  if (_dictPopup) return _dictPopup;
  const p = document.createElement('div');
  p.id = 'dict-popup';
  p.style.display = 'none';
  document.body.appendChild(p);
  _dictPopup = p;
  return p;
}

function _hidePopup() { if (_dictPopup) _dictPopup.style.display = 'none'; }

async function showDefinitionPopup(word, rect, context) {
  const popup = _ensurePopup();
  popup.innerHTML = `<div class="dict-loading">Recherche <strong>${_esc(word)}</strong>…</div>`;
  popup.style.display = 'block';

  // Positionner au-dessus de la sélection
  const popW = 360;
  let left = rect.left + window.scrollX + rect.width / 2 - popW / 2;
  let top = rect.top + window.scrollY - 10;
  left = Math.max(8, Math.min(window.innerWidth - popW - 8, left));
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popup.style.transform = 'translateY(-100%)';

  const data = await fetchDefinition(word);
  if (_dictPopup !== popup || popup.style.display === 'none') return;

  const saved = getSavedWords().some(w => w.word === word.toLowerCase() && w.lang === _dictLang());
  popup.innerHTML = `
    ${_renderDef(word, data)}
    <div class="dict-footer">
      <button class="dict-action ${saved?'saved':''}" data-act="save">${saved ? '✓ Enregistré' : '+ Mes mots'}</button>
      <select class="dict-lang" title="Langue du dictionnaire">
        <option value="fr"${_dictLang()==='fr'?' selected':''}>Français</option>
        <option value="en"${_dictLang()==='en'?' selected':''}>English</option>
        <option value="es"${_dictLang()==='es'?' selected':''}>Español</option>
        <option value="de"${_dictLang()==='de'?' selected':''}>Deutsch</option>
        <option value="it"${_dictLang()==='it'?' selected':''}>Italiano</option>
      </select>
      <button class="dict-action" data-act="close">✕</button>
    </div>
  `;

  popup.querySelector('[data-act="save"]').onclick = () => {
    const defText = popup.querySelector('.dict-defs li')?.textContent || '';
    if (saved) {
      removeWord(word.toLowerCase(), _dictLang());
      if (window.showToast) window.showToast('Retiré de mes mots');
    } else {
      saveWord(word.toLowerCase(), defText, context);
      if (window.showToast) window.showToast('📖 Mot enregistré');
    }
    _hidePopup();
  };
  popup.querySelector('[data-act="close"]').onclick = _hidePopup;
  popup.querySelector('.dict-lang').onchange = async (e) => {
    _dictSetLang(e.target.value);
    await showDefinitionPopup(word, rect, context);
  };
}

// =============================================================
// Détection double-clic / sélection de mot
// =============================================================
function _isWord(text) {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 2 || t.length > 50) return false;
  return /^[\p{L}\p{M}'-]+$/u.test(t);
}

function _getContext(node) {
  if (!node) return '';
  const el = node.nodeType === 1 ? node : node.parentElement;
  if (!el) return '';
  const parent = el.closest('span, p, div');
  return (parent?.textContent || '').slice(0, 200);
}

document.addEventListener('dblclick', (e) => {
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const word = sel.toString().trim();
    if (!_isWord(word)) return;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return;
    // Seulement dans PDF text layer ou EPUB content
    if (!el.closest('.textLayer') && !el.closest('.epub-content')) return;
    const rect = range.getBoundingClientRect();
    const context = _getContext(node);
    showDefinitionPopup(word, rect, context);
  }, 30);
});

// Fermer en cliquant ailleurs
document.addEventListener('mousedown', (e) => {
  if (_dictPopup && _dictPopup.style.display !== 'none' && !_dictPopup.contains(e.target)) {
    _hidePopup();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') _hidePopup();
});

// =============================================================
// UI : Modal "Mes mots appris"
// =============================================================
function openSavedWords() {
  const existing = document.getElementById('dict-words-modal');
  if (existing) { existing.remove(); return; }

  const list = getSavedWords();
  const modal = document.createElement('div');
  modal.id = 'dict-words-modal';
  modal.innerHTML = `
    <div class="dw-overlay"></div>
    <div class="dw-content">
      <div class="dw-header">
        <h2>📖 Mes mots <span class="dw-count">${list.length}</span></h2>
        <button class="dw-close">✕</button>
      </div>
      <div class="dw-body">
        ${list.length === 0 ?
          `<div class="dw-empty">Aucun mot enregistré.<br><br>Double-clique sur un mot dans un PDF ou EPUB pour voir sa définition, puis « + Mes mots ».</div>` :
          list.map(w => `
            <div class="dw-card" data-word="${_esc(w.word)}" data-lang="${_esc(w.lang)}">
              <div class="dw-head">
                <strong>${_esc(w.word)}</strong>
                <small>${_esc(w.lang)} · ${new Date(w.savedAt).toLocaleDateString('fr-FR')}</small>
              </div>
              <div class="dw-def">${_esc(w.definition || '—')}</div>
              ${w.context ? `<div class="dw-ctx">« …${_esc(w.context)}… »</div>` : ''}
              <div class="dw-actions">
                <button class="dw-del">🗑</button>
              </div>
            </div>
          `).join('')
        }
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.dw-close').onclick = () => modal.remove();
  modal.querySelector('.dw-overlay').onclick = () => modal.remove();
  modal.querySelectorAll('.dw-del').forEach(b => {
    b.onclick = (e) => {
      const card = e.target.closest('.dw-card');
      removeWord(card.dataset.word, card.dataset.lang);
      card.remove();
      const c = modal.querySelector('.dw-count');
      if (c) c.textContent = getSavedWords().length;
    };
  });
}

window.openSavedWords = openSavedWords;

// =============================================================
// Injection bouton 📖 dans le top-bar
// =============================================================
function _injectDictButton() {
  const _do = () => {
    document.querySelectorAll('.top-bar').forEach(bar => {
      if (bar.dataset.dictBtn) return;
      bar.dataset.dictBtn = '1';
      const btn = document.createElement('button');
      btn.className = 'btn-pdf-toggle';
      btn.title = 'Mes mots (double-clic sur un mot pour la définition)';
      btn.textContent = '📖';
      btn.onclick = openSavedWords;
      const pdfBtn = bar.querySelector('#btn-pdf-toggle');
      if (pdfBtn) bar.insertBefore(btn, pdfBtn);
      else bar.appendChild(btn);
    });
  };
  new MutationObserver(_do).observe(document.body, { childList: true, subtree: true });
  _do();
}

// =============================================================
// Styles — cohérent style Notion
// =============================================================
const _dictStyle = document.createElement('style');
_dictStyle.textContent = `
/* Popup définition */
#dict-popup { position: absolute; width: 360px; max-width: calc(100vw - 16px); background: var(--bg); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); z-index: 600; padding: 14px 16px; font-size: 14px; color: var(--text); line-height: 1.5; }
.dict-loading { color: var(--text2); font-size: 13px; }
.dict-empty { color: var(--text2); font-size: 13px; line-height: 1.5; }
.dict-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.dict-head h3 { font-size: 18px; font-weight: 700; color: var(--text); letter-spacing: -0.01em; }
.dict-phonetic { font-size: 13px; color: var(--text2); font-style: italic; }
.dict-meaning { margin-bottom: 10px; }
.dict-pos { font-size: 11px; color: var(--text2); margin-bottom: 4px; font-weight: 600; text-transform: lowercase; }
.dict-defs { list-style: none; padding: 0; margin: 0; counter-reset: defn; }
.dict-defs li { counter-increment: defn; position: relative; padding-left: 22px; margin-bottom: 6px; font-size: 13px; color: var(--text); line-height: 1.55; }
.dict-defs li::before { content: counter(defn); position: absolute; left: 0; top: 0; color: var(--text3); font-weight: 500; font-size: 12px; }
.dict-ex { display: block; color: var(--text2); margin-top: 2px; font-size: 12px; font-style: italic; }
.dict-footer { display: flex; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); align-items: center; }
.dict-action { padding: 4px 12px; background: var(--bg2); color: var(--text); border: none; border-radius: var(--radius); font-family: inherit; font-size: 13px; cursor: pointer; height: 28px; transition: background .1s; box-shadow: inset 0 0 0 1px var(--border); font-weight: 500; }
.dict-action:hover { background: var(--bg3); }
.dict-action.saved { background: var(--accent); color: #fff; box-shadow: none; }
.dict-action[data-act="close"] { margin-left: auto; min-width: 28px; padding: 4px 8px; }
.dict-lang { padding: 4px 8px; background: var(--bg2); color: var(--text); border: none; border-radius: var(--radius); font-family: inherit; font-size: 12px; height: 28px; box-shadow: inset 0 0 0 1px var(--border); cursor: pointer; }
.dict-link { color: var(--accent); text-decoration: none; font-size: 13px; }
.dict-link:hover { text-decoration: underline; }

/* Modal mots enregistrés */
#dict-words-modal { position: fixed; inset: 0; z-index: 555; }
.dw-overlay { position: absolute; inset: 0; background: rgba(15,15,15,0.4); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
.dw-content { position: absolute; top: 5vh; left: 50%; transform: translateX(-50%); width: 90vw; max-width: 700px; height: 90vh; background: var(--bg); border-radius: var(--radius-lg); display: flex; flex-direction: column; box-shadow: var(--shadow-lg); overflow: hidden; }
.dw-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.dw-header h2 { font-size: 16px; font-weight: 700; color: var(--text); letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; }
.dw-count { font-size: 11px; color: var(--text2); padding: 1px 8px; background: var(--bg3); border-radius: 3px; font-weight: 500; }
.dw-close { background: transparent; border: none; font-size: 16px; cursor: pointer; color: var(--text2); padding: 4px 8px; border-radius: var(--radius); height: 28px; min-width: 28px; transition: background .1s; }
.dw-close:hover { background: var(--hover); color: var(--text); }
.dw-body { padding: 14px 16px; overflow-y: auto; flex: 1; }
.dw-empty { text-align: center; color: var(--text2); padding: 3rem 1rem; font-size: 14px; line-height: 1.6; }
.dw-card { padding: 12px 14px; border-radius: var(--radius); margin-bottom: 2px; position: relative; transition: background .1s; }
.dw-card:hover { background: var(--hover); }
.dw-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.dw-head strong { font-size: 15px; font-weight: 700; color: var(--text); }
.dw-head small { font-size: 11px; color: var(--text3); font-weight: 500; }
.dw-def { font-size: 13px; color: var(--text); line-height: 1.55; }
.dw-ctx { margin-top: 6px; font-size: 12px; color: var(--text2); font-style: italic; }
.dw-actions { position: absolute; top: 8px; right: 8px; opacity: 0; transition: opacity .1s; }
.dw-card:hover .dw-actions { opacity: 1; }
.dw-del { background: transparent; border: none; color: var(--text3); cursor: pointer; padding: 4px 8px; border-radius: var(--radius); height: 28px; transition: background .1s; }
.dw-del:hover { background: rgba(224,62,62,0.12); color: var(--danger); }

@media (max-width: 600px) {
  .dw-content { width: 100vw; height: 100vh; top: 0; border-radius: 0; }
  #dict-popup { width: calc(100vw - 16px); }
}
`;
document.head.appendChild(_dictStyle);

// =============================================================
// Init
// =============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _injectDictButton);
} else {
  _injectDictButton();
}
