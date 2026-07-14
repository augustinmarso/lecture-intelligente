// =============================================================
// voice.js — Dictée vocale 100 % HORS-LIGNE.
//
// Remplace l'API Web Speech de Chrome (qui envoyait l'audio chez
// Google → cassée hors-ligne ET dans Electron, faute de clé du
// service Google) par Whisper qui tourne LOCALEMENT dans le
// navigateur via transformers.js (WebGPU si dispo, sinon WASM).
//
// Tout est auto-hébergé (aucune requête réseau à l'exécution) :
//   vendor/transformers.web.min.js   (lib)
//   vendor/ort/*.wasm|.mjs           (runtime ONNX)
//   models/Xenova/whisper-base/…     (modèle ~73 Mo, quantifié q8)
//
// UX : clic micro → enregistre (pulse) → re-clic → transcrit →
// insère le texte dans le champ. Le modèle se charge à la 1re
// utilisation (message d'attente), puis reste en mémoire.
// =============================================================

(function () {
  const MODEL = 'Xenova/whisper-base';
  // Base = dossier où se trouve la page (marche sur github.io/lecture-intelligente/
  // comme sur http://localhost:5200/ de l'app de bureau).
  const BASE = document.baseURI.replace(/[^/]*$/, '');

  let _pipe = null;       // pipeline chargé
  let _loading = null;    // promesse de chargement en cours
  let _rec = null;        // MediaRecorder actif
  let _activeBtn = null;  // bouton en cours d'enregistrement

  function toast(m) { if (window.showToast) window.showToast(m); }

  // Charge transformers.js + le modèle (une seule fois), tout en local.
  async function ensurePipeline() {
    if (_pipe) return _pipe;
    if (_loading) return _loading;
    _loading = (async () => {
      toast('Préparation de la dictée vocale (1re fois)…');
      const { pipeline, env } = await import(BASE + 'vendor/transformers-v3.min.js');
      // 100 % local : jamais de requête vers huggingface.co ni un CDN
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = BASE + 'models/';
      env.backends.onnx.wasm.wasmPaths = BASE + 'vendor/ort/';
      // WASM (q8) : fiable partout. WebGPU est écarté car le modèle quantifié
      // q8 s'y bloque (int8 mal supporté). La vitesse vient du multi-thread
      // WASM, activé quand la page est « cross-origin isolated » (en-têtes
      // COOP/COEP posés par le serveur Electron ; repli mono-thread sinon).
      _pipe = await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8', device: 'wasm' });
      return _pipe;
    })();
    try { return await _loading; }
    catch (e) { _loading = null; throw e; }
  }

  // Blob audio (webm/opus de MediaRecorder) → Float32Array 16 kHz mono.
  async function blobToPcm16k(blob) {
    const buf = await blob.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    // AudioContext calé à 16 kHz : Chromium resample tout seul au décodage.
    const ac = new Ctx({ sampleRate: 16000 });
    const decoded = await ac.decodeAudioData(buf);
    ac.close && ac.close();
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
    const out = new Float32Array(decoded.length);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const d = decoded.getChannelData(ch);
      for (let i = 0; i < d.length; i++) out[i] += d[i] / decoded.numberOfChannels;
    }
    return out;
  }

  async function transcribe(blob, targetEl) {
    let pcm;
    try { pcm = await blobToPcm16k(blob); }
    catch (_) { toast('Audio illisible — réessaie'); return; }
    if (!pcm || pcm.length < 1600) { toast('Rien entendu — parle un peu plus longtemps'); return; }
    let pipe;
    try { pipe = await ensurePipeline(); }
    catch (e) { toast('Modèle vocal indisponible : ' + e.message); return; }
    toast('Transcription…');
    try {
      const out = await pipe(pcm, { language: 'french', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
      const text = (out && out.text || '').trim();
      if (!text) { toast('Rien reconnu'); return; }
      let base = targetEl.value || '';
      if (base && !/[\s\n]$/.test(base)) base += ' ';
      targetEl.value = (base + text).trim();
      targetEl.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {
      toast('Erreur de transcription : ' + e.message);
    }
  }

  async function startRecording(btn, targetEl) {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) {
      toast(e && e.name === 'NotAllowedError' ? 'Micro refusé — autorise l\'accès' : 'Micro indisponible');
      return;
    }
    const chunks = [];
    let mr;
    try { mr = new MediaRecorder(stream); }
    catch (_) { stream.getTracks().forEach(t => t.stop()); toast('Enregistrement non supporté'); return; }
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      btn.classList.remove('listening');
      _rec = null; _activeBtn = null;
      if (chunks.length) await transcribe(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }), targetEl);
    };
    _rec = mr; _activeBtn = btn;
    btn.classList.add('listening');
    mr.start();
  }

  function attach(wrapEl, targetEl) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mic-btn';
    btn.title = 'Dictée vocale hors-ligne (fr)';
    btn.innerHTML = window.icon ? window.icon('mic', 15) : '🎙';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (_rec && _activeBtn === btn) { try { _rec.stop(); } catch (_) {} return; } // 2e clic = stop
      if (_rec) { try { _rec.stop(); } catch (_) {} }                                // stop un autre champ
      startRecording(btn, targetEl);
    });
    wrapEl.appendChild(btn);
  }

  window.liVoice = { attach, supported: !!(navigator.mediaDevices && window.MediaRecorder) };
})();
