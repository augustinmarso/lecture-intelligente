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
  // Bruits synthétisés
  brown:  { label: 'Brown',         cat: 'noise',   desc: 'Brown noise — attention soutenue (Mehta 2016)' },
  pink:   { label: 'Pink',          cat: 'noise',   desc: 'Pink noise — mémoire & sommeil (Zhou 2012)' },
  white:  { label: 'White',         cat: 'noise',   desc: 'White noise — masque les distractions' },
  // Synthétisé (nature simulée)
  ocean:  { label: '🌊 Vagues',     cat: 'synth',   desc: 'Vagues synthétisées (brown noise modulé)' },
  rain:   { label: '🌧 Pluie',      cat: 'synth',   desc: 'Pluie synthétisée (white noise filtré)' },
  wind:   { label: '💨 Vent',       cat: 'synth',   desc: 'Vent synthétisé (pink noise modulé)' },
  forest: { label: '🌲 Forêt',      cat: 'synth',   desc: 'Bruissement et brise (pink + variations)' },
  storm:  { label: '⛈ Orage',      cat: 'synth',   desc: 'Pluie + impulsions (tonnerre lointain)' },
  // Musique classique générée localement (Web Audio synthèse)
  pachelbel: { label: '🎻 Pachelbel',    cat: 'music', score: 'pachelbel', desc: 'Canon en Ré majeur (généré)' },
  bach:      { label: '🎼 Bach',         cat: 'music', score: 'bach',      desc: 'Prélude en Do BWV 846 (généré)' },
  elise:     { label: '🎹 Pour Élise',   cat: 'music', score: 'elise',     desc: 'Beethoven — thème principal (généré)' },
  satie:     { label: '🎶 Satie',        cat: 'music', score: 'satie',     desc: 'Gymnopédie n°1 (généré)' },
  chopin:    { label: '🎼 Chopin',       cat: 'music', score: 'chopin',    desc: 'Prélude op.28 n°7 (généré)' },
  debussy:   { label: '🌙 Debussy',      cat: 'music', score: 'debussy',   desc: 'Clair de Lune (généré)' },
  // Binaural
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
    // Expose pour music-player.js
    window._ambientCtx = _audioCtx;
    window._ambientGain = _gainNode;
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
  if (window._stopScore) window._stopScore();
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

// =============================================================
// Sons naturels organiques (multi-LFO + variations stochastiques)
// =============================================================

// Helper: ajouter un LFO sur un paramètre AudioParam
function _addLFO(targetParam, freq, depth, type = 'sine', delay = 0) {
  const ctx = _ensureCtx();
  const lfo = _addNode(ctx.createOscillator());
  lfo.type = type;
  lfo.frequency.value = freq;
  const amp = _addNode(ctx.createGain());
  amp.gain.value = depth;
  lfo.connect(amp).connect(targetParam);
  lfo.start(ctx.currentTime + delay);
  return lfo;
}

function _playOcean() {
  // Vagues organiques : brown noise + filtrage + multi-LFO sur gain & cutoff
  const ctx = _ensureCtx();
  const src = _addNode(ctx.createBufferSource());
  src.buffer = _createNoiseBuffer('brown', 20);
  src.loop = true;

  // Filtre principal pour adoucir (simule l'eau)
  const lp = _addNode(ctx.createBiquadFilter());
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  lp.Q.value = 0.5;

  // Gain modulé par 3 LFOs incommensurables → pas de répétition perceptible
  const gain = _addNode(ctx.createGain());
  gain.gain.value = 0.35;
  _addLFO(gain.gain, 0.067, 0.30);  // vague principale ~15s
  _addLFO(gain.gain, 0.131, 0.12);  // vague secondaire ~7.6s
  _addLFO(gain.gain, 0.293, 0.05);  // ondulations ~3.4s
  _addLFO(gain.gain, 0.041, 0.08, 'triangle'); // marée lente ~24s

  // Filtre cutoff modulé (l'eau qui clapote, sons plus ou moins étouffés)
  _addLFO(lp.frequency, 0.09, 250);
  _addLFO(lp.frequency, 0.17, 100);

  src.connect(lp).connect(gain).connect(_gainNode);
  src.start();

  // Vagues qui cassent occasionnellement (impulsions)
  function breakingWave() {
    if (_currentMode !== 'ocean') return;
    const noise = ctx.createBufferSource();
    const dur = 1.5 + Math.random() * 2;
    const b = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      data[i] = (last + 0.04 * w) / 1.04;
      last = data[i];
    }
    noise.buffer = b;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 800 + Math.random() * 1200;
    f.Q.value = 0.7;
    const env = ctx.createGain();
    const now = ctx.currentTime;
    const peak = 0.15 + Math.random() * 0.2;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.3);
    env.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(f).connect(env).connect(_gainNode);
    noise.start();
    noise.stop(now + dur);
    setTimeout(breakingWave, 6000 + Math.random() * 14000);
  }
  setTimeout(breakingWave, 4000 + Math.random() * 8000);
}

function _playRain() {
  // Pluie : white noise filtré + gouttes individuelles aléatoires
  const ctx = _ensureCtx();
  const src = _addNode(ctx.createBufferSource());
  src.buffer = _createNoiseBuffer('white', 15);
  src.loop = true;

  const hp = _addNode(ctx.createBiquadFilter());
  hp.type = 'highpass';
  hp.frequency.value = 400;
  const lp = _addNode(ctx.createBiquadFilter());
  lp.type = 'lowpass';
  lp.frequency.value = 2000;

  const gain = _addNode(ctx.createGain());
  gain.gain.value = 0.18;
  // Variation lente d'intensité (pluie qui s'intensifie / diminue)
  _addLFO(gain.gain, 0.029, 0.10, 'sine');
  _addLFO(gain.gain, 0.083, 0.04);

  src.connect(hp).connect(lp).connect(gain).connect(_gainNode);
  src.start();

  // Gouttes individuelles (petites impulsions hautes fréquences)
  function drop() {
    if (_currentMode !== 'rain') return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const freq = 1800 + Math.random() * 2200;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.04);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.04 + Math.random() * 0.04, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(env).connect(_gainNode);
    osc.start(t);
    osc.stop(t + 0.1);
    setTimeout(drop, 50 + Math.random() * 200);
  }
  setTimeout(drop, 100);
}

function _playWind() {
  // Vent : pink noise multi-filtré avec rafales
  const ctx = _ensureCtx();
  const src = _addNode(ctx.createBufferSource());
  src.buffer = _createNoiseBuffer('pink', 20);
  src.loop = true;

  const lp = _addNode(ctx.createBiquadFilter());
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  lp.Q.value = 0.7;

  const gain = _addNode(ctx.createGain());
  gain.gain.value = 0.4;

  // Cutoff modulé par 3 LFOs → vent jamais constant
  _addLFO(lp.frequency, 0.13, 500);
  _addLFO(lp.frequency, 0.29, 200);
  _addLFO(lp.frequency, 0.071, 350, 'triangle');

  // Gain modulé (rafales)
  _addLFO(gain.gain, 0.097, 0.20);
  _addLFO(gain.gain, 0.19, 0.10);

  src.connect(lp).connect(gain).connect(_gainNode);
  src.start();

  // Bourrasques occasionnelles
  function gust() {
    if (_currentMode !== 'wind') return;
    const t = ctx.currentTime;
    const dur = 2 + Math.random() * 3;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setTargetAtTime(0.7 + Math.random() * 0.3, t, 0.5);
    gain.gain.setTargetAtTime(0.4, t + dur * 0.6, 1.0);
    setTimeout(gust, 8000 + Math.random() * 12000);
  }
  setTimeout(gust, 6000 + Math.random() * 8000);
}

function _playForest() {
  // Forêt : vent doux + bruissement de feuilles + chants d'oiseaux variés
  _playWind();
  // Override: reduce wind intensity for forest
  const ctx = _ensureCtx();

  // Bruissement feuilles (white haute fréquence filtrée modulée)
  const src = _addNode(ctx.createBufferSource());
  src.buffer = _createNoiseBuffer('white', 10);
  src.loop = true;
  const bp = _addNode(ctx.createBiquadFilter());
  bp.type = 'bandpass';
  bp.frequency.value = 4000;
  bp.Q.value = 1.5;
  const gain = _addNode(ctx.createGain());
  gain.gain.value = 0.05;
  _addLFO(gain.gain, 0.23, 0.04);
  _addLFO(bp.frequency, 0.17, 1500);
  src.connect(bp).connect(gain).connect(_gainNode);
  src.start();

  // Oiseaux variés (différentes mélodies courtes)
  function bird() {
    if (_currentMode !== 'forest') return;
    const t = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4);
    const baseFreq = 1800 + Math.random() * 2500;
    for (let n = 0; n < notes; n++) {
      const offset = n * (0.08 + Math.random() * 0.06);
      const osc = ctx.createOscillator();
      osc.type = Math.random() > 0.5 ? 'sine' : 'triangle';
      const f = baseFreq * (0.85 + Math.random() * 0.4);
      osc.frequency.setValueAtTime(f, t + offset);
      osc.frequency.exponentialRampToValueAtTime(f * (0.7 + Math.random() * 0.3), t + offset + 0.15);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t + offset);
      env.gain.linearRampToValueAtTime(0.07, t + offset + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.18);
      osc.connect(env).connect(_gainNode);
      osc.start(t + offset);
      osc.stop(t + offset + 0.2);
    }
    setTimeout(bird, 4000 + Math.random() * 10000);
  }
  setTimeout(bird, 1500 + Math.random() * 3000);
}

function _playStormImproved() {
  // Pluie intense + variations + tonnerre lointain
  _playRain();
  const ctx = _ensureCtx();

  function thunder() {
    if (_currentMode !== 'storm') return;
    const t = ctx.currentTime;
    const dur = 3 + Math.random() * 4;
    const noise = ctx.createBufferSource();
    const b = ctx.createBuffer(2, ctx.sampleRate * dur, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = b.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        const w = Math.random() * 2 - 1;
        data[i] = (last + 0.02 * w) / 1.02;
        last = data[i];
      }
    }
    noise.buffer = b;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 200 + Math.random() * 300;
    const env = ctx.createGain();
    const peak = 0.5 + Math.random() * 0.5;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.05 + Math.random() * 0.2);
    // Roulement (modulation rapide pendant la décroissance)
    for (let i = 0; i < 5; i++) {
      const offset = 0.3 + i * (dur / 6);
      env.gain.linearRampToValueAtTime(peak * (0.4 - i * 0.07), t + offset);
      env.gain.linearRampToValueAtTime(peak * (0.6 - i * 0.1), t + offset + 0.15);
    }
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(filt).connect(env).connect(_gainNode);
    noise.start(t);
    noise.stop(t + dur);
    setTimeout(thunder, 10000 + Math.random() * 20000);
  }
  setTimeout(thunder, 5000 + Math.random() * 8000);
}

function playAmbient(mode) {
  stopAmbient();
  _currentMode = mode;
  if (mode === 'off') return;

  const m = MODES[mode];
  // Mode partition musicale ?
  if (m && m.score) {
    _ensureCtx();
    if (window._playScore) window._playScore(m.score);
    _refreshAmbientUI();
    return;
  }

  switch (mode) {
    case 'brown': case 'pink': case 'white':
      _playNoise(mode); break;
    case 'ocean':  _playOcean(); break;
    case 'rain':   _playRain(); break;
    case 'wind':   _playWind(); break;
    case 'forest': _playForest(); break;
    case 'storm':  _playStormImproved(); break;
    case 'delta':  _playBinaural(2); break;
    case 'theta':  _playBinaural(6); break;
    case 'alpha':  _playBinaural(10); break;
    case 'beta':   _playBinaural(20); break;
    case 'gamma':  _playBinaural(40); break;
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
  const _doInject = () => {
    const toolbar = document.querySelector('#pdf-panel .pdf-toolbar');
    if (!toolbar || toolbar.dataset.ambient) return;
    toolbar.dataset.ambient = '1';

    const groups = {
      music:    { title: '🎼 Musique classique (générée localement)', items: ['pachelbel','bach','elise','satie','chopin','debussy'] },
      noise:    { title: '🔊 Bruits scientifiques', items: ['brown','pink','white'] },
      synth:    { title: '🌿 Nature (multi-LFO organique)', items: ['ocean','rain','wind','forest','storm'] },
      binaural: { title: '🧠 Binaural (casque)', items: ['delta','theta','alpha','beta','gamma'] }
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
  };
  new MutationObserver(_doInject).observe(document.body, { childList: true, subtree: true });
  _doInject();
}

// =============================================================
// Styles
// =============================================================
const _ambStyle = document.createElement('style');
_ambStyle.textContent = `
.ambient-wrap { position: relative; display: inline-flex; align-items: center; gap: 4px; }
.ambient-wrap > #ambient-toggle { padding: 4px 8px; border: none; background: transparent; color: var(--text2); border-radius: var(--radius); font-family: inherit; font-size: 14px; cursor: pointer; height: 28px; transition: background .1s; }
.ambient-wrap > #ambient-toggle:hover { background: var(--hover); color: var(--text); }
.ambient-wrap > #ambient-toggle.active { background: var(--hover-strong); color: var(--text); }
.ambient-current { font-size: 12px; color: var(--text2); font-weight: 500; }
.ambient-panel { position: fixed; top: 56px; left: 12px; max-width: 360px; width: calc(100vw - 24px); background: var(--bg); border-radius: var(--radius-lg); padding: 14px; box-shadow: var(--shadow); z-index: 200; max-height: calc(100vh - 80px); overflow-y: auto; }
.ambient-panel-title { font-size: 14px; font-weight: 600; margin-bottom: 10px; color: var(--text); }
.ambient-off-btn { width: 100%; padding: 6px 10px; border: none; background: var(--bg2); color: var(--text); border-radius: var(--radius); font-family: inherit; font-size: 13px; cursor: pointer; margin-bottom: 12px; height: 30px; transition: background .1s; box-shadow: inset 0 0 0 1px var(--border); font-weight: 500; }
.ambient-off-btn:hover { background: var(--bg3); }
.ambient-group { margin-bottom: 12px; }
.ambient-group-title { font-size: 11px; color: var(--text2); margin-bottom: 6px; font-weight: 600; }
.ambient-modes { display: flex; flex-wrap: wrap; gap: 4px; }
.ambient-modes button { padding: 4px 10px; border: none; background: var(--bg2); color: var(--text); border-radius: var(--radius); font-family: inherit; font-size: 12px; cursor: pointer; flex: 1; min-width: 64px; transition: background .1s; height: 28px; box-shadow: inset 0 0 0 1px var(--border); font-weight: 500; }
.ambient-modes button:hover { background: var(--bg3); }
.ambient-modes button.active { background: var(--accent); color: #fff; box-shadow: none; }
.ambient-volume-row { display: flex; align-items: center; gap: 10px; margin: 14px 0 10px; padding-top: 12px; border-top: 1px solid var(--border); }
.ambient-volume-row label { font-size: 12px; color: var(--text2); min-width: 50px; font-weight: 500; }
.ambient-volume-row input[type=range] { flex: 1; accent-color: var(--accent); }
.ambient-note { font-size: 12px; color: var(--text2); line-height: 1.5; background: var(--bg2); padding: 10px 12px; border-radius: var(--radius); box-shadow: inset 0 0 0 1px var(--border); }
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
