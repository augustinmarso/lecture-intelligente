// =============================================================
// gdrive.js — Synchronisation Google Drive (OAuth implicit / GIS)
// =============================================================

const GDRIVE_CLIENT_ID = '700087448482-7i5hq25p4c5t9jj5tdc5ihjs1leivl60.apps.googleusercontent.com';
const GDRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file';
const GDRIVE_FOLDER_NAME = 'Lecture Intelligente';

let _gapiInited = false;
let _gisInited = false;
let _tokenClient = null;
let _gdToken = null;
let _gdUserEmail = null;

function _gdSetStatus(text, connected) {
  const el = document.getElementById('gd-status');
  if (el) { el.textContent = text; el.className = 'gd-status' + (connected ? ' connected' : ''); }
  document.querySelectorAll('.gd-need-auth').forEach(b => b.disabled = !connected);
  const c = document.getElementById('gd-connect');
  if (c) c.style.display = connected ? 'none' : '';
}

function _gapiWait() {
  return new Promise((resolve) => {
    const check = () => {
      if (window.gapi) {
        gapi.load('client', async () => {
          try {
            await gapi.client.init({
              discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
            });
            _gapiInited = true;
            resolve();
          } catch (e) { console.warn('gapi init err', e); resolve(); }
        });
      } else setTimeout(check, 250);
    };
    check();
  });
}

function _gisWait() {
  return new Promise((resolve) => {
    const check = () => {
      if (window.google && google.accounts && google.accounts.oauth2) {
        _tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: GDRIVE_CLIENT_ID,
          scope: GDRIVE_SCOPES,
          callback: async (resp) => {
            if (resp.error) {
              _gdSetStatus('Erreur : ' + resp.error, false);
              if (window.showToast) window.showToast('Connexion Drive refusée');
              return;
            }
            _gdToken = resp.access_token;
            if (window.gapi && gapi.client) gapi.client.setToken({ access_token: _gdToken });
            try {
              const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: 'Bearer ' + _gdToken }
              });
              const u = await r.json();
              _gdUserEmail = u.email || 'connecté';
            } catch (_) { _gdUserEmail = 'connecté'; }
            _gdSetStatus('✓ ' + _gdUserEmail, true);
            if (window.showToast) window.showToast('Drive connecté ✓');
          }
        });
        _gisInited = true;
        resolve();
      } else setTimeout(check, 250);
    };
    check();
  });
}

async function gdInit() {
  await Promise.all([_gapiWait(), _gisWait()]);
}

function gdSignIn() {
  if (!_tokenClient) { if (window.showToast) window.showToast('Drive non encore prêt, attend 1s'); return; }
  _tokenClient.requestAccessToken({ prompt: _gdToken ? '' : 'consent' });
}

function gdSignOut() {
  if (_gdToken) {
    try { google.accounts.oauth2.revoke(_gdToken, () => {}); } catch (_) {}
    _gdToken = null;
    _gdUserEmail = null;
    if (window.gapi && gapi.client) gapi.client.setToken(null);
    _gdSetStatus('Non connecté', false);
    if (window.showToast) window.showToast('Drive déconnecté');
  }
}

async function gdEnsureFolder() {
  const r = await gapi.client.drive.files.list({
    q: `name='${GDRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)'
  });
  if (r.result.files && r.result.files.length) return r.result.files[0].id;
  const c = await gapi.client.drive.files.create({
    resource: { name: GDRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id'
  });
  return c.result.id;
}

async function gdUploadPdf(name, arrayBuffer, folderId) {
  const metadata = { name, parents: [folderId], mimeType: 'application/pdf' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([arrayBuffer], { type: 'application/pdf' }));
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + _gdToken },
    body: form
  });
  if (!r.ok) throw new Error('Upload failed: ' + r.status);
  return r.json();
}

async function gdListPdfs(folderId) {
  const r = await gapi.client.drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
    fields: 'files(id,name,size,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 200
  });
  return r.result.files || [];
}

async function gdDownloadPdf(fileId) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: 'Bearer ' + _gdToken }
  });
  if (!r.ok) throw new Error('Download failed: ' + r.status);
  return await r.arrayBuffer();
}

async function gdSyncUp() {
  if (!_gdToken) { gdSignIn(); return; }
  if (window.showToast) window.showToast('Sauvegarde vers Drive…');
  const folderId = await gdEnsureFolder();
  const existing = await gdListPdfs(folderId);
  const existingNames = new Set(existing.map(f => f.name));
  const local = await libGetAll();
  let uploaded = 0, skipped = 0;
  for (const book of local) {
    if (existingNames.has(book.name)) { skipped++; continue; }
    try {
      await gdUploadPdf(book.name, book.data, folderId);
      uploaded++;
    } catch (e) { console.warn('upload failed for ' + book.name, e); }
  }
  if (window.showToast) window.showToast(`✓ ${uploaded} envoyé${uploaded>1?'s':''}, ${skipped} déjà présent${skipped>1?'s':''}`);
}

async function gdSyncDown() {
  if (!_gdToken) { gdSignIn(); return; }
  if (window.showToast) window.showToast('Import depuis Drive…');
  const folderId = await gdEnsureFolder();
  const remote = await gdListPdfs(folderId);
  const local = await libGetAll();
  const localKeys = new Set(local.map(b => b.name + '|' + b.size));
  let imported = 0;
  for (const f of remote) {
    const sz = parseInt(f.size || '0');
    if (localKeys.has(f.name + '|' + sz)) continue;
    try {
      const buf = await gdDownloadPdf(f.id);
      await libAdd({
        title: f.name.replace(/\.pdf$/i,''),
        name: f.name,
        size: buf.byteLength,
        mime: 'application/pdf',
        data: buf,
        addedAt: new Date(f.modifiedTime).getTime() || Date.now(),
        gdriveId: f.id
      });
      imported++;
    } catch (e) { console.warn('download failed for ' + f.name, e); }
  }
  if (window.showToast) window.showToast(`✓ ${imported} importé${imported>1?'s':''}`);
  if (typeof renderLibrary === 'function') await renderLibrary();
}

// =============================================================
// UI : Bar Drive injectée dans la modal Bibliothèque
// =============================================================
function _gdInjectUI() {
  const obs = new MutationObserver(() => {
    const modal = document.querySelector('#lib-modal .lib-content');
    if (!modal || modal.dataset.gdWired) return;
    const header = modal.querySelector('.lib-header');
    if (!header) return;
    modal.dataset.gdWired = '1';
    const bar = document.createElement('div');
    bar.className = 'gd-bar';
    bar.innerHTML = `
      <div class="gd-left">
        <strong>☁ Google Drive</strong>
        <span id="gd-status" class="gd-status">Non connecté</span>
      </div>
      <div class="gd-actions">
        <button id="gd-connect" class="gd-btn gd-primary">Connecter</button>
        <button id="gd-up" class="gd-btn gd-need-auth" disabled title="Envoyer tous mes PDFs locaux vers Drive">↑ Sauvegarder</button>
        <button id="gd-down" class="gd-btn gd-need-auth" disabled title="Récupérer les PDFs depuis Drive">↓ Importer</button>
        <button id="gd-disconnect" class="gd-btn gd-need-auth" disabled title="Déconnexion">✕</button>
      </div>
    `;
    header.insertAdjacentElement('afterend', bar);
    document.getElementById('gd-connect').onclick = gdSignIn;
    document.getElementById('gd-up').onclick = gdSyncUp;
    document.getElementById('gd-down').onclick = gdSyncDown;
    document.getElementById('gd-disconnect').onclick = gdSignOut;
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// =============================================================
// Styles
// =============================================================
const _gdStyle = document.createElement('style');
_gdStyle.textContent = `
.gd-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 18px; border-bottom: 0.5px solid var(--border); background: var(--bg2); flex-wrap: wrap; }
.gd-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.gd-left strong { font-size: 13px; }
.gd-status { font-size: 12px; color: var(--text2); padding: 2px 8px; border-radius: 4px; background: var(--bg3); }
.gd-status.connected { color: #16a34a; background: rgba(22,163,74,.15); font-weight: 500; }
.gd-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.gd-btn { padding: 6px 10px; border: 0.5px solid var(--border2); background: var(--bg); color: var(--text); border-radius: var(--radius); font-family: inherit; font-size: 12px; cursor: pointer; transition: background .15s; }
.gd-btn:hover:not(:disabled) { background: var(--bg3); }
.gd-btn:disabled { opacity: .4; cursor: not-allowed; }
.gd-primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
.gd-primary:hover:not(:disabled) { background: #1765cc; }
@media (prefers-color-scheme: dark) {
  .gd-status.connected { color: #4ade80; background: rgba(74,222,128,.15); }
}
`;
document.head.appendChild(_gdStyle);

// =============================================================
// Init
// =============================================================
window.addEventListener('load', async () => {
  _gdInjectUI();
  try {
    await gdInit();
    console.log('Google Drive prêt');
  } catch (e) {
    console.warn('Google Drive init failed', e);
  }
});
