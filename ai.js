// =============================================================
// ai.js — Assistant IA (API Claude directement depuis le
// navigateur, clé stockée en local). Propose des idées quand on
// bloque : objectif PPU, question de lecture, synthèse, action.
// Fournit aussi la génération de cartes Anki (utilisée par anki.js).
// =============================================================

const AI_STORE_KEY = 'li-ai';
const LM_STUDIO_DEFAULT_URL = 'http://localhost:1234/v1';
const AI_DEFAULTS = { keys: { anthropic: '', openai: '' }, model: 'claude-haiku-4-5', localUrl: LM_STUDIO_DEFAULT_URL, localModel: '' };

// Catalogue des modèles proposés (le fournisseur est déduit du modèle choisi)
const AI_MODELS = {
  'qwen-local':        { provider: 'local',     label: 'LM Studio — modèle local (gratuit)' },
  'gpt-4.1-nano':      { provider: 'openai',    label: 'GPT-4.1 nano (ultra éco)' },
  'claude-haiku-4-5':  { provider: 'anthropic', label: 'Claude Haiku 4.5 (éco)' },
  'claude-opus-4-8':   { provider: 'anthropic', label: 'Claude Opus 4.8 (qualité)' },
  'gpt-4.1-mini':      { provider: 'openai',    label: 'GPT-4.1 mini (éco)' },
  'gpt-4.1':           { provider: 'openai',    label: 'GPT-4.1 (qualité)' },
  'gpt-5.4-nano':      { provider: 'openai',    label: 'GPT-5.4 nano (raisonne, éco)' },
  'gpt-5.4-mini':      { provider: 'openai',    label: 'GPT-5.4 mini (raisonne)' },
  'gpt-5.4':           { provider: 'openai',    label: 'GPT-5.4 (raisonne, qualité)' },
  'gpt-5.5':           { provider: 'openai',    label: 'GPT-5.5 (max)' }
};
const AI_PROVIDER_LABELS = { anthropic: 'Claude', openai: 'OpenAI', local: 'LM Studio' };

function _aiSettings() {
  let s;
  try { s = JSON.parse(localStorage.getItem(AI_STORE_KEY) || '{}'); } catch (_) { s = {}; }
  // Migration de l'ancien format { key, model } (clé unique Claude)
  if (s.key && !s.keys) s.keys = { anthropic: s.key, openai: '' };
  s.keys = Object.assign({}, AI_DEFAULTS.keys, s.keys || {});
  if (!s.model || !AI_MODELS[s.model]) s.model = AI_DEFAULTS.model;
  if (!s.localUrl) s.localUrl = LM_STUDIO_DEFAULT_URL;
  if (typeof s.localModel !== 'string') s.localModel = '';
  return s;
}
function _aiSave(patch) {
  const s = _aiSettings();
  if (patch.keys) patch.keys = Object.assign({}, s.keys, patch.keys);
  localStorage.setItem(AI_STORE_KEY, JSON.stringify(Object.assign(s, patch)));
}
function _aiProvider(model) { return (AI_MODELS[model] || {}).provider || (String(model).startsWith('gpt') ? 'openai' : 'anthropic'); }
function aiIsConfigured() {
  const s = _aiSettings();
  const p = _aiProvider(s.model);
  if (p === 'local') return true; // LM Studio : pas de clé, juste le serveur local
  return !!s.keys[p];
}

function _escAi(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// --- Appel API (fetch direct navigateur : app statique sans build,
// pas de SDK npm). Route vers Claude ou OpenAI selon le modèle choisi. ---
const AI_DEFAULT_SYSTEM = 'Tu es un assistant de lecture active en français. Réponds de façon concrète et concise.';

async function _aiHttp(url, headers, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, headers),
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    let msg = 'Erreur API (' + resp.status + ')';
    try { const j = await resp.json(); if (j.error && j.error.message) msg = j.error.message; } catch (_) {}
    if (resp.status === 401) msg = 'Clé API invalide — vérifie-la dans les réglages IA';
    if (resp.status === 429) msg = 'Limite de requêtes atteinte — réessaie dans une minute';
    throw new Error(msg);
  }
  return resp.json();
}

function _aiParse(text, schema) {
  if (!schema) return text;
  try { return JSON.parse(text); }
  catch (e) { throw new Error('Réponse IA illisible — réessaie'); }
}

async function aiCall({ system, user, schema, maxTokens, model: modelOverride }) {
  const s = _aiSettings();
  // Un appel peut imposer son modèle (ex : dictionnaire → modèle ultra éco),
  // à condition d'avoir la clé du fournisseur correspondant.
  let model = s.model;
  if (modelOverride && AI_MODELS[modelOverride]) {
    const op = _aiProvider(modelOverride);
    if (op === 'local' || s.keys[op]) model = modelOverride; // local = sans clé
  }
  const provider = _aiProvider(model);
  const key = s.keys[provider];
  if (provider !== 'local' && !key) throw new Error(`Clé API ${AI_PROVIDER_LABELS[provider]} manquante — configure-la dans les Paramètres (barre « Assistant IA »)`);

  // Modèle local via LM Studio (API compatible OpenAI, aucune clé requise)
  if (provider === 'local') {
    const base = (s.localUrl || LM_STUDIO_DEFAULT_URL).replace(/\/+$/, '');
    let lmModel = s.localModel;
    if (!lmModel) {
      try {
        const r = await fetch(base + '/models');
        const j = await r.json();
        lmModel = (j.data && j.data[0] && j.data[0].id) || 'local-model';
      } catch (_) { lmModel = 'local-model'; }
    }
    const body = {
      model: lmModel,
      max_tokens: maxTokens || 2000,
      temperature: 0.7,
      messages: [
        { role: 'system', content: system || AI_DEFAULT_SYSTEM },
        { role: 'user', content: user }
      ]
    };
    if (schema) body.response_format = { type: 'json_schema', json_schema: { name: 'reponse', strict: true, schema } };
    let data;
    try {
      data = await _aiHttp(base + '/chat/completions', {}, body);
    } catch (e) {
      throw new Error('LM Studio injoignable — lance LM Studio, charge un modèle Qwen puis démarre le serveur local (onglet « Developer », port 1234).');
    }
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error('Réponse du modèle local vide — réessaie');
    return _aiParse(msg.content || '', schema);
  }

  if (provider === 'openai') {
    // Les GPT-5.x raisonnent (paramètre reasoning_effort + marge de tokens) ;
    // les GPT-4.1 non — leur envoyer reasoning_effort déclencherait une erreur.
    const isReasoning = /^gpt-5/.test(model);
    const body = {
      model,
      max_completion_tokens: (maxTokens || 2000) + (isReasoning ? 1500 : 0),
      messages: [
        { role: 'system', content: system || AI_DEFAULT_SYSTEM },
        { role: 'user', content: user }
      ]
    };
    if (isReasoning) body.reasoning_effort = 'low';
    if (schema) body.response_format = { type: 'json_schema', json_schema: { name: 'reponse', strict: true, schema } };
    const data = await _aiHttp('https://api.openai.com/v1/chat/completions', { authorization: 'Bearer ' + key }, body);
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error('Réponse API vide — réessaie');
    if (msg.refusal) throw new Error('Requête refusée par l\'API');
    return _aiParse(msg.content || '', schema);
  }

  // Anthropic (Claude)
  const body = {
    model,
    max_tokens: maxTokens || 2000,
    system: system || AI_DEFAULT_SYSTEM,
    messages: [{ role: 'user', content: user }]
  };
  if (schema) body.output_config = { format: { type: 'json_schema', schema } };
  const data = await _aiHttp('https://api.anthropic.com/v1/messages', {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  }, body);
  if (data.stop_reason === 'refusal') throw new Error('Requête refusée par l\'API');
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  return _aiParse(text, schema);
}
window.aiCall = aiCall;
window.aiIsConfigured = aiIsConfigured;

// Modèle le moins cher parmi les fournisseurs dont une clé est configurée
// (pour les micro-tâches : GPT-4.1 nano ~0,10 $/M, sinon Haiku ~1 $/M).
function aiCheapestModel() {
  const s = _aiSettings();
  if (_aiProvider(s.model) === 'local') return s.model; // local = gratuit, on l'utilise pour tout
  if (s.keys.openai) return 'gpt-4.1-nano';
  if (s.keys.anthropic) return 'claude-haiku-4-5';
  return s.model;
}
window.aiCheapestModel = aiCheapestModel;

// --- Contexte du livre pour les prompts ---
function _bookContext() {
  const st = window.state || {};
  const lines = [];
  if (st.bookTitle) lines.push('Livre : ' + st.bookTitle);
  if (st.bookAuthor) lines.push('Auteur : ' + st.bookAuthor);
  if (st.chapterTitle) lines.push('Chapitre : ' + st.chapterTitle);
  if (st.ppu && st.ppu.precis) lines.push('Objectif du lecteur : ' + st.ppu.precis);
  if (st.ppu && st.ppu.perso) lines.push('Motivation personnelle : ' + st.ppu.perso);
  if (st.lecture && st.lecture.question) lines.push('Question de lecture : ' + st.lecture.question);
  const cites = (st.highlights || []).slice(0, 12).map(h => `- (p.${h.page}) « ${h.text.slice(0, 300)} »`);
  if (cites.length) lines.push('Passages surlignés pendant la lecture :\n' + cites.join('\n'));
  const syn = (st.synthese || []).filter(x => x && x.trim());
  if (syn.length) lines.push('Idées déjà notées dans la synthèse :\n' + syn.map((x, i) => `${i + 1}. ${x}`).join('\n'));
  return lines.join('\n');
}

// --- Suggestions par écran ---
const AI_SCREENS = {
  ppu: {
    detect: () => document.getElementById('ppu-perso'),
    title: 'Idées d\'objectif PPU',
    schema: {
      type: 'object',
      properties: { suggestions: { type: 'array', items: {
        type: 'object',
        properties: { perso: { type: 'string' }, precis: { type: 'string' }, utile: { type: 'string' } },
        required: ['perso', 'precis', 'utile'], additionalProperties: false
      } } },
      required: ['suggestions'], additionalProperties: false
    },
    prompt: (extra) => `${_bookContext()}\n\nPropose 3 objectifs de lecture PPU (Personnel, Précis, Utile) plausibles et différents pour ce livre. Chaque objectif : "perso" = pourquoi ce livre m'intéresse vraiment (1 phrase à la première personne), "precis" = une question concrète à résoudre, "utile" = quand et où l'appliquer.${extra ? '\nContrainte du lecteur : ' + extra : ''}`,
    render: (item) => `<strong>${_escAi(item.precis)}</strong><br><span>${_escAi(item.perso)}</span><br><span>${_escAi(item.utile)}</span>`,
    apply: (item) => {
      const st = window.state;
      st.ppu.perso = item.perso; st.ppu.precis = item.precis; st.ppu.utile = item.utile;
      window.render();
    }
  },
  lecture: {
    detect: () => document.getElementById('lec-q'),
    title: 'Idées de question de lecture',
    schema: {
      type: 'object',
      properties: { suggestions: { type: 'array', items: { type: 'string' } } },
      required: ['suggestions'], additionalProperties: false
    },
    prompt: (extra) => `${_bookContext()}\n\nPropose 4 questions de lecture actives, courtes et concrètes, que le lecteur peut garder en tête pendant sa lecture pour rester engagé et répondre à son objectif.${extra ? '\nContrainte du lecteur : ' + extra : ''}`,
    render: (item) => `<span>${_escAi(item)}</span>`,
    apply: (item) => {
      window.state.lecture.question = item;
      window.render();
    }
  },
  synthese: {
    detect: () => document.querySelector('.syn-input'),
    title: 'Pistes pour ta synthèse',
    schema: {
      type: 'object',
      properties: { suggestions: { type: 'array', items: { type: 'string' } } },
      required: ['suggestions'], additionalProperties: false
    },
    prompt: (extra) => `${_bookContext()}\n\nLe lecteur doit formuler 5 idées clés avec ses propres mots (synthèse). Propose 5 pistes de reformulation en t'appuyant en priorité sur ses passages surlignés et son objectif. Chaque piste : 1 à 2 phrases claires, à la première personne quand c'est pertinent. Ne recopie pas les citations mot à mot — reformule. N'utilise pas les idées déjà notées.${extra ? '\nContrainte du lecteur : ' + extra : ''}`,
    render: (item) => `<span>${_escAi(item)}</span>`,
    apply: (item) => {
      const st = window.state;
      const idx = st.synthese.findIndex(x => !x || !x.trim());
      if (idx === -1) { if (window.showToast) window.showToast('Les 5 idées sont déjà remplies'); return; }
      st.synthese[idx] = item;
      window.render();
    }
  },
  action: {
    detect: () => document.getElementById('act-conseil'),
    title: 'Idées d\'action à tester',
    schema: {
      type: 'object',
      properties: { suggestions: { type: 'array', items: {
        type: 'object',
        properties: { conseil: { type: 'string' }, quand: { type: 'string' }, deadline: { type: 'string' } },
        required: ['conseil', 'quand', 'deadline'], additionalProperties: false
      } } },
      required: ['suggestions'], additionalProperties: false
    },
    prompt: (extra) => `${_bookContext()}\n\nPropose 4 actions simples et immédiatement testables tirées de cette lecture. Chaque action : "conseil" = l'action la plus simple à tester tout de suite, "quand" = un moment concret pour commencer, "deadline" = un délai réaliste pour faire le bilan.${extra ? '\nContrainte du lecteur : ' + extra : ''}`,
    render: (item) => `<strong>${_escAi(item.conseil)}</strong><br><span>${_escAi(item.quand)} · bilan : ${_escAi(item.deadline)}</span>`,
    apply: (item) => {
      const st = window.state;
      st.action.conseil = item.conseil; st.action.quand = item.quand; st.action.deadline = item.deadline;
      window.render();
    }
  }
};

// --- Popup de suggestions ---
let _aiPopup = null;
let _aiLastItems = [];
let _aiCurrentScreen = null;

function _ensureAiPopup() {
  if (_aiPopup) return _aiPopup;
  _aiPopup = document.createElement('div');
  _aiPopup.id = 'ai-popup';
  _aiPopup.innerHTML = `
    <div class="ai-overlay"></div>
    <div class="ai-panel">
      <div class="ai-head">
        <h4 id="ai-title">${icon('lightbulb', 16)} Suggestions</h4>
        <button class="ai-close" title="Fermer">✕</button>
      </div>
      <div class="ai-body" id="ai-body"></div>
      <div class="ai-foot">
        <input id="ai-extra" type="text" placeholder="Préciser (facultatif) : « plutôt orienté travail », « plus simple »…"/>
        <button id="ai-regen" class="gd-btn">${icon('refresh', 15)} Regénérer</button>
      </div>
    </div>`;
  document.body.appendChild(_aiPopup);
  _aiPopup.querySelector('.ai-close').onclick = () => _aiPopup.classList.remove('open');
  _aiPopup.querySelector('.ai-overlay').onclick = () => _aiPopup.classList.remove('open');
  _aiPopup.querySelector('#ai-regen').onclick = () => {
    if (_aiCurrentScreen) _runAiSuggest(_aiCurrentScreen, document.getElementById('ai-extra').value.trim());
  };
  _aiPopup.querySelector('#ai-extra').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && _aiCurrentScreen) _runAiSuggest(_aiCurrentScreen, e.target.value.trim());
  });
  return _aiPopup;
}

async function _runAiSuggest(screenKey, extra) {
  const screen = AI_SCREENS[screenKey];
  const pop = _ensureAiPopup();
  _aiCurrentScreen = screenKey;
  pop.classList.add('open');
  pop.querySelector('#ai-title').innerHTML = `${icon('lightbulb', 16)} ${screen.title}`;
  const body = pop.querySelector('#ai-body');

  if (!aiIsConfigured()) {
    body.innerHTML = `<div class="ai-empty">Aucune clé API configurée.<br><br>Ouvre la bibliothèque (${icon('library_books', 14)} en haut) et colle ta clé dans la barre « Assistant IA ».<br>La clé reste sur ton ordinateur (localStorage).</div>`;
    return;
  }
  body.innerHTML = `<div class="ai-empty">${icon('hourglass_top', 14)} Réflexion en cours…</div>`;
  try {
    const result = await aiCall({
      system: 'Tu es un coach de lecture active en français. Tu aides un étudiant à formuler ses propres idées — tes propositions sont des points de départ, pas des réponses définitives. Style direct, concret, sans jargon.',
      user: screen.prompt(extra || ''),
      schema: screen.schema,
      maxTokens: 1500
    });
    _aiLastItems = result.suggestions || [];
    if (_aiLastItems.length === 0) { body.innerHTML = '<div class="ai-empty">Aucune suggestion — réessaie.</div>'; return; }
    body.innerHTML = _aiLastItems.map((item, i) => `
      <div class="ai-card">
        <div class="ai-card-text">${screen.render(item)}</div>
        <div class="ai-card-actions">
          <button class="gd-btn ai-use" data-i="${i}">${icon('check', 15)} Utiliser</button>
          ${window.ankiQuickAdd ? `<button class="gd-btn ai-anki" data-i="${i}" title="Créer une carte Anki avec cette idée">${icon('style', 15)} Anki</button>` : ''}
        </div>
      </div>`).join('');
    body.querySelectorAll('.ai-use').forEach(btn => {
      btn.onclick = () => {
        const item = _aiLastItems[parseInt(btn.dataset.i)];
        screen.apply(item);
        _aiPopup.classList.remove('open');
        if (window.showToast) window.showToast('Suggestion appliquée — reformule-la avec tes mots');
      };
    });
    body.querySelectorAll('.ai-anki').forEach(btn => {
      btn.onclick = async () => {
        const item = _aiLastItems[parseInt(btn.dataset.i)];
        const text = typeof item === 'string' ? item : Object.values(item).join(' — ');
        const book = (window.state && window.state.bookTitle) || 'Lecture';
        await window.ankiQuickAdd(book + ' — quelle idée avais-tu retenue ici ?', text, book);
      };
    });
  } catch (e) {
    body.innerHTML = `<div class="ai-empty">${_escAi(e.message)}</div>`;
  }
}

// --- Génération de cartes Anki (utilisée par anki.js) ---
async function aiGenerateCards(note) {
  const parts = [];
  if (note.bookTitle) parts.push('Livre : ' + note.bookTitle + (note.bookAuthor ? ' — ' + note.bookAuthor : ''));
  if (note.chapterTitle) parts.push('Chapitre : ' + note.chapterTitle);
  if (note.objectif) parts.push('Objectif de lecture : ' + note.objectif);
  if (note.synthese && note.synthese.length) parts.push('Synthèse du lecteur :\n' + note.synthese.map((x, i) => `${i + 1}. ${x}`).join('\n'));
  if (note.action && note.action.conseil) parts.push('Action décidée : ' + note.action.conseil + (note.action.quand ? ' (' + note.action.quand + ')' : ''));
  const cites = (note.highlights || []).slice(0, 10).map(h => `- (p.${h.page}) « ${h.text.slice(0, 300)} »`);
  if (cites.length) parts.push('Citations surlignées :\n' + cites.join('\n'));

  const auteur = note.bookAuthor || `l'auteur de « ${note.bookTitle || note.title || 'ce livre'} »`;
  const result = await aiCall({
    system: `Tu crées des flashcards Anki en français pour la répétition espacée, sur le principe de la devinette : le recto pose une question qui présente l'idée ou la citation SANS la dévoiler, et le lecteur doit retrouver la réponse de mémoire. Format du recto : par défaut « Que pense ${auteur} de [sujet précis] ? », ou une autre question courte qui amène l'idée sans la révéler (« Que dit ${auteur} à propos de [sujet] ? », « Quelle image utilise ${auteur} pour parler de [sujet] ? », « Comment ${auteur} justifie-t-il [sujet] ? »…). Une seule idée ou citation par carte. Verso d'une IDÉE : la position de l'auteur en 1 à 3 phrases, à partir des mots du lecteur. Verso d'une CITATION : la citation EXACTE, mot pour mot entre guillemets, avec sa page — c'est elle que le lecteur doit deviner.`,
    user: parts.join('\n\n') + '\n\nCrée exactement UNE carte par idée de la synthèse (dans le même ordre) et UNE carte par citation surlignée — ne fusionne jamais deux idées ou deux citations dans la même carte. Recto = question devinette qui ne révèle pas la réponse, et SPÉCIFIQUE au contenu de sa carte : elle nomme le sujet exact de l\'idée ou de la citation (jamais une question générique) — en lisant le recto seul, on doit savoir de quelle idée précise il s\'agit. Verso = l\'idée reformulée, ou la citation exacte à deviner.',
    schema: {
      type: 'object',
      properties: { cards: { type: 'array', items: {
        type: 'object',
        properties: { recto: { type: 'string' }, verso: { type: 'string' } },
        required: ['recto', 'verso'], additionalProperties: false
      } } },
      required: ['cards'], additionalProperties: false
    },
    maxTokens: 4000
  });
  return result.cards || [];
}
window.aiGenerateCards = aiGenerateCards;

// --- Bouton "Idées IA" injecté sur les écrans concernés ---
function _injectAiButtons() {
  const obs = new MutationObserver(() => {
    const app = document.getElementById('app');
    if (!app) return;
    for (const key of Object.keys(AI_SCREENS)) {
      const anchor = AI_SCREENS[key].detect();
      if (!anchor) continue;
      const why = app.querySelector('.step-why');
      if (!why || why.dataset.aiWired) return;
      why.dataset.aiWired = '1';
      const btn = document.createElement('button');
      btn.className = 'ai-suggest-btn';
      btn.type = 'button';
      btn.innerHTML = icon('lightbulb', 15) + ' Je bloque — donne-moi des idées';
      btn.onclick = () => _runAiSuggest(key, '');
      why.insertAdjacentElement('afterend', btn);
      return;
    }
  });
  obs.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
}

// Liste les modèles chargés dans LM Studio (API compatible OpenAI : GET /v1/models)
async function _lmStudioModels() {
  const s = _aiSettings();
  const base = (s.localUrl || LM_STUDIO_DEFAULT_URL).replace(/\/+$/, '');
  const r = await fetch(base + '/models');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return (j.data || []).map(m => m.id).filter(Boolean);
}

// Remplit le sélecteur avec N'IMPORTE QUEL modèle chargé dans LM Studio.
let _lmPopulating = false;
async function _populateLocalModels(opts) {
  opts = opts || {};
  const sel = document.getElementById('ai-local-model');
  const status = document.getElementById('ai-status');
  if (!sel || _lmPopulating) return;
  _lmPopulating = true;
  try {
    let models = [];
    try { models = await _lmStudioModels(); }
    catch (_) {
      sel.innerHTML = '<option value="">(LM Studio non démarré)</option>';
      if (status) { status.textContent = 'LM Studio injoignable — démarre le serveur (port 1234)'; status.classList.remove('connected'); }
      if (opts.notify && window.showToast) window.showToast('LM Studio injoignable — ouvre LM Studio → Developer → Start Server');
      return;
    }
    if (!models.length) {
      sel.innerHTML = '<option value="">(aucun modèle chargé)</option>';
      if (status) { status.textContent = 'LM Studio lancé, aucun modèle chargé'; status.classList.remove('connected'); }
      if (opts.notify && window.showToast) window.showToast('LM Studio est lancé mais aucun modèle n\'est chargé');
      return;
    }
    const s = _aiSettings();
    const chosen = models.includes(s.localModel) ? s.localModel : models[0];
    sel.innerHTML = models.map(m => `<option value="${_escAi(m)}"${chosen === m ? ' selected' : ''}>${_escAi(m)}</option>`).join('');
    if (chosen !== s.localModel) _aiSave({ localModel: chosen });
    if (status) { status.textContent = 'LM Studio · ' + chosen; status.classList.add('connected'); }
    if (opts.notify && window.showToast) window.showToast(models.length + ' modèle(s) LM Studio détecté(s)');
  } finally { _lmPopulating = false; }
}

// --- Barre de configuration dans le modal bibliothèque ---
function _renderAiBar() {
  const status = document.getElementById('ai-status');
  if (!status) return;
  const s = _aiSettings();
  const provider = _aiProvider(s.model);
  const keyInput = document.getElementById('ai-key');
  const localSel = document.getElementById('ai-local-model');
  const detectBtn = document.getElementById('ai-local-detect');
  if (provider === 'local') {
    // Modèle local : pas de clé. Le champ clé sert à l'URL du serveur LM Studio,
    // et un sélecteur liste N'IMPORTE QUEL modèle chargé dans LM Studio.
    if (keyInput) {
      keyInput.type = 'text';
      keyInput.value = s.localUrl && s.localUrl !== LM_STUDIO_DEFAULT_URL ? s.localUrl : '';
      keyInput.placeholder = 'URL LM Studio (' + LM_STUDIO_DEFAULT_URL + ')';
    }
    if (localSel) localSel.style.display = '';
    if (detectBtn) detectBtn.style.display = '';
    status.textContent = s.localModel ? ('LM Studio · ' + s.localModel) : 'LM Studio — clique « Détecter »';
    status.classList.toggle('connected', !!s.localModel);
    _populateLocalModels({}); // liste les modèles chargés (silencieux)
    return;
  }
  if (localSel) localSel.style.display = 'none';
  if (detectBtn) detectBtn.style.display = 'none';
  if (s.keys[provider]) {
    status.textContent = (AI_MODELS[s.model] || { label: s.model }).label;
    status.classList.add('connected');
  } else {
    status.textContent = `Clé ${AI_PROVIDER_LABELS[provider]} manquante`;
    status.classList.remove('connected');
  }
  // Le champ clé affiche/enregistre la clé du fournisseur du modèle choisi
  if (keyInput) {
    keyInput.type = 'password';
    keyInput.value = s.keys[provider] || '';
    keyInput.placeholder = provider === 'openai' ? 'Clé API OpenAI (sk-…)' : 'Clé API Claude (sk-ant-…)';
  }
}

function _injectAiBar() {
  const _doInject = () => {
    const slot = document.getElementById('li-set-ai');
    if (!slot || slot.dataset.wired || document.querySelector('.ai-bar')) return;
    slot.dataset.wired = '1';

    const s = _aiSettings();
    const groups = { local: [], openai: [], anthropic: [] };
    Object.entries(AI_MODELS).forEach(([id, m]) => {
      groups[m.provider].push(`<option value="${id}" ${s.model === id ? 'selected' : ''}>${m.label}</option>`);
    });
    const bar = document.createElement('div');
    bar.className = 'vault-bar ai-bar';
    bar.innerHTML = `
      <div class="vault-left">
        <strong>${icon('lightbulb', 14)} Assistant IA</strong>
        <span id="ai-status" class="vault-status">Aucune clé API</span>
      </div>
      <div class="vault-actions">
        <select id="ai-model" title="Modèle utilisé">
          <optgroup label="Local (gratuit)">${groups.local.join('')}</optgroup>
          <optgroup label="OpenAI">${groups.openai.join('')}</optgroup>
          <optgroup label="Claude">${groups.anthropic.join('')}</optgroup>
        </select>
        <input id="ai-key" type="password" placeholder="Clé API"/>
        <select id="ai-local-model" title="Modèle chargé dans LM Studio" style="display:none"></select>
        <button id="ai-local-detect" class="gd-btn" title="Détecter les modèles chargés dans LM Studio" style="display:none">${icon('refresh', 15)} Détecter</button>
        <button id="ai-test" class="gd-btn" title="Enregistrer et tester">${icon('check', 15)} Tester</button>
      </div>
    `;
    slot.appendChild(bar);
    const _saveKey = () => {
      const st = _aiSettings();
      const provider = _aiProvider(st.model);
      const val = document.getElementById('ai-key').value.trim();
      if (provider === 'local') {
        const newUrl = val || LM_STUDIO_DEFAULT_URL;
        const patch = { localUrl: newUrl };
        // URL changée → re-détecter les modèles ; sinon on garde le modèle choisi
        if (newUrl !== (st.localUrl || LM_STUDIO_DEFAULT_URL)) patch.localModel = '';
        _aiSave(patch);
      } else { const keys = {}; keys[provider] = val; _aiSave({ keys }); }
    };
    document.getElementById('ai-test').onclick = async () => {
      _saveKey();
      _renderAiBar();
      if (!aiIsConfigured()) { if (window.showToast) window.showToast('Colle d\'abord ta clé API'); return; }
      if (window.showToast) window.showToast('Test de la clé…');
      try {
        await aiCall({ user: 'Réponds uniquement : ok', maxTokens: 16 });
        if (window.showToast) window.showToast('Clé valide — assistant IA actif');
      } catch (e) {
        if (window.showToast) window.showToast(e.message);
      }
    };
    document.getElementById('ai-key').addEventListener('change', () => { _saveKey(); _renderAiBar(); });
    document.getElementById('ai-model').onchange = (e) => { _aiSave({ model: e.target.value }); _renderAiBar(); };
    document.getElementById('ai-local-detect').onclick = () => _populateLocalModels({ notify: true });
    document.getElementById('ai-local-model').onchange = (e) => {
      _aiSave({ localModel: e.target.value });
      const st = document.getElementById('ai-status');
      if (st && e.target.value) { st.textContent = 'LM Studio · ' + e.target.value; st.classList.add('connected'); }
    };
    _renderAiBar();
  };
  new MutationObserver(_doInject).observe(document.body, { childList: true, subtree: true });
  _doInject();
}

// --- Styles ---
const _aiStyle = document.createElement('style');
_aiStyle.textContent = `
.ai-suggest-btn { display: inline-flex; align-items: center; gap: 6px; margin: -0.75rem 0 1.25rem; padding: 5px 12px; border: none; background: transparent; color: var(--accent); border-radius: var(--radius); font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent); transition: background .1s; }
.ai-suggest-btn:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
#ai-popup { position: fixed; inset: 0; z-index: 520; display: none; }
#ai-popup.open { display: block; }
.ai-overlay { position: absolute; inset: 0; background: rgba(15,15,15,0.4); backdrop-filter: blur(2px); }
.ai-panel { position: absolute; top: 8vh; left: 50%; transform: translateX(-50%); width: 92vw; max-width: 560px; max-height: 84vh; background: var(--bg); border-radius: var(--radius-lg); display: flex; flex-direction: column; box-shadow: var(--shadow-lg); overflow: hidden; }
.ai-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.ai-head h4 { font-size: 15px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 6px; }
.ai-close { background: transparent; border: none; font-size: 15px; cursor: pointer; color: var(--text2); padding: 4px 8px; border-radius: var(--radius); }
.ai-close:hover { background: var(--hover); color: var(--text); }
.ai-body { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.ai-empty { text-align: center; color: var(--text2); padding: 2rem 1rem; font-size: 13px; line-height: 1.6; }
.ai-card { padding: 12px 14px; background: var(--bg2); border-radius: var(--radius); box-shadow: inset 0 0 0 1px var(--border); }
.ai-card-text { font-size: 14px; line-height: 1.55; color: var(--text); margin-bottom: 8px; }
.ai-card-text span { color: var(--text2); font-size: 13px; }
.ai-card-actions { display: flex; gap: 6px; }
.ai-foot { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); background: var(--bg2); }
.ai-foot input { flex: 1; padding: 6px 10px; border: none; border-radius: var(--radius); font-family: inherit; font-size: 13px; background: var(--bg); color: var(--text); box-shadow: inset 0 0 0 1px var(--border); height: 28px; }
.ai-foot input:focus { outline: none; box-shadow: inset 0 0 0 1px var(--accent); }
.ai-bar input#ai-key { width: 200px; padding: 4px 10px; border: none; border-radius: var(--radius); font-family: inherit; font-size: 12px; background: var(--bg); color: var(--text); box-shadow: inset 0 0 0 1px var(--border); height: 28px; }
.ai-bar input#ai-key:focus { outline: none; box-shadow: inset 0 0 0 1px var(--accent); }
.ai-bar select { padding: 4px 8px; border: none; border-radius: var(--radius); font-family: inherit; font-size: 12px; background: var(--bg); color: var(--text); box-shadow: inset 0 0 0 1px var(--border); height: 28px; cursor: pointer; }
`;
document.head.appendChild(_aiStyle);

// --- Init ---
window.addEventListener('load', () => {
  _injectAiBar();
  _injectAiButtons();
});
