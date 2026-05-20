// =============================================================
// music-player.js — Synthèse de musique classique en Web Audio
// Aucun fichier audio externe, tout généré à partir de partitions
// =============================================================

// ----- Synthé piano simple (somme d'harmoniques) -----
function _midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function _piano(time, midi, duration, vel = 0.25) {
  const ctx = window._ambientCtx;
  if (!ctx || !window._ambientGain) return;
  const freq = _midiToFreq(midi);

  // Enveloppe ADSR globale
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(vel, time + 0.008);          // attack 8ms
  env.gain.exponentialRampToValueAtTime(vel * 0.45, time + 0.12); // decay
  env.gain.setTargetAtTime(vel * 0.25, time + 0.12, 0.4);        // sustain
  env.gain.setTargetAtTime(0.0001, time + duration * 0.85, 0.1); // release
  env.connect(window._ambientGain);

  // 4 harmoniques (timbre piano)
  const partials = [
    { ratio: 1,   gain: 1.0,   type: 'triangle' },
    { ratio: 2,   gain: 0.5,   type: 'sine' },
    { ratio: 3,   gain: 0.25,  type: 'sine' },
    { ratio: 4.01, gain: 0.12, type: 'sine' } // slight detune sur l'aigu
  ];
  partials.forEach(p => {
    const osc = ctx.createOscillator();
    osc.type = p.type;
    osc.frequency.value = freq * p.ratio;
    const pg = ctx.createGain();
    pg.gain.value = p.gain;
    osc.connect(pg).connect(env);
    osc.start(time);
    osc.stop(time + duration + 0.3);
  });
}

// ----- Cordes (pour Pachelbel) -----
function _strings(time, midi, duration, vel = 0.2) {
  const ctx = window._ambientCtx;
  if (!ctx || !window._ambientGain) return;
  const freq = _midiToFreq(midi);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(vel, time + 0.15);
  env.gain.setTargetAtTime(vel * 0.85, time + 0.15, 0.3);
  env.gain.setTargetAtTime(0.0001, time + duration * 0.9, 0.15);
  env.connect(window._ambientGain);

  [1, 2, 3].forEach((h, i) => {
    const osc = ctx.createOscillator();
    osc.type = i === 0 ? 'sawtooth' : 'sine';
    osc.frequency.value = freq * h * (1 + (Math.random() - 0.5) * 0.003); // léger detune
    const g = ctx.createGain();
    g.gain.value = 1 / (h * 2);
    osc.connect(g).connect(env);
    osc.start(time);
    osc.stop(time + duration + 0.4);
  });
}

// =============================================================
// Partitions (format compact : [tick, midi, durTicks, instrument?])
// 1 tick = 1 noire à tempo donné. instrument : 'p' (piano) / 's' (strings)
// =============================================================

// PACHELBEL CANON IN D — 8 mesures de basse + mélodie supérieure
// Progression : D A Bm F#m G D G A (chacune 2 noires = 1 mesure 2/2)
// Bass: D3 A2 B2 F#2 G2 D2 G2 A2
const SCORE_PACHELBEL = {
  tempo: 56,
  totalTicks: 32,
  notes: [
    // Basse (cordes) — 8 notes, chacune dure 4 ticks (1 mesure)
    [0,  50, 4, 's'], [4,  45, 4, 's'], [8,  47, 4, 's'], [12, 42, 4, 's'],
    [16, 43, 4, 's'], [20, 38, 4, 's'], [24, 43, 4, 's'], [28, 45, 4, 's'],
    // Accords arpégés (piano) — un arpège par mesure
    // M1 D: F#4 A4
    [0, 66, 2, 'p'], [2, 69, 2, 'p'],
    // M2 A: E4 A4
    [4, 64, 2, 'p'], [6, 69, 2, 'p'],
    // M3 Bm: D4 F#4
    [8, 62, 2, 'p'], [10, 66, 2, 'p'],
    // M4 F#m: C#4 F#4
    [12, 61, 2, 'p'], [14, 66, 2, 'p'],
    // M5 G: B3 D4
    [16, 59, 2, 'p'], [18, 62, 2, 'p'],
    // M6 D: A3 D4
    [20, 57, 2, 'p'], [22, 62, 2, 'p'],
    // M7 G: B3 G4
    [24, 59, 2, 'p'], [26, 67, 2, 'p'],
    // M8 A: A3 C#4 E4
    [28, 57, 1, 'p'], [29, 61, 1, 'p'], [30, 64, 1, 'p'], [31, 69, 1, 'p'],
    // Mélodie supérieure (motif de canon célèbre)
    [0,  74, 1, 'p'], [1, 73, 1, 'p'], [2, 71, 1, 'p'], [3, 69, 1, 'p'],
    [4,  71, 1, 'p'], [5, 69, 1, 'p'], [6, 67, 1, 'p'], [7, 66, 1, 'p'],
    [8,  67, 1, 'p'], [9, 66, 1, 'p'], [10, 64, 1, 'p'], [11, 62, 1, 'p'],
    [12, 64, 1, 'p'], [13, 62, 1, 'p'], [14, 61, 1, 'p'], [15, 59, 1, 'p'],
    [16, 62, 1, 'p'], [17, 64, 1, 'p'], [18, 66, 1, 'p'], [19, 67, 1, 'p'],
    [20, 66, 1, 'p'], [21, 67, 1, 'p'], [22, 69, 1, 'p'], [23, 71, 1, 'p'],
    [24, 69, 1, 'p'], [25, 71, 1, 'p'], [26, 73, 1, 'p'], [27, 74, 1, 'p'],
    [28, 73, 1, 'p'], [29, 71, 1, 'p'], [30, 69, 1, 'p'], [31, 73, 1, 'p'],
  ]
};

// BACH — Prélude en Do BWV 846 (arpèges en accords brisés, 4 mesures)
// Pattern: 8 doubles-croches par mesure (C E G C E G C E répété sur chaque accord)
const SCORE_BACH = {
  tempo: 70,
  totalTicks: 64, // 8 mesures × 8 doubles-croches
  notes: (() => {
    const chords = [
      [48,52,55,60,64], // C: C3 E3 G3 C4 E4
      [48,50,57,62,65], // Dm/F: C3 D3 A3 D4 F4
      [47,50,55,62,65], // G/B: B2 D3 G3 D4 F4
      [48,52,55,60,64], // C: C3 E3 G3 C4 E4
      [48,52,57,60,64], // Am: C3 E3 A3 C4 E4
      [50,57,60,66,69], // D7/F#: D3 A3 C4 F#4 A4
      [43,50,55,59,65], // G: G2 D3 G3 B3 F4
      [48,52,55,60,64], // C
    ];
    const notes = [];
    chords.forEach((chord, mIdx) => {
      const tickStart = mIdx * 8;
      // Pattern Bach : note1 note2 note3 note4 note5 note3 note4 note5
      const seq = [chord[0], chord[1], chord[2], chord[3], chord[4], chord[2], chord[3], chord[4]];
      seq.forEach((midi, i) => notes.push([tickStart + i * 0.5, midi, 0.5, 'p']));
    });
    return notes;
  })()
};

// POUR ELISE (Beethoven WoO 59) — thème principal (16 mesures)
const SCORE_ELISE = {
  tempo: 90,
  totalTicks: 32,
  notes: [
    // Mesure 1
    [0, 76, 0.5, 'p'], [0.5, 75, 0.5, 'p'], [1, 76, 0.5, 'p'], [1.5, 75, 0.5, 'p'],
    [2, 76, 0.5, 'p'], [2.5, 71, 0.5, 'p'], [3, 74, 0.5, 'p'], [3.5, 72, 0.5, 'p'],
    // Mesure 2
    [4, 69, 1, 'p'], [4, 45, 0.5, 's'], [4.5, 57, 0.5, 's'], [5, 60, 0.5, 's'], [5.5, 64, 0.5, 'p'],
    [6, 65, 0.5, 'p'], [6.5, 64, 0.5, 'p'], [7, 65, 0.5, 'p'], [7.5, 60, 0.5, 'p'],
    // Mesure 3
    [8, 64, 0.5, 'p'], [8.5, 65, 0.5, 'p'], [9, 64, 0.5, 'p'], [9.5, 63, 0.5, 'p'],
    [10, 64, 0.5, 'p'], [10.5, 63, 0.5, 'p'], [11, 64, 0.5, 'p'], [11.5, 59, 0.5, 'p'],
    // Mesure 4
    [12, 62, 0.5, 'p'], [12.5, 60, 0.5, 'p'], [13, 57, 1, 'p'], [13, 45, 1, 's'],
    // Répétition de la première partie
    [16, 76, 0.5, 'p'], [16.5, 75, 0.5, 'p'], [17, 76, 0.5, 'p'], [17.5, 75, 0.5, 'p'],
    [18, 76, 0.5, 'p'], [18.5, 71, 0.5, 'p'], [19, 74, 0.5, 'p'], [19.5, 72, 0.5, 'p'],
    [20, 69, 2, 'p'],
    // Outro doux
    [24, 64, 1, 'p'], [25, 62, 1, 'p'], [26, 60, 1, 'p'], [27, 57, 1, 'p'],
    [28, 64, 1, 'p'], [29, 62, 1, 'p'], [30, 60, 1, 'p'], [31, 57, 1, 'p'],
  ]
};

// SATIE — Gymnopédie n°1 (très ralenti, mélodie principale)
const SCORE_SATIE = {
  tempo: 50,
  totalTicks: 24,
  notes: [
    // Basse cordes (G2 - D3 alternance)
    [0, 43, 4, 's'], [4, 50, 4, 's'], [8, 43, 4, 's'], [12, 50, 4, 's'],
    [16, 43, 4, 's'], [20, 50, 4, 's'],
    // Mélodie piano (motif gymnopédie)
    [0, 74, 2, 'p'], [2, 71, 1, 'p'],
    [4, 71, 2, 'p'], [6, 69, 1, 'p'],
    [8, 69, 2, 'p'], [10, 67, 1, 'p'],
    [12, 67, 2, 'p'], [14, 66, 1, 'p'],
    [16, 64, 2, 'p'], [18, 66, 1, 'p'],
    [20, 67, 2, 'p'], [22, 69, 2, 'p'],
  ]
};

// CHOPIN — Prélude op.28 n°7 (très simple et beau, 8 mesures)
const SCORE_CHOPIN = {
  tempo: 60,
  totalTicks: 24,
  notes: [
    // Phrase principale (mélodie + accords)
    [0, 76, 1.5, 'p'], [1.5, 74, 0.5, 'p'], [2, 76, 1, 'p'],
    [0, 57, 3, 's'], [0, 61, 3, 's'],
    [3, 74, 1.5, 'p'], [4.5, 72, 0.5, 'p'], [5, 74, 1, 'p'],
    [3, 57, 3, 's'], [3, 60, 3, 's'],
    [6, 72, 1.5, 'p'], [7.5, 71, 0.5, 'p'], [8, 72, 1, 'p'],
    [6, 55, 3, 's'], [6, 59, 3, 's'],
    [9, 71, 1.5, 'p'], [10.5, 69, 0.5, 'p'], [11, 71, 1, 'p'],
    [9, 54, 3, 's'], [9, 57, 3, 's'],
    [12, 69, 3, 'p'], [12, 53, 3, 's'], [12, 57, 3, 's'],
    [15, 67, 3, 'p'], [15, 52, 3, 's'], [15, 55, 3, 's'],
    [18, 69, 3, 'p'], [18, 53, 3, 's'], [18, 57, 3, 's'],
    [21, 76, 3, 'p'], [21, 57, 3, 's'], [21, 61, 3, 's'],
  ]
};

// CLAIR DE LUNE (Debussy, ouverture simplifiée)
const SCORE_DEBUSSY = {
  tempo: 50,
  totalTicks: 32,
  notes: [
    // Arpèges droits + mélodie
    [0, 53, 1, 'p'], [1, 57, 1, 'p'], [2, 60, 1, 'p'], [3, 65, 1, 'p'],
    [4, 53, 1, 'p'], [5, 57, 1, 'p'], [6, 60, 1, 'p'], [7, 65, 1, 'p'],
    [8, 53, 1, 'p'], [9, 57, 1, 'p'], [10, 60, 1, 'p'], [11, 65, 1, 'p'],
    [12, 53, 1, 'p'], [13, 57, 1, 'p'], [14, 60, 1, 'p'], [15, 65, 1, 'p'],
    // Mélodie au-dessus
    [0, 72, 4, 'p'], [4, 74, 4, 'p'], [8, 76, 4, 'p'], [12, 79, 4, 'p'],
    // Reprise plus grave
    [16, 50, 1, 'p'], [17, 53, 1, 'p'], [18, 57, 1, 'p'], [19, 60, 1, 'p'],
    [20, 50, 1, 'p'], [21, 53, 1, 'p'], [22, 57, 1, 'p'], [23, 60, 1, 'p'],
    [24, 48, 1, 'p'], [25, 52, 1, 'p'], [26, 55, 1, 'p'], [27, 60, 1, 'p'],
    [28, 48, 1, 'p'], [29, 52, 1, 'p'], [30, 55, 1, 'p'], [31, 60, 1, 'p'],
    [16, 69, 4, 'p'], [20, 71, 4, 'p'], [24, 72, 8, 'p'],
  ]
};

const SCORES = {
  pachelbel: SCORE_PACHELBEL,
  bach: SCORE_BACH,
  elise: SCORE_ELISE,
  satie: SCORE_SATIE,
  chopin: SCORE_CHOPIN,
  debussy: SCORE_DEBUSSY
};

let _scheduledTimer = null;
let _currentScore = null;

function _playScore(scoreKey) {
  const score = SCORES[scoreKey];
  if (!score) return;
  _currentScore = scoreKey;
  const ctx = window._ambientCtx;
  if (!ctx) return;
  const beatDur = 60 / score.tempo;
  const loopDur = score.totalTicks * beatDur;

  function scheduleLoop() {
    if (_currentScore !== scoreKey) return;
    const startTime = ctx.currentTime + 0.05;
    score.notes.forEach(n => {
      const [t, midi, dur, instr] = n;
      const time = startTime + t * beatDur;
      const noteDur = dur * beatDur;
      if (instr === 's') _strings(time, midi, noteDur, 0.12);
      else _piano(time, midi, noteDur, 0.18);
    });
    _scheduledTimer = setTimeout(scheduleLoop, loopDur * 1000 - 50);
  }
  scheduleLoop();
}

function _stopScore() {
  _currentScore = null;
  if (_scheduledTimer) { clearTimeout(_scheduledTimer); _scheduledTimer = null; }
}

window._playScore = _playScore;
window._stopScore = _stopScore;
window._scoreKeys = Object.keys(SCORES);
