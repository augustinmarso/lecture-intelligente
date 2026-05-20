// =============================================================
// ambient.js — Musique/bruits d'ambiance pour la concentration
// Brown noise (étude Mehta et al. 2016 sur l'attention)
// Pink noise (Zhou 2012, mémoire)
// Binaural alpha (Lane 1998, focus)
// =============================================================

let _audioCtx = null;
let _currentNode = null;
let _currentMode = 'off';
let _gainNode = null;
let _binauralOscL = null;
let _binauralOscR = null;
let _binauralPanL = null;
let _binauralPanR = null;
let _ambientVolume = 0.4;

const AMBIENT_KEY = 'ambient-prefs-v1';

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
      // Voss-McCartney algorithm (simplifié)
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        data[i] *= 0.11;
        b6 = white * 0.115926;
      }
    }
  }
  return buffer;
}

function stopAmbient() {
  if (_currentNode) {
    try { _currentNode.stop(); } catch (_) {}
    try { _currentNode.disconnect(); } catch (_) {}
    _currentNode = null;
  }
  [_binauralOscL, _binauralOscR, _binauralPanL, _binauralPanR].forEach(n => {
    if (n) { try { n.stop && n.stop(); } catch (_) {} try { n.disconnect(); } catch (_) {} }
  });
  _binauralOscL = _binauralOscR = _binauralPanL = _binauralPanR = null;
  _currentMode = 'off';
  _refreshAmbientUI();
}

function playAmbient(mode) {
  stopAmbient();
  if (mode === 'off') return;
  const ctx = _ensureCtx();
  _currentMode = mode;

  if (mode === 'brown' || mode === 'white' || mode === 'pink') {
    const buffer = _createNoiseBuffer(mode);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(_gainNode);
    src.start();
    _currentNode = src;
  } else if (mode === 'binaural') {
    // Carrier 200Hz, beat 10Hz (alpha) → L=200Hz R=210Hz
    const oscL = ctx.createOscillator();
    const oscR = ctx.createOscillator();
    oscL.frequency.value = 200;
    oscR.frequency.value = 210;
    oscL.type = 'sine';
    oscR.type = 'sine';
    const panL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const panR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panL && panR) {
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
    _binauralOscL = oscL; _binauralOscR = oscR;
    _binauralPanL = panL; _binauralPanR = panR;
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
// UI : panneau dépliant dans la toolbar PDF
// =============================================================
function _refreshAmbientUI() {
  const sel = document.querySelector('.ambient-modes');
  if (sel) {
    sel.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === _currentMode));
  }
  const vol = document.getElementById('ambient-volume');
  if (vol) vol.value = Math.round(_ambientVolume * 100);
  const indicator = document.getElementById('ambient-toggle');
  if (indicator) {
    indicator.classList.toggle('active', _currentMode !== 'off');
    indicator.textContent = _currentMode === 'off' ? '🎵' : '🎧';
  }
}

function _injectAmbientUI() {
  const obs = new MutationObserver(() => {
    const toolbar = document.querySelector('#pdf-panel .pdf-toolbar');
    if (!toolbar || toolbar.dataset.ambient) return;
    toolbar.dataset.ambient = '1';
    const wrap = document.createElement('div');
    wrap.className = 'ambient-wrap';
    wrap.innerHTML = `
      <button id="ambient-toggle" title="Musique d'ambiance">🎵</button>
      <div class="ambient-panel" style="display:none">
        <div class="ambient-panel-title">🎧 Musique d'ambiance — concentration</div>
        <div class="ambient-modes">
          <button data-mode="off" title="Désactivé">Off</button>
          <button data-mode="brown" title="Brown noise — étude Mehta 2016 sur l'attention soutenue">Brown</button>
          <button data-mode="pink" title="Pink noise — étude Zhou 2012 sur la mémoire">Pink</button>
          <button data-mode="white" title="White noise — masque les distractions">White</button>
          <button data-mode="binaural" title="Alpha binaural 10Hz — état de focus relaxé (casque requis)">Alpha</button>
        </div>
        <div class="ambient-volume-row">
          <label>Volume</label>
          <input type="range" id="ambient-volume" min="0" max="100" value="40"/>
        </div>
        <div class="ambient-note">💡 Recommandé : <strong>Brown noise</strong> pour la concentration soutenue. Alpha binaural avec casque uniquement.</div>
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

    wrap.querySelectorAll('.ambient-modes button').forEach(b => {
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
.ambient-wrap { position: relative; display: inline-block; }
.ambient-wrap > #ambient-toggle { padding: 6px 10px; border: 0.5px solid var(--border2); background: var(--bg2); color: var(--text); border-radius: var(--radius); font-family: inherit; font-size: 12px; cursor: pointer; }
.ambient-wrap > #ambient-toggle:hover { background: var(--bg3); }
.ambient-wrap > #ambient-toggle.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.ambient-panel { position: absolute; top: 100%; right: 0; margin-top: 4px; background: var(--bg); border: 0.5px solid var(--border2); border-radius: var(--radius); padding: 12px; box-shadow: 0 6px 20px rgba(0,0,0,.2); z-index: 50; min-width: 260px; }
.ambient-panel-title { font-size: 12px; font-weight: 500; margin-bottom: 8px; color: var(--text); }
.ambient-modes { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
.ambient-modes button { padding: 5px 10px; border: 0.5px solid var(--border2); background: var(--bg2); color: var(--text); border-radius: 6px; font-family: inherit; font-size: 11px; cursor: pointer; flex: 1; min-width: 50px; }
.ambient-modes button:hover { background: var(--bg3); }
.ambient-modes button.active { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 500; }
.ambient-volume-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
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
