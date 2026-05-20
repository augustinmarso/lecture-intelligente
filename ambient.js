// =============================================================
// ambient.js — Musique/bruits d'ambiance pour la concentration
// 100% généré en Web Audio API (offline, pas de pub, instantané)
// =============================================================

let _audioCtx = null;
let _activeNodes = [];
let _currentMode = 'off';
let _gainNode = null;
let _ambientVolume = 0.4;

const AMBIENT_KEY = 'ambient-prefs-v1';

const MODES = {
  off:    { label: 'Off',           cat: 'off',     desc: 'Désactivé' },
  brown:  { label: 'Brown',         cat: 'noise',   desc: 'Brown noise — attention soutenue (Mehta 2016)' },
  pink:   { label: 'Pink',          cat: 'noise',   desc: 'Pink noise — mémoire & sommeil (Zhou 2012)' },
  white:  { label: 'White',         cat: 'noise',   desc: 'White noise — masque les distractions' },
  ocean:  { label: '🌊 Vagues',     cat: 'nature',  desc: 'Vagues calmes (brown noise modulé)' },
  rain:   { label: '🌧 Pluie',      cat: 'nature',  desc: 'Pluie continue (white noise filtré)' },
  wind:   { label: '💨 Vent',       cat: 'nature',  desc: 'Vent doux (pink noise modulé)' },
  forest: { label: '🌲 Forêt',      cat: 'nature',  desc: 'Bruissement et brise (pink + variations)' },
  storm:  { label: '⛈ Orage',      cat: 'nature',  desc: 'Pluie + impulsions (tonnerre lointain)' },
  delta:  { label: 'Δ 2Hz Sommeil', cat: 'binaural',desc: 'Delta 2Hz — sommeil profond (casque)' },
  theta:  { label: 'θ 6Hz Méditation', cat: 'binaural', desc: 'Theta 6Hz — méditation, créativité (casque)' },
  alpha:  { label: 'α 10Hz Focus',  cat: 'binaural',desc: 'Alpha 10Hz — focus relaxé (casque)' },
  beta:   { label: 'β 20Hz Intense',cat: 'binaural',desc: 'Beta 20Hz — concentration intense (casque)' },
  gamma:  { label: 'γ 40Hz Cogn.',  cat: 'binaural',desc: 'Gamma 40Hz — haute cognition (casque)' },
};

function _loadAmbientPrefs() {
  try {
    const raw = localStorage.getItem(AMBIENT_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.volume === 'number') _ambientVolume = p.volume;
    }
  } catch (_) {}
}

function _saveAmbientPrefs() {
  try { localStorage.setItem(AMBIENT_KEY, JSON.stringify({ volume: _ambientVolume })); } catch (_) {}
}

function _ensureCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    _gainNode = _audioCtx.createGain();
    _gainNode.gain.value = _ambientVolume;
    _gainNode.connect(_audioCtx.destination);
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function _createNoiseBuffer(type, duration = 10) {
  const ctx = _ensureCtx();
  const buffer = ctx.createBuffer(2, ctx.sampleRate * duration, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    if (type === 'white') {
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    } else if (type === 'brown') {
      let lastOut = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (lastOut + 0.02 * white) / 1.02;
        lastOut = data[i];
        data[i] *= 3.5;
      }
    } else if (type === 'pink') {
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886*b0 + white*0.0555179;
        b1 = 0.99332*b1 + white*0.0750759;
        b2 = 0.96900*b2 + white*0.1538520;
        b3 = 0.86650*b3 + white*0.3104856;
        b4 = 0.55000*b4 + white*0.5329522;
        b5 = -0.7616*b5 - white*0.0168980;
        data[i] = b0+b1+b2+b3+b4+b5+b6 + white*0.5362;
        data[i] *= 0.11;
        b6 = white * 0.115926;
      }
    }
  }
  return buffer;
}

function _addNode(n) { _activeNodes.push(n); return n; }

function stopAmbient() {
  _activeNodes.forEach(n => {
    try { n.stop && n.stop(); } catch (_) {}
    try { n.disconnect(); } catch (_) {}
  });
  _activeNodes = [];
  _currentMode = 'off';
  _refreshAmbientUI();
}

function _playNoise(type) {
  const ctx = _ensureCtx();
  const src = _addNode(ctx.createBufferSource());
  src.buffer = _createNoiseBuffer(type);
  src.loop = true;
  src.connect(_gainNode);
  src.start();
}

function _playFiltered(noiseType, filterType, freq, q = 1) {
  const ctx = _ensureCtx();
  const src = _addNode(ctx.createBufferSource());
  src.buffer = _createNoiseBuffer(noiseType);
  src.loop = true;
  const filter = _addNode(ctx.createBiquadFilter());
  filter.type = filterType;
  filter.frequency.value = freq;
  filter.Q.value = q;
  src.connect(filter).connect(_gainNode);
  src.start();
  return { src, filter };
}

function _playModulated(noiseType, modFreq, modDepth, baseGain = 0.5) {
  const ctx = _ensureCtx();
  const src = _addNode(ctx.createBufferSource());
  src.buffer = _createNoiseBuffer(noiseType);
  src.loop = true;
  const modGain = _addNode(ctx.createGain());
  modGain.gain.value = baseGain;
  const lfo = _addNode(ctx.createOscillator());
  lfo.frequency.value = modFreq;
  lfo.type = 'sine';
  const lfoAmp = _addNode(ctx.createGain());
  lfoAmp.gain.value = modDepth;
  lfo.connect(lfoAmp).connect(modGain.gain);
  src.connect(modGain).connect(_gainNode);
  src.start();
  lfo.start();
  return { src, lfo };
}

function _playBinaural(beatFreq, carrier = 200) {
  const ctx = _ensureCtx();
  const oscL = _addNode(ctx.createOscillator());
  const oscR = _addNode(ctx.createOscillator());
  oscL.frequency.value = carrier;
  oscR.frequency.value = carrier + beatFreq;
  oscL.type = 'sine';
  oscR.type = 'sine';
  if (ctx.createStereoPanner) {
    const panL = _addNode(ctx.createStereoPanner());
    const panR = _addNode(ctx.createStereoPanner());
    panL.pan.value = -1;
    panR.pan.value = 1;
    oscL.connect(panL).connect(_gainNode);
    oscR.connect(panR).connect(_gainNode);
  } else {
    oscL.connect(_gainNode);
    oscR.connect(_gainNode);
  }
  oscL.start();
  oscR.start();
}

function _playStorm() {
  // Pluie (white lowpass) + impulsions de tonnerre aléatoires
  _playFiltered('white', 'lowpass', 1500);
  const ctx = _ensureCtx();
  function thunder() {
    if (_currentMode !== 'storm') return;
    const noise = ctx.createBufferSource();
    const dur = 2 + Math.random() * 3;
    const b = ctx.createBuffer(2, ctx.sampleRate * dur, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = b.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (last + 0.02 * white) / 1.02;
        last = data[i];
      }
    }
    noise.buffer = b;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 300;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, ctx.currentTime);
    env.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 0.1);
    env.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur);
    noise.connect(filt).connect(env).connect(_gainNode);
    noise.start();
    noise.stop(ctx.currentTime + dur);
    setTimeout(thunder, 8000 + Math.random() * 15000);
  }
  setTimeout(thunder, 4000 + Math.random() * 6000);
}

function _playForest() {
  // Pink noise modulé (vent) + petits chirps aléatoires (oiseaux subtils)
  _playModulated('pink', 0.12, 0.3, 0.5);
  const ctx = _ensureCtx();
  function chirp() {
    if (_currentMode !== 'forest') return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const startFreq = 2000 + Math.random() * 3000;
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(startFreq * 0.7, ctx.currentTime + 0.15);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, ctx.currentTime);
    env.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(env).connect(_gainNode);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    setTimeout(chirp, 3000 + Math.random() * 8000);
  }
  setTimeout(chirp, 2000 + Math.random() * 3000);
}

function playAmbient(mode) {
  stopAmbient();
  _currentMode = mode;
  if (mode === 'off') return;

  switch (mode) {
    case 'brown': case 'pink': case 'white':
      _playNoise(mode); break;
    case 'ocean':
      _playModulated('brown', 0.1, 0.5, 0.5); break;
    case 'rain':
      _playFiltered('white', 'lowpass', 1500); break;
    case 'wind': {
      const { filter } = _playFiltered('pink', 'lowpass', 800);
      const ctx = _ensureCtx();
      const lfo = _addNode(ctx.createOscillator());
      lfo.frequency.value = 0.15;
      const amp = _addNode(ctx.createGain());
      amp.gain.value = 600;
      lfo.connect(amp).connect(filter.frequency);
      lfo.start();
      break;
    }
    case 'forest': _playForest(); break;
    case 'storm': _playStorm(); break;
    case 'delta': _playBinaural(2); break;
    case 'theta': _playBinaural(6); break;
    case 'alpha': _playBinaural(10); break;
    case 'beta':  _playBinaural(20); break;
    case 'gamma': _playBinaural(40); break;
  }
  _refreshAmbientUI();
}

function setAmbientVolume(v) {
  _ambientVolume = Math.max(0, Math.min(1, v));
  if (_gainNode) _gainNode.gain.value = _ambientVolume;
  _saveAmbientPrefs();
  _refreshAmbientUI();
}

// =============================================================
// UI
// =============================================================
function _refreshAmbientUI() {
  document.querySelectorAll('.ambient-modes button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === _currentMode);
  });
  const vol = document.getElementById('ambient-volume');
  if (vol) vol.value = Math.round(_ambientVolume * 100);
  const indicator = document.getElementById('ambient-toggle');
  if (indicator) {
    indicator.classList.toggle('active', _currentMode !== 'off');
    indicator.textContent = _currentMode === 'off' ? '🎵' : '🎧';
  }
  const label = document.getElementById('ambient-current');
  if (label) {
    if (_currentMode === 'off') label.textContent = '';
    else label.textContent = '· ' + MODES[_currentMode].label;
  }
}

function _injectAmbientUI() {
  const obs = new MutationObserver(() => {
    const toolbar = document.querySelector('#pdf-panel .pdf-toolbar');
    if (!toolbar || toolbar.dataset.ambient) return;
    toolbar.dataset.ambient = '1';

    const groups = {
      noise: { title: 'Bruits scientifiques', items: ['brown','pink','white'] },
      nature: { title: 'Nature', items: ['ocean','rain','wind','forest','storm'] },
      binaural: { title: 'Binaural (casque)', items: ['delta','theta','alpha','beta','gamma'] }
    };
    const groupsHtml = Object.entries(groups).map(([k, g]) => `
      <div class="ambient-group">
        <div class="ambient-group-title">${g.title}</div>
        <div class="ambient-modes">
          ${g.items.map(m => `<button data-mode="${m}" title="${MODES[m].desc}">${MODES[m].label}</button>`).join('')}
        </div>
      </div>
    `).join('');

    const wrap = document.createElement('div');
    wrap.className = 'ambient-wrap';
    wrap.innerHTML = `
      <button id="ambient-toggle" title="Musique d'ambiance">🎵</button>
      <span id="ambient-current" class="ambient-current"></span>
      <div class="ambient-panel" style="display:none">
        <div class="ambient-panel-title">🎧 Musique d'ambiance</div>
        <button data-mode="off" class="ambient-off-btn">⏹ Couper</button>
        ${groupsHtml}
        <div class="ambient-volume-row">
          <label>Volume</label>
          <input type="range" id="ambient-volume" min="0" max="100" value="40"/>
        </div>
        <div class="ambient-note">💡 <strong>Brown noise</strong> recommandé pour concentration soutenue. Binaurals : casque indispensable.</div>
      </div>
    `;
    toolbar.appendChild(wrap);

    const toggle = wrap.querySelector('#ambient-toggle');
    const panel = wrap.querySelector('.ambient-panel');
    toggle.onclick = (e) => {
      e.stopPropagation();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    };
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) panel.style.display = 'none';
    });

    wrap.querySelectorAll('[data-mode]').forEach(b => {
      b.onclick = () => playAmbient(b.dataset.mode);
    });
    wrap.querySelector('#ambient-volume').oninput = (e) => setAmbientVolume(e.target.value / 100);
    _refreshAmbientUI();
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// =============================================================
// Styles
// =============================================================
const _ambStyle = document.createElement('style');
_ambStyle.textContent = `
.ambient-wrap { position: relative; display: inline-flex; align-items: center; gap: 4px; }
.ambient-wrap > #ambient-toggle { padding: 6px 10px; border: 0.5px solid var(--border2); background: var(--bg2); color: var(--text); border-radius: var(--radius); font-family: inherit; font-size: 12px; cursor: pointer; }
.ambient-wrap > #ambient-toggle:hover { background: var(--bg3); }
.ambient-wrap > #ambient-toggle.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.ambient-current { font-size: 11px; color: var(--text2); }
.ambient-panel { position: absolute; top: 100%; right: 0; margin-top: 4px; background: var(--bg); border: 0.5px solid var(--border2); border-radius: var(--radius); padding: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.25); z-index: 50; min-width: 320px; max-height: 70vh; overflow-y: auto; }
.ambient-panel-title { font-size: 13px; font-weight: 500; margin-bottom: 8px; color: var(--text); }
.ambient-off-btn { width: 100%; padding: 6px 10px; border: 0.5px solid var(--border2); background: var(--bg2); color: var(--text2); border-radius: 6px; font-family: inherit; font-size: 12px; cursor: pointer; margin-bottom: 10px; }
.ambient-off-btn:hover { background: var(--bg3); color: var(--text); }
.ambient-group { margin-bottom: 10px; }
.ambient-group-title { font-size: 10px; color: var(--text3); letter-spacing: .06em; text-transform: uppercase; margin-bottom: 4px; font-weight: 500; }
.ambient-modes { display: flex; flex-wrap: wrap; gap: 4px; }
.ambient-modes button { padding: 5px 10px; border: 0.5px solid var(--border2); background: var(--bg2); color: var(--text); border-radius: 6px; font-family: inherit; font-size: 11px; cursor: pointer; flex: 1; min-width: 60px; transition: all .15s; }
.ambient-modes button:hover { background: var(--bg3); }
.ambient-modes button.active { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 500; }
.ambient-volume-row { display: flex; align-items: center; gap: 8px; margin: 12px 0 8px; padding-top: 10px; border-top: 0.5px solid var(--border); }
.ambient-volume-row label { font-size: 11px; color: var(--text2); min-width: 50px; }
.ambient-volume-row input[type=range] { flex: 1; accent-color: var(--accent); }
.ambient-note { font-size: 11px; color: var(--text2); line-height: 1.5; background: var(--bg2); padding: 8px 10px; border-radius: 6px; }
`;
document.head.appendChild(_ambStyle);

// =============================================================
// Init
// =============================================================
_loadAmbientPrefs();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _injectAmbientUI);
} else {
  _injectAmbientUI();
}

window.playAmbient = playAmbient;
window.stopAmbient = stopAmbient;
