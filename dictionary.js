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

  // 1. Wiktionary REST API — dictionnaire le plus fourni (surtout en français)
  try {
    const wikiLang = lang;
    const r = await fetch(`https://${wikiLang}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
    if (r.ok) {
      const data = await r.json();
      // Garde tout, on rendera tout
      if (Object.keys(data).length > 0) {
        const result = { source: 'wiktionary', wiki: data, word, lang: wikiLang };
        cache[cacheKey] = result;
        _saveCache();
        return result;
      }
    }
  } catch (e) { console.warn('wiktionary rest error', e); }

  // 2. dictionaryapi.dev (langues supportées: en, hi, es, fr, ja, ru, de, it, ko, ar, tr, pt-BR, zh-CN)
  try {
    const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/${lang}/${encodeURIComponent(word)}`);
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length && data[0].meanings?.length) {
        const result = { source: 'dictionaryapi.dev', entries: data, word };
        cache[cacheKey] = result;
        _saveCache();
        return result;
      }
    }
  } catch (e) { console.warn('dict api error', e); }

  // 3. MediaWiki Action API (extrait du Wiktionnaire — plus complet)
  try {
    const wikiLang = lang;
    const url = `https://${wikiLang}.wiktionary.org/w/api.php?action=query&format=json&origin=*&prop=extracts&explaintext=true&exsectionformat=plain&titles=${encodeURIComponent(word)}`;
    const r = await fetch(url);
    if (r.ok) {
      const data = await r.json();
      const pages = data.query?.pages;
      if (pages) {
        const page = Object.values(pages)[0];
        if (page && page.extract && !page.missing) {
          const result = { source: 'mediawiki', extract: page.extract, word, lang: wikiLang };
          cache[cacheKey] = result;
          _saveCache();
          return result;
        }
      }
    }
  } catch (e) { console.warn('mediawiki error', e); }

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
// Nettoie HTML mais garde la mise en forme légère (italiques pour exemples)
function _cleanHtml(s) {
  if (!s) return '';
  // Convertir certaines balises en équivalent texte
  return s
    .replace(/<i>(.*?)<\/i>/g, '<em>$1</em>')
    .replace(/<\/?(a|span|abbr|sup|sub|cite|code|var|small)[^>]*>/g, '')
    .replace(/<dl>[\s\S]*?<\/dl>/g, '')  // listes définitions imbriquées
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const POS_LABELS = {
  noun: 'nom', verb: 'verbe', adjective: 'adjectif', adverb: 'adverbe',
  pronoun: 'pronom', preposition: 'préposition', conjunction: 'conjonction',
  determiner: 'déterminant', exclamation: 'interjection', article: 'article',
  'proper noun': 'nom propre', 'numeral': 'numéral'
};

// Catégories grammaticales du Wiktionnaire (liste blanche) : seules les
// sections dont l'en-tête est une vraie catégorie fournissent des définitions.
const _WIKT_POS = /^(nom|verbe|adjectif|adverbe|interjection|pronom|préposition|conjonction|article|déterminant|numéral|onomatopée|particule|symbole|locution|forme d)/i;
// En-têtes de langue (délimitent les sections, pas des catégories)
const _WIKT_LANG = /^(français|anglais|allemand|espagnol|italien|portugais|néerlandais|latin|grec|russe|arabe|chinois|japonais|catalan|occitan|breton)$/i;

// Parse l'extrait texte brut d'un article Wiktionnaire (MediaWiki) en une
// suite ordonnée d'entrées { pos } (catégorie) et { def } (définition).
// On ne garde que le contenu placé sous une catégorie grammaticale reconnue,
// ce qui écarte étymologie, prononciation, références, synonymes, voir aussi…
function _parseWiktExtract(extract) {
  const lines = (extract || '').split('\n').map(l => l.trim()).filter(Boolean);
  const entries = [];
  let inSection = false; // sommes-nous sous une catégorie grammaticale ?
  for (const line of lines) {
    const isHeaderLike = line.length <= 45 && line.split(/\s+/).length <= 5
      && !/[.!?»]$/.test(line) && /^[A-ZÀ-Ÿ]/.test(line);
    if (isHeaderLike) {
      if (_WIKT_LANG.test(line)) { inSection = false; continue; }
      if (_WIKT_POS.test(line)) { entries.push({ pos: line }); inSection = true; }
      else inSection = false; // section hors définition (étymologie, voir aussi, biblio…)
      continue;
    }
    if (!inSection) continue;
    if (/\\[^\\]+\\/.test(line)) continue;                              // prononciation (IPA \…\)
    if (/^\((?:[ivxlcdm]+e\s+siècle|\d{3,4}|vers\s+\d)/i.test(line)) continue; // étymologie résiduelle
    if (line.length < 8) continue;
    entries.push({ def: line });
  }
  return entries;
}

// Une définition principale par catégorie grammaticale (on ignore les
// exemples/citations qui suivent chaque définition). → [{ pos, def }]
function _wiktMainDefs(extract) {
  const entries = _parseWiktExtract(extract);
  const out = [];
  let curPos = '', took = false;
  for (const e of entries) {
    if (e.pos) { curPos = e.pos; took = false; }
    else if (e.def && !took) { out.push({ pos: curPos, def: e.def }); took = true; }
  }
  if (!out.length) { const d = entries.find(e => e.def); if (d) out.push({ pos: '', def: d.def }); }
  return out;
}

function _renderDef(word, data) {
  if (!data) {
    return `<div class="dict-empty">Aucune définition trouvée pour <strong>${_esc(word)}</strong>.</div>
      <div style="margin-top:8px">
        <a href="https://${_dictLang()}.wiktionary.org/wiki/${encodeURIComponent(word)}" target="_blank" rel="noopener" class="dict-link">Voir sur Wiktionnaire ${icon('open_in_new', 13)}</a>
      </div>`;
  }

  if (data.source === 'dictionaryapi.dev') {
    const entry = data.entries[0];
    const phonetic = entry.phonetic || (entry.phonetics?.find(p => p.text)?.text || '');
    let html = `<div class="dict-head">
      <h3>${_esc(entry.word || word)}</h3>
      ${phonetic ? `<span class="dict-phonetic">${_esc(phonetic)}</span>` : ''}
    </div>`;
    entry.meanings.forEach(m => {
      const pos = POS_LABELS[m.partOfSpeech] || m.partOfSpeech;
      html += `<div class="dict-meaning">
        <div class="dict-pos">${_esc(pos)}</div>
        <ol class="dict-defs">${m.definitions.slice(0, 6).map(d =>
          `<li>${_esc(d.definition)}${d.example ? `<em class="dict-ex">« ${_esc(d.example)} »</em>` : ''}</li>`
        ).join('')}</ol>
      </div>`;
    });
    return html;
  }

  if (data.source === 'wiktionary') {
    let html = `<div class="dict-head"><h3>${_esc(word)}</h3></div>`;
    const lang = data.lang;
    // Wiktionary REST: data.wiki est un objet keyed par code de langue (ex: "fr": [...])
    let langData = data.wiki[lang] || data.wiki[_dictLang()];
    if (!langData) {
      // Prend la première qui n'est pas "other"
      const keys = Object.keys(data.wiki).filter(k => k !== 'other');
      langData = data.wiki[keys[0]] || data.wiki['other'];
    }
    if (Array.isArray(langData) && langData.length) {
      langData.forEach(item => {
        const pos = POS_LABELS[(item.partOfSpeech||'').toLowerCase()] || item.partOfSpeech || '';
        const defs = item.definitions || [];
        if (!defs.length) return;
        html += `<div class="dict-meaning">
          ${pos ? `<div class="dict-pos">${_esc(pos.toLowerCase())}</div>` : ''}
          <ol class="dict-defs">${defs.slice(0, 8).map(d => {
            const defText = _cleanHtml(d.definition || '');
            const examples = (d.parsedExamples || d.examples || []).slice(0, 2);
            const examplesHtml = examples.map(ex => {
              const t = typeof ex === 'string' ? ex : (ex.example || ex);
              return `<em class="dict-ex">« ${_cleanHtml(t)} »</em>`;
            }).join('');
            return `<li>${defText}${examplesHtml}</li>`;
          }).join('')}</ol>
        </div>`;
      });
    } else {
      html += `<div class="dict-empty">Mot trouvé mais sans définitions structurées.</div>`;
    }
    return html;
  }

  if (data.source === 'mediawiki') {
    // Extrait Wiktionnaire nettoyé : une définition claire par catégorie
    const defs = _wiktMainDefs(data.extract);
    let html = `<div class="dict-head"><h3>${_esc(word)}</h3></div>`;
    const lien = `<div class="dict-more"><a href="https://${_dictLang()}.wiktionary.org/wiki/${encodeURIComponent(word)}" target="_blank" rel="noopener" class="dict-link">Voir tout sur le Wiktionnaire ${icon('open_in_new', 13)}</a></div>`;
    if (!defs.length) return html + `<div class="dict-empty">Mot trouvé, mais sans définition claire.</div>` + lien;
    defs.slice(0, 6).forEach(d => {
      html += `<div class="dict-meaning">${d.pos ? `<div class="dict-pos">${_esc(d.pos.toLowerCase())}</div>` : ''}<ol class="dict-defs"><li>${_esc(d.def)}</li></ol></div>`;
    });
    return html + lien;
  }
  return '';
}

// =============================================================
// Définition en texte brut (pour le verso de la carte Anki)
// =============================================================
function _definitionToText(word, data) {
  if (!data) return '';
  const out = [];
  if (data.source === 'dictionaryapi.dev') {
    const entry = data.entries[0];
    (entry.meanings || []).slice(0, 3).forEach(m => {
      const pos = POS_LABELS[m.partOfSpeech] || m.partOfSpeech || '';
      const defs = (m.definitions || []).slice(0, 2).map(d => d.definition).filter(Boolean);
      if (defs.length) out.push((pos ? pos + ' — ' : '') + defs.join(' ; '));
    });
  } else if (data.source === 'wiktionary') {
    let langData = data.wiki[data.lang] || data.wiki[_dictLang()];
    if (!langData) {
      const keys = Object.keys(data.wiki).filter(k => k !== 'other');
      langData = data.wiki[keys[0]] || data.wiki['other'];
    }
    (langData || []).slice(0, 4).forEach(item => {
      const pos = POS_LABELS[(item.partOfSpeech || '').toLowerCase()] || item.partOfSpeech || '';
      // On écarte la prononciation (IPA entre \…\) et l'étymologie (« (…e siècle) »)
      const defs = (item.definitions || [])
        .map(d => _cleanHtml(d.definition || ''))
        .filter(t => t && !/\\[^\\]+\\/.test(t) && !/siècle\)/.test(t.slice(0, 40)))
        .slice(0, 2);
      if (defs.length) out.push((pos ? pos + ' — ' : '') + defs.join(' ; '));
    });
  } else if (data.source === 'mediawiki') {
    _wiktMainDefs(data.extract).slice(0, 3).forEach(d => out.push((d.pos ? d.pos + ' — ' : '') + d.def));
  }
  // Verso en texte pur : Anki échappe le HTML, on retire donc toute balise résiduelle
  let txt = out.join('\n').replace(/<[^>]+>/g, '').replace(/[ \t]+/g, ' ').trim();
  if (txt.length > 700) txt = txt.slice(0, 700).trim() + '…';
  return txt;
}

// Envoi automatique du mot dans Anki, deck « Mes mots » (recto = mot, verso = définition).
// Silencieux si Anki n'est pas joignable — on n'interrompt pas la lecture.
async function _sendWordToAnki(word, defText) {
  if (!defText || !window.ankiIsAvailable || !window.ankiQuickAdd) return;
  try {
    if (!await window.ankiIsAvailable()) return;
    await window.ankiQuickAdd(word, defText, 'Mes mots');
  } catch (_) {}
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
  const popW = 440;
  let left = rect.left + window.scrollX + rect.width / 2 - popW / 2;
  let top = rect.top + window.scrollY - 10;
  left = Math.max(8, Math.min(window.innerWidth - popW - 8, left));
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popup.style.transform = 'translateY(-100%)';
  // Si pas assez de place en haut, placer en dessous
  if (rect.top < 300) {
    popup.style.top = (rect.bottom + window.scrollY + 10) + 'px';
    popup.style.transform = 'none';
  }

  const data = await fetchDefinition(word);
  if (_dictPopup !== popup || popup.style.display === 'none') return;

  // Enregistrement automatique : le mot part tout de suite dans « Mes mots »
  // (liste locale de l'app + deck Anki « Mes mots »), sans étape manuelle.
  const defText = _definitionToText(word, data);
  let statusHtml = '';
  if (data && defText) {
    const w = word.toLowerCase();
    if (!getSavedWords().some(x => x.word === w && x.lang === _dictLang())) saveWord(w, defText, context);
    _sendWordToAnki(word, defText);
    statusHtml = `<span class="dict-saved-note">${icon('style', 13)} Ajouté à « Mes mots »</span>`;
  }
  popup.innerHTML = `
    ${_renderDef(word, data)}
    <div class="dict-footer">
      ${statusHtml}
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

// Trouve le mot situé sous un point (x, y) et renvoie un Range qui l'entoure.
// Permet de définir un mot d'un simple clic, sans devoir le double-cliquer.
function _wordRangeAtPoint(x, y) {
  let node = null, offset = 0;
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; offset = r.startOffset; }
  } else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { node = p.offsetNode; offset = p.offset; }
  }
  if (!node || node.nodeType !== 3) return null;
  const text = node.textContent || '';
  const isW = (c) => c && /[\p{L}\p{M}'-]/u.test(c);
  let s = Math.max(0, Math.min(offset, text.length)), e = s;
  while (s > 0 && isW(text[s - 1])) s--;
  while (e < text.length && isW(text[e])) e++;
  if (e <= s) return null;
  const range = document.createRange();
  range.setStart(node, s);
  range.setEnd(node, e);
  return range;
}

function _lookupFromRange(range) {
  if (!range) return;
  const word = range.toString().trim();
  if (!_isWord(word)) return;
  const node = range.startContainer;
  const el = node.nodeType === 1 ? node : node.parentElement;
  if (!el || (!el.closest('.textLayer') && !el.closest('.epub-content'))) return;
  const sel = window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(range); } // surligne le mot défini
  showDefinitionPopup(word, range.getBoundingClientRect(), _getContext(node));
}

// Simple clic sur un mot (dans un PDF ou un EPUB) → définition immédiate.
document.addEventListener('click', (e) => {
  if (e.detail !== 1) return; // le double-clic a son propre gestionnaire
  const el = e.target.nodeType === 1 ? e.target : e.target.parentElement;
  if (!el || (!el.closest('.textLayer') && !el.closest('.epub-content'))) return;
  if (_dictPopup && _dictPopup.contains(e.target)) return;
  const sel = window.getSelection();
  // Sélection de plusieurs mots (surlignage) : on ne déclenche pas le dictionnaire
  if (sel && !sel.isCollapsed && sel.toString().trim().split(/\s+/).length > 1) return;
  _lookupFromRange(_wordRangeAtPoint(e.clientX, e.clientY));
});

// Double-clic : conservé (sélectionne le mot puis le définit).
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
        <h2>${icon('menu_book', 18)} Mes mots <span class="dw-count">${list.length}</span></h2>
        <button class="dw-close">✕</button>
      </div>
      <div class="dw-body">
        ${list.length === 0 ?
          `<div class="dw-empty">Aucun mot enregistré.<br><br>Double-clique sur un mot dans un PDF ou EPUB&nbsp;: sa définition s'affiche et le mot part automatiquement dans « Mes mots » (ici et dans ton deck Anki).</div>` :
          list.map(w => `
            <div class="dw-card" data-word="${_esc(w.word)}" data-lang="${_esc(w.lang)}">
              <div class="dw-head">
                <strong>${_esc(w.word)}</strong>
                <small>${_esc(w.lang)} · ${new Date(w.savedAt).toLocaleDateString('fr-FR')}</small>
              </div>
              <div class="dw-def">${_esc(w.definition || '—')}</div>
              ${w.context ? `<div class="dw-ctx">« …${_esc(w.context)}… »</div>` : ''}
              <div class="dw-actions">
                <button class="dw-del">${icon('delete', 15)}</button>
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
      btn.title = 'Dictionnaire';
      btn.innerHTML = icon('dictionary');
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
#dict-popup { position: absolute; width: 440px; max-width: calc(100vw - 16px); max-height: 500px; overflow-y: auto; background: var(--bg); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); z-index: 600; padding: 16px 18px; font-size: 14px; color: var(--text); line-height: 1.5; }
.dict-section { font-size: 11px; font-weight: 600; color: var(--text2); text-transform: uppercase; padding: 8px 0 4px !important; border-top: 1px solid var(--border); margin-top: 6px; }
.dict-section:first-child { border-top: none; margin-top: 0; padding-top: 0; }
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
.dict-saved-note { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: var(--accent); }
.dict-action[data-act="close"] { margin-left: auto; min-width: 28px; padding: 4px 8px; }
.dict-lang { padding: 4px 8px; background: var(--bg2); color: var(--text); border: none; border-radius: var(--radius); font-family: inherit; font-size: 12px; height: 28px; box-shadow: inset 0 0 0 1px var(--border); cursor: pointer; }
.dict-link { color: var(--accent); text-decoration: none; font-size: 13px; }
.dict-link:hover { text-decoration: underline; }
.dict-more { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }

/* Modal mots enregistrés */
#dict-words-modal { position: fixed; inset: 0; z-index: 555; }
.dw-overlay { position: absolute; inset: 0; background: rgba(15,15,15,0.4); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
.dw-content { position: absolute; top: 5vh; left: 50%; transform: translateX(-50%); width: 90vw; max-width: 700px; height: 90vh; height: 90dvh; background: var(--bg); border-radius: var(--radius-lg); display: flex; flex-direction: column; box-shadow: var(--shadow-lg); overflow: hidden; }
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
.dw-actions { position: absolute; top: 8px; right: 8px; opacity: .55; transition: opacity .1s; }
.dw-card:hover .dw-actions { opacity: 1; }
.dw-del { background: transparent; border: none; color: var(--text3); cursor: pointer; padding: 4px 8px; border-radius: var(--radius); height: 28px; transition: background .1s; }
.dw-del:hover { background: rgba(224,62,62,0.12); color: var(--danger); }

@media (max-width: 600px) {
  .dw-content { width: 100vw; height: 100vh; height: 100dvh; top: 0; border-radius: 0; }
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
