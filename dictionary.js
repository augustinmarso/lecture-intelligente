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
  document.dispatchEvent(new CustomEvent('li:changed')); // synchro cloud différée
  return true;
}
function removeWord(word, lang) {
  let list = getSavedWords();
  list = list.filter(w => !(w.word === word && w.lang === lang));
  try { localStorage.setItem(DICT_SAVED_KEY, JSON.stringify(list)); } catch (_) {}
  document.dispatchEvent(new CustomEvent('li:changed'));
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
    else if (e.def && !took) { out.push({ pos: curPos, def: e.def.split(/\s+Note\s*:/)[0].trim() }); took = true; }
  }
  if (!out.length) { const d = entries.find(e => e.def); if (d) out.push({ pos: '', def: d.def }); }
  return out;
}

// =============================================================
// Explication simple par l'IA (si l'assistant IA est configuré) :
// reformule la définition du dictionnaire en langage courant.
// =============================================================
async function _aiSimplify(word, defsText, context) {
  if (!window.aiIsConfigured || !window.aiIsConfigured() || !window.aiCall) return null;
  const cache = _loadCache();
  const key = `simple::${_dictLang()}::${word.toLowerCase()}`;
  if (cache[key]) return cache[key];
  try {
    const r = await window.aiCall({
      // Micro-tâche → modèle le moins cher disponible (nano/haiku), pas le modèle principal
      model: window.aiCheapestModel ? window.aiCheapestModel() : undefined,
      system: 'Tu es un dictionnaire pédagogique en français. Tu expliques un mot en langage courant, très clair, compréhensible par un collégien, sans jargon ni mot plus compliqué que celui expliqué.',
      user: `Mot : « ${word} »\n${context ? `Phrase où le lecteur l'a rencontré : « ${context.slice(0, 160)} »\n` : ''}Définitions du dictionnaire :\n${defsText}\n\nExplique ce mot simplement (dans le sens de la phrase si elle est fournie).`,
      schema: {
        type: 'object',
        properties: {
          simple: { type: 'string', description: 'Explication en 1 à 2 phrases courtes, langage courant' },
          exemple: { type: 'string', description: 'Une phrase d\'exemple concrète du quotidien' }
        },
        required: ['simple', 'exemple'], additionalProperties: false
      },
      maxTokens: 300
    });
    if (r && r.simple) { cache[key] = r; _saveCache(); return r; }
  } catch (_) {}
  return null;
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
let _dictReq = 0; // jeton anti-course : seul le dernier mot cliqué remplit le popup

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

  // Jeton de requête : si un autre mot est cliqué entre-temps, on n'écrase pas son popup
  const reqId = ++_dictReq;
  const data = await fetchDefinition(word);
  if (_dictPopup !== popup || popup.style.display === 'none' || reqId !== _dictReq) return;

  // On ne place rien automatiquement : on propose d'ajouter le mot à
  // « Mes mots » (liste locale + deck Anki) via un bouton, au choix.
  const defText = _definitionToText(word, data);
  // Le verso Anki est mutable : l'explication simple de l'IA s'y ajoute quand elle arrive
  const defHolder = { text: defText };
  const w = word.toLowerCase();
  const already = getSavedWords().some(x => x.word === w && x.lang === _dictLang());
  const addBtn = (data && defText)
    ? `<button class="dict-action ${already ? 'saved' : ''}" data-act="add"${already ? ' disabled' : ''}>${already ? icon('check', 14) + ' Dans Mes mots' : icon('style', 14) + ' Ajouter à Mes mots'}</button>`
    : '';
  popup.innerHTML = `
    ${_renderDef(word, data)}
    <div class="dict-footer">
      ${addBtn}
      <select class="dict-lang" title="Langue du dictionnaire">
        <option value="fr"${_dictLang()==='fr'?' selected':''}>Français</option>
        <option value="en"${_dictLang()==='en'?' selected':''}>English</option>
        <option value="es"${_dictLang()==='es'?' selected':''}>Español</option>
        <option value="de"${_dictLang()==='de'?' selected':''}>Deutsch</option>
        <option value="it"${_dictLang()==='it'?' selected':''}>Italiano</option>
      </select>
      <button class="dict-action" data-act="side" title="Ouvrir sur le côté (garde la lecture visible)">${icon('dock_to_right', 14)} Côté</button>
      <button class="dict-action" data-act="split" title="Ouvrir en 2 volets (mot | définition)">${icon('splitscreen', 14)} 2 volets</button>
      <button class="dict-action" data-act="close">✕</button>
    </div>
  `;

  popup.querySelector('[data-act="close"]').onclick = _hidePopup;
  const splitEl = popup.querySelector('[data-act="split"]');
  if (splitEl) splitEl.onclick = () => { showWordSplitView(word, defHolder.text, context); _hidePopup(); };
  const sideEl = popup.querySelector('[data-act="side"]');
  if (sideEl) sideEl.onclick = () => { showWordSidePanel(word, defHolder.text, context); _hidePopup(); };
  const addEl = popup.querySelector('[data-act="add"]');
  if (addEl) addEl.onclick = () => {
    if (!getSavedWords().some(x => x.word === w && x.lang === _dictLang())) saveWord(w, defHolder.text, context);
    addEl.disabled = true;
    addEl.classList.add('saved');
    addEl.innerHTML = icon('check', 14) + ' Ajouté à Mes mots';
    _sendWordToAnki(word, defHolder.text); // envoi Anki seulement maintenant, sur demande
  };
  popup.querySelector('.dict-lang').onchange = async (e) => {
    _dictSetLang(e.target.value);
    await showDefinitionPopup(word, rect, context);
  };

  // Explication simple (IA) en tête de popup, si l'assistant est configuré
  if (data && defText && window.aiIsConfigured && window.aiIsConfigured()) {
    const head = popup.querySelector('.dict-head');
    if (head) {
      const box = document.createElement('div');
      box.className = 'dict-simple';
      box.innerHTML = `<span class="dict-simple-tag">${icon('lightbulb', 13)} En clair</span> <em class="dict-simple-wait">réflexion…</em>`;
      head.insertAdjacentElement('afterend', box);
      _aiSimplify(word, defText, context).then(r => {
        if (reqId !== _dictReq || !box.isConnected) return;
        if (!r) { box.remove(); return; }
        box.innerHTML = `<span class="dict-simple-tag">${icon('lightbulb', 13)} En clair</span> ${_esc(r.simple)}${r.exemple ? `<div class="dict-simple-ex">Ex. : ${_esc(r.exemple)}</div>` : ''}`;
        // L'explication simple devient la première ligne du verso Anki
        defHolder.text = `En clair : ${r.simple}${r.exemple ? `\nExemple : ${r.exemple}` : ''}\n\n${defText}`;
      });
    }
  }
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
  if (e.key !== 'Escape') return;
  const side = document.getElementById('dict-side');
  if (side) { side.remove(); return; }
  const split = document.getElementById('dict-split');
  if (split) { split.remove(); return; }
  _hidePopup();
});

// =============================================================
// Vue « Mes mots » intégrée aux onglets de la bibliothèque
// (Mes fiches · Mes livres · Mes mots · Cartes Anki)
// =============================================================
function openWords() {
  const modal = document.getElementById('lib-modal');
  if (modal) modal.classList.add('open');
  renderWordsView();
  // Remplir la page avec les mots déjà enregistrés dans le deck Anki « Mes mots »
  if (window.ankiPullWords) {
    window.ankiPullWords().then(n => { if (n) renderWordsView(); }).catch(() => {});
  }
}
function renderWordsView() {
  const body = document.getElementById('lib-body');
  if (!body) return;
  const list = getSavedWords();
  body.innerHTML = `
    <div class="notes-toolbar">
      ${window.liTabs ? window.liTabs('words') : ''}
    </div>
    <div class="notes-list">
      ${list.length === 0
        ? `<div class="lib-empty">Aucun mot enregistré.<br><br>Clique sur un mot dans un PDF ou EPUB&nbsp;: sa définition s'affiche, puis « Ajouter à Mes mots ».</div>`
        : list.map(w => `
          <div class="note-card dw-card" data-word="${_esc(w.word)}" data-lang="${_esc(w.lang)}">
            <div class="note-header"><strong>${_esc(w.word)}</strong><small>${_esc(w.lang)} · ${new Date(w.savedAt).toLocaleDateString('fr-FR')}</small></div>
            <div class="dw-def">${_esc(w.definition || '—')}</div>
            ${w.context ? `<div class="dw-ctx">« …${_esc(w.context)}… »</div>` : ''}
            <div class="note-actions">
              <button class="lib-action" data-act="side-word" title="Ouvrir sur le côté">${icon('dock_to_right', 15)} Côté</button>
              <button class="lib-action" data-act="split-word" title="Ouvrir en 2 volets">${icon('splitscreen', 15)} 2 volets</button>
              <button class="lib-action lib-del" data-act="del-word">${icon('delete', 15)}</button>
            </div>
          </div>`).join('')}
    </div>`;
  if (window.liWireTabs) window.liWireTabs(body);
  body.querySelectorAll('[data-act="del-word"]').forEach(b => {
    b.onclick = () => {
      const card = b.closest('.dw-card');
      removeWord(card.dataset.word, card.dataset.lang);
      renderWordsView();
    };
  });
  body.querySelectorAll('[data-act="split-word"]').forEach(b => {
    b.onclick = () => {
      const card = b.closest('.dw-card');
      const wobj = getSavedWords().find(x => x.word === card.dataset.word && x.lang === card.dataset.lang);
      if (wobj) showWordSplitView(wobj.word, wobj.definition, wobj.context);
    };
  });
  body.querySelectorAll('[data-act="side-word"]').forEach(b => {
    b.onclick = () => {
      const card = b.closest('.dw-card');
      const wobj = getSavedWords().find(x => x.word === card.dataset.word && x.lang === card.dataset.lang);
      if (wobj) showWordSidePanel(wobj.word, wobj.definition, wobj.context);
    };
  });
}
window.openWords = openWords;
window.renderWordsView = renderWordsView;

// =============================================================
// Vue « 2 volets » : le popup passe en page séparée, mot | définition
// =============================================================
function showWordSplitView(word, def, context) {
  const old = document.getElementById('dict-split');
  if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'dict-split';
  el.innerHTML = `
    <button class="dsp-close" title="Fermer (Échap)">✕</button>
    <div class="dsp-pane dsp-word">
      <div class="dsp-word-main">${_esc(word)}</div>
      ${context ? `<div class="dsp-ctx">« …${_esc(context)}… »</div>` : ''}
    </div>
    <div class="dsp-pane dsp-def">
      <div class="dsp-label">Définition</div>
      <div class="dsp-def-text">${_esc(def || '—')}</div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.dsp-close').onclick = () => el.remove();
  el.onclick = (e) => { if (e.target === el) el.remove(); }; // clic hors volets = fermer
}
window.showWordSplitView = showWordSplitView;

// Panneau latéral : la définition se cale sur le bord droit, la lecture reste
// visible à côté (ne se ferme pas au clic ailleurs → on peut lire en même temps).
function showWordSidePanel(word, def, context) {
  const old = document.getElementById('dict-side');
  if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'dict-side';
  el.innerHTML = `
    <div class="dsi-head">
      <strong class="dsi-word">${_esc(word)}</strong>
      <button class="dsi-close" title="Fermer (Échap)">✕</button>
    </div>
    <div class="dsi-body">
      ${context ? `<div class="dsi-ctx">« …${_esc(context)}… »</div>` : ''}
      <div class="dsi-label">Définition</div>
      <div class="dsi-def">${_esc(def || '—')}</div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.dsi-close').onclick = () => el.remove();
}
window.showWordSidePanel = showWordSidePanel;

// (Bouton top-bar « Mes mots » supprimé : accessible via l'onglet « Mes mots »
// de la bibliothèque — liens texte de la barre du haut.)

// =============================================================
// Styles — cohérent style Notion
// =============================================================
const _dictStyle = document.createElement('style');
_dictStyle.textContent = `
/* Popup définition */
#dict-popup { position: absolute; width: 440px; max-width: calc(100vw - 16px); max-height: 500px; overflow-y: auto; background: var(--bg); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); z-index: 540; padding: 16px 18px; font-size: 14px; color: var(--text); line-height: 1.5; }
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
.dict-more { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.dict-simple { margin: 2px 0 10px; padding: 10px 12px; background: color-mix(in srgb, var(--accent) 8%, transparent); border-radius: var(--radius); font-size: 14px; line-height: 1.55; color: var(--text); }
.dict-simple-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--accent); margin-right: 4px; }
.dict-simple-wait { color: var(--text2); font-size: 13px; }
.dict-simple-ex { margin-top: 4px; font-size: 12.5px; color: var(--text2); font-style: italic; }

/* Cartes de la vue « Mes mots » (+ compteur réutilisé par anki.js) */
.dw-count { font-size: 11px; color: var(--text2); padding: 1px 8px; background: var(--bg3); border-radius: 3px; font-weight: 500; }
.dw-card { padding: 12px 14px; border-radius: var(--radius); margin-bottom: 2px; position: relative; transition: background .1s; }
.dw-card:hover { background: var(--hover); }
.dw-def { font-size: 13px; color: var(--text); line-height: 1.55; }
.dw-ctx { margin-top: 6px; font-size: 12px; color: var(--text2); font-style: italic; }

/* Vue « 2 volets » : mot | définition en page séparée */
#dict-split { position: fixed; inset: 0; z-index: 640; display: flex; background: var(--bg); animation: dsFade .16s ease; }
@keyframes dsFade { from { opacity: 0; } to { opacity: 1; } }
.dsp-pane { flex: 1; min-width: 0; overflow-y: auto; padding: clamp(24px, 5vw, 64px); display: flex; flex-direction: column; justify-content: center; }
.dsp-word { align-items: center; text-align: center; background: var(--bg2); border-right: 1px solid var(--border); gap: 18px; }
.dsp-word-main { font-family: 'Newsreader', Georgia, serif; font-weight: 600; font-size: clamp(34px, 6vw, 64px); color: var(--text); line-height: 1.15; word-break: break-word; }
.dsp-ctx { font-size: 14px; color: var(--text2); font-style: italic; line-height: 1.6; max-width: 420px; }
.dsp-def { justify-content: flex-start; }
.dsp-label { font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--text3); margin-bottom: 14px; }
.dsp-def-text { font-size: clamp(15px, 2vw, 19px); line-height: 1.7; color: var(--text); white-space: pre-wrap; }
.dsp-close { position: fixed; top: 14px; right: 16px; z-index: 2; background: var(--bg3); border: none; width: 38px; height: 38px; border-radius: 50%; font-size: 16px; cursor: pointer; color: var(--text2); box-shadow: var(--shadow, 0 1px 3px rgba(0,0,0,.15)); transition: background .1s, color .1s; }
.dsp-close:hover { background: var(--hover-strong); color: var(--text); }

/* Panneau latéral : la définition calée sur le bord droit */
#dict-side { position: fixed; top: 0; right: 0; height: 100vh; height: 100dvh; width: min(360px, 92vw); z-index: 620; background: var(--bg); border-left: 1px solid var(--border2); box-shadow: -8px 0 28px rgba(40,30,20,.18); display: flex; flex-direction: column; animation: dsiSlide .18s ease; }
@keyframes dsiSlide { from { transform: translateX(100%); } to { transform: translateX(0); } }
.dsi-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border); background: var(--bg2); }
.dsi-word { font-family: 'Newsreader', Georgia, serif; font-size: 22px; font-weight: 600; color: var(--text); line-height: 1.2; word-break: break-word; }
.dsi-close { background: transparent; border: none; font-size: 16px; cursor: pointer; color: var(--text2); width: 30px; height: 30px; border-radius: var(--radius); flex-shrink: 0; transition: background .1s; }
.dsi-close:hover { background: var(--hover); color: var(--text); }
.dsi-body { flex: 1; overflow-y: auto; padding: 16px; }
.dsi-ctx { font-size: 13px; color: var(--text2); font-style: italic; line-height: 1.6; margin-bottom: 14px; }
.dsi-label { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text3); margin-bottom: 8px; }
.dsi-def { font-size: 15px; line-height: 1.65; color: var(--text); white-space: pre-wrap; }

@media (max-width: 600px) {
  #dict-popup { width: calc(100vw - 16px); }
  /* En 2 volets empilés verticalement sur mobile */
  #dict-split { flex-direction: column; }
  .dsp-word { border-right: none; border-bottom: 1px solid var(--border); }
  .dsp-pane { justify-content: flex-start; padding: 28px 20px; }
  .dsp-word { padding-top: 56px; }
}
`;
document.head.appendChild(_dictStyle);

