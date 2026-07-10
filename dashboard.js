// =============================================================
// dashboard.js — Tableau de bord gamifié
// Stats : pages lues, livres, temps, citations, fiches
// Gamification : niveaux, XP, badges, streaks
// =============================================================

const STATS_KEY = 'reading-stats-v1';

function _today() { return new Date().toISOString().slice(0, 10); }
function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

function _defaultStats() {
  return {
    pagesRead: {},        // {"bookId-pageNum": true}
    readingTimeMs: 0,     // total cumulé
    daily: {},            // {"YYYY-MM-DD": {minutes, pages, citations}}
    lastActiveDay: null,
    streakDays: 0,
    longestStreak: 0,
    citations: 0,
    notes: 0,
    xp: 0,
    badges: [],
    booksOpened: {}       // {bookId: true}
  };
}

function getStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return Object.assign(_defaultStats(), JSON.parse(raw));
  } catch (_) {}
  return _defaultStats();
}

function saveStats(s) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (_) {}
}

// =============================================================
// Niveaux & XP
// =============================================================
function levelFromXp(xp) {
  return Math.floor(Math.sqrt(xp / 50));
}
function xpForLevel(level) {
  return level * level * 50;
}
function titleForLevel(level) {
  if (level >= 30) return icon('star', 15) + ' Sage';
  if (level >= 20) return icon('library_books', 15) + ' Érudit';
  if (level >= 12) return icon('school', 15) + ' Étudiant';
  if (level >= 7)  return icon('search', 15) + ' Lecteur curieux';
  if (level >= 3)  return icon('menu_book', 15) + ' Apprenti';
  return icon('eco', 15) + ' Débutant';
}

// =============================================================
// Badges
// =============================================================
const BADGES = [
  { id: 'first-page',  icon: 'footprint', name: 'Premier pas',     desc: 'Lire ta toute première page', check: s => Object.keys(s.pagesRead).length >= 1 },
  { id: '100-pages',   icon: 'article', name: 'Centurion',       desc: 'Lire 100 pages au total',    check: s => Object.keys(s.pagesRead).length >= 100 },
  { id: '1000-pages',  icon: 'library_books', name: 'Millénaire',      desc: '1000 pages — un vrai lecteur', check: s => Object.keys(s.pagesRead).length >= 1000 },
  { id: '1-book',      icon: 'military_tech', name: 'Premier livre',   desc: 'Ouvrir ton premier livre',   check: s => Object.keys(s.booksOpened).length >= 1 },
  { id: '10-books',    icon: 'menu_book', name: 'Bibliophile',     desc: '10 livres dans ta bibliothèque', check: s => Object.keys(s.booksOpened).length >= 10 },
  { id: '50-books',    icon: 'trophy', name: 'Collectionneur',  desc: '50 livres — collection sérieuse', check: s => Object.keys(s.booksOpened).length >= 50 },
  { id: 'streak-3',    icon: 'local_fire_department', name: 'Régularité',      desc: '3 jours consécutifs',        check: s => s.streakDays >= 3 },
  { id: 'streak-7',    icon: 'bolt', name: 'Semaine de feu',  desc: '7 jours consécutifs',        check: s => s.streakDays >= 7 },
  { id: 'streak-30',   icon: 'diamond', name: 'Mois parfait',    desc: '30 jours consécutifs',       check: s => s.streakDays >= 30 },
  { id: '1h-day',      icon: 'schedule', name: 'Marathonien',     desc: '1 heure de lecture en une journée', check: s => Object.values(s.daily).some(d => d.minutes >= 60) },
  { id: '10-citations',icon: 'format_quote', name: 'Citateur',        desc: '10 citations archivées',     check: s => s.citations >= 10 },
  { id: '100-citations',icon: 'auto_awesome', name: 'Anthologiste',   desc: '100 citations archivées',    check: s => s.citations >= 100 },
  { id: '1-note',      icon: 'note_add', name: 'Première fiche',  desc: 'Créer ta première fiche',    check: s => s.notes >= 1 },
  { id: '10-notes',    icon: 'psychology', name: 'Bâtisseur de second cerveau', desc: '10 fiches créées', check: s => s.notes >= 10 },
  { id: 'level-5',     icon: 'workspace_premium', name: 'Niveau 5',        desc: 'Atteindre le niveau 5',     check: s => levelFromXp(s.xp) >= 5 },
  { id: 'level-10',    icon: 'stars', name: 'Niveau 10',       desc: 'Atteindre le niveau 10',    check: s => levelFromXp(s.xp) >= 10 },
  { id: 'level-20',    icon: 'crown', name: 'Niveau 20',       desc: 'Atteindre le niveau 20',    check: s => levelFromXp(s.xp) >= 20 },
];

function _checkBadges(s) {
  const newlyUnlocked = [];
  BADGES.forEach(b => {
    if (!s.badges.includes(b.id) && b.check(s)) {
      s.badges.push(b.id);
      newlyUnlocked.push(b);
    }
  });
  return newlyUnlocked;
}

function _notifyBadge(badge) {
  if (window.showToast) window.showToast(`Badge débloqué : ${badge.name}`);
}

// =============================================================
// Tracking — hooks appelés par index.html
// =============================================================
function _updateStreak(s) {
  const today = _today();
  if (s.lastActiveDay === today) return;
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  if (s.lastActiveDay === yesterdayStr) s.streakDays += 1;
  else s.streakDays = 1;
  s.longestStreak = Math.max(s.longestStreak, s.streakDays);
  s.lastActiveDay = today;
}

function _ensureDaily(s, day) {
  if (!s.daily[day]) s.daily[day] = { minutes: 0, pages: 0, citations: 0 };
  return s.daily[day];
}

function dashboardTrackPage(bookId, pageNum) {
  const s = getStats();
  const key = `${bookId || 'unknown'}-${pageNum}`;
  if (s.pagesRead[key]) return; // déjà comptée
  s.pagesRead[key] = true;
  if (bookId) s.booksOpened[bookId] = true;
  _updateStreak(s);
  _ensureDaily(s, _today()).pages += 1;
  s.xp += 1;
  const newBadges = _checkBadges(s);
  saveStats(s);
  newBadges.forEach(_notifyBadge);
}

let _readingTickInterval = null;
function dashboardStartReadingTimer() {
  if (_readingTickInterval) return;
  _readingTickInterval = setInterval(() => {
    const s = getStats();
    s.readingTimeMs += 1000;
    _updateStreak(s);
    _ensureDaily(s, _today()).minutes = +( _ensureDaily(s, _today()).minutes + 1/60).toFixed(2);
    const newBadges = _checkBadges(s);
    saveStats(s);
    newBadges.forEach(_notifyBadge);
  }, 1000);
}
function dashboardStopReadingTimer() {
  if (_readingTickInterval) { clearInterval(_readingTickInterval); _readingTickInterval = null; }
}

function dashboardTrackCitation() {
  const s = getStats();
  s.citations += 1;
  _updateStreak(s);
  _ensureDaily(s, _today()).citations += 1;
  s.xp += 5;
  const newBadges = _checkBadges(s);
  saveStats(s);
  newBadges.forEach(_notifyBadge);
}

function dashboardTrackNote() {
  const s = getStats();
  s.notes += 1;
  _updateStreak(s);
  s.xp += 50;
  const newBadges = _checkBadges(s);
  saveStats(s);
  newBadges.forEach(_notifyBadge);
}

window.dashboardTrackPage = dashboardTrackPage;
window.dashboardStartReadingTimer = dashboardStartReadingTimer;
window.dashboardStopReadingTimer = dashboardStopReadingTimer;
window.dashboardTrackCitation = dashboardTrackCitation;
window.dashboardTrackNote = dashboardTrackNote;

// Hook automatique sur notesAdd
window.addEventListener('load', () => {
  const orig = window.notesAdd;
  if (typeof orig === 'function' && !orig.__dashWrapped) {
    window.notesAdd = async function (note) {
      const id = await orig(note);
      try { dashboardTrackNote(); } catch (_) {}
      return id;
    };
    window.notesAdd.__dashWrapped = true;
  }
});

// =============================================================
// UI Dashboard
// =============================================================
function _fmtTime(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}min`;
  return `${h}h ${m}min`;
}

function _last7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// Anneau de progression SVG
function _donut(pct, size) {
  size = size || 62;
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="dash-donut" aria-hidden="true">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--bg3)" stroke-width="6"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - Math.min(100, pct) / 100)).toFixed(1)}" transform="rotate(-90 ${size/2} ${size/2})"/>
    <text x="50%" y="52%" text-anchor="middle" dominant-baseline="central" class="dash-donut-txt">${Math.round(pct)}%</text>
  </svg>`;
}

// --- Section « Mes lectures » : livres de la bibliothèque avec progression ---
async function _readingsSectionHtml() {
  let books = [];
  try { if (typeof libGetAll === 'function') books = await libGetAll(); } catch (_) {}
  if (typeof libDedupe === 'function') books = libDedupe(books); // un livre = une seule ligne
  if (!books.length) return `<div class="dash-section"><h3>${icon('auto_stories', 15)} Mes lectures</h3><div class="dash-empty">Aucune lecture — ouvre un PDF, il apparaîtra ici avec sa progression.</div></div>`;
  books.sort((a, b) => (b.lastViewedAt || b.addedAt) - (a.lastViewedAt || a.addedAt));
  // Fiches déjà écrites : un bouton « fiche » sur les livres qui en ont une
  let notes = [];
  try { if (typeof notesGetAll === 'function') notes = await notesGetAll(); } catch (_) {}
  const hasNote = (t) => typeof notesForBook === 'function' && notesForBook(t, notes).length > 0;
  const rows = books.slice(0, 8).map(b => {
    const pct = (b.lastPage && b.totalPages) ? Math.min(100, Math.round((b.lastPage / b.totalPages) * 100)) : 0;
    const sub = b.totalPages ? `page ${b.lastPage || 1} / ${b.totalPages}` : (b.lastPage ? `page ${b.lastPage}` : 'pas encore ouvert');
    const quand = b.lastViewedAt ? new Date(b.lastViewedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '';
    return `<div class="dash-book">
      <div class="dash-book-icon">${icon('picture_as_pdf', 18)}</div>
      <div class="dash-book-main">
        <div class="dash-book-head"><strong>${_esc(b.title)}</strong><small>${quand}</small></div>
        <div class="dash-book-bar"><div class="dash-book-fill" style="width:${pct}%"></div></div>
        <div class="dash-book-sub">${sub}${pct ? ` · ${pct}%` : ''}</div>
      </div>
      ${hasNote(b.title || b.name) ? `<button class="dash-note" data-note-book="${_esc(b.title || b.name)}" title="Ouvrir ma fiche de lecture">${icon('description', 16)}</button>` : ''}
      <button class="dash-resume" data-book="${b.id}" title="Reprendre la lecture">${icon('play_arrow', 16)}</button>
    </div>`;
  }).join('');
  return `<div class="dash-section"><h3>${icon('auto_stories', 15)} Mes lectures <span class="dash-badge-count">${books.length}</span></h3><div class="dash-books">${rows}</div></div>`;
}

// --- Section « Mes sujets en cours » : progression de chaque expertise ---
function _sujetsSectionHtml() {
  let sujets = [];
  try { if (typeof sujetsAll === 'function') sujets = sujetsAll(); } catch (_) {}
  if (!sujets.length) return `<div class="dash-section"><h3>${icon('school', 15)} Mes sujets en cours</h3><div class="dash-empty">Aucun sujet — lance « Maîtriser un sujet » depuis l'accueil.</div></div>`;
  sujets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const cards = sujets.map(su => {
    const total = (su.questions || []).length;
    const answered = (su.questions || []).filter(q => (q.avis || []).length > 0).length;
    const pct = total ? (answered / total) * 100 : 0;
    const cadrageOk = !!(su.videos && su.videos.trim() && su.carto && su.carto.trim());
    const profondeurOk = answered >= 30;
    const chip = (label, done, started) => `<span class="dash-chip ${done ? 'done' : (started ? 'progress' : '')}">${done ? icon('check', 12) + ' ' : ''}${label}</span>`;
    const counts = [
      total ? `${answered}/${total} questions` : 'questions à générer',
      (su.ytVideos || []).length ? `${su.ytVideos.length} vidéo${su.ytVideos.length > 1 ? 's' : ''}` : null,
      (su.livresSugg || []).length ? `${su.livresSugg.length} livre${su.livresSugg.length > 1 ? 's' : ''}` : null
    ].filter(Boolean).join(' · ');
    return `<div class="dash-sujet">
      ${_donut(pct)}
      <div class="dash-sujet-main">
        <div class="dash-sujet-head"><strong>${_esc(su.sujet)}</strong></div>
        <div class="dash-sujet-sub">${counts}</div>
        <div class="dash-chips">
          ${chip('Cadrage', cadrageOk, !!(su.videos || su.carto))}
          ${chip('Profondeur', profondeurOk, total > 0)}
        </div>
      </div>
      <button class="dash-resume" data-sujet="${su.id}" title="Reprendre ce sujet">${icon('play_arrow', 16)}</button>
    </div>`;
  }).join('');
  return `<div class="dash-section"><h3>${icon('school', 15)} Mes sujets en cours <span class="dash-badge-count">${sujets.length}</span></h3><div class="dash-sujets">${cards}</div></div>`;
}

async function openDashboard() {
  const s = getStats();
  const level = levelFromXp(s.xp);
  const xpCurrent = s.xp - xpForLevel(level);
  const xpNeeded = xpForLevel(level + 1) - xpForLevel(level);
  const xpPct = Math.min(100, (xpCurrent / xpNeeded) * 100);

  const totalPages = Object.keys(s.pagesRead).length;
  const totalBooks = Object.keys(s.booksOpened).length;

  const days = _last7Days();
  const dayLabels = days.map(d => new Date(d).toLocaleDateString('fr-FR', { weekday: 'short' }));
  const maxMin = Math.max(1, ...days.map(d => (s.daily[d]?.minutes) || 0));
  const bars = days.map((d, i) => {
    const min = (s.daily[d]?.minutes) || 0;
    const h = (min / maxMin) * 100;
    const isToday = d === _today();
    return `<div class="dash-bar-col">
      <div class="dash-bar-val">${min < 1 ? '' : Math.round(min) + 'm'}</div>
      <div class="dash-bar"><div class="dash-bar-fill ${isToday?'today':''}" style="height:${h}%"></div></div>
      <div class="dash-bar-label">${dayLabels[i]}</div>
    </div>`;
  }).join('');

  const unlocked = BADGES.filter(b => s.badges.includes(b.id));
  const locked = BADGES.filter(b => !s.badges.includes(b.id));
  const badgesHtml = `
    <div class="dash-badges">
      ${unlocked.map(b => `<div class="dash-badge unlocked" title="${_esc(b.desc)}">
        <div class="badge-icon">${icon(b.icon, 20)}</div>
        <div class="badge-name">${_esc(b.name)}</div>
      </div>`).join('')}
      ${locked.slice(0, 6).map(b => `<div class="dash-badge locked" title="${_esc(b.desc)}">
        <div class="badge-icon">${icon('lock', 14)}</div>
        <div class="badge-name">${_esc(b.name)}</div>
      </div>`).join('')}
    </div>
  `;

  const readingsHtml = await _readingsSectionHtml();
  const sujetsHtml = _sujetsSectionHtml();

  const modal = document.createElement('div');
  modal.id = 'dash-modal';
  modal.innerHTML = `
    <div class="dash-overlay"></div>
    <div class="dash-content">
      <div class="dash-header">
        <h2>${icon('monitoring', 18)} Mon tableau de bord</h2>
        <button class="dash-close">✕</button>
      </div>
      <div class="dash-body">
        ${readingsHtml}
        ${sujetsHtml}
        <div class="dash-level-card">
          <div class="dash-level-top">
            <div>
              <div class="dash-level-title">${titleForLevel(level)}</div>
              <div class="dash-level-num">Niveau ${level}</div>
            </div>
            <div class="dash-xp-text">${s.xp} XP</div>
          </div>
          <div class="dash-xp-bar">
            <div class="dash-xp-fill" style="width:${xpPct}%"></div>
          </div>
          <div class="dash-xp-needed">${xpCurrent} / ${xpNeeded} XP → niveau ${level + 1}</div>
        </div>

        <div class="dash-stats-grid">
          <div class="dash-stat">
            <div class="dash-stat-icon">${icon('article', 18)}</div>
            <div class="dash-stat-val">${totalPages}</div>
            <div class="dash-stat-label">pages lues</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-icon">${icon('library_books', 18)}</div>
            <div class="dash-stat-val">${totalBooks}</div>
            <div class="dash-stat-label">livres ouverts</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-icon">${icon('schedule', 18)}</div>
            <div class="dash-stat-val">${_fmtTime(s.readingTimeMs)}</div>
            <div class="dash-stat-label">temps total</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-icon">${icon('local_fire_department', 18)}</div>
            <div class="dash-stat-val">${s.streakDays}</div>
            <div class="dash-stat-label">jours consécutifs</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-icon">${icon('format_quote', 18)}</div>
            <div class="dash-stat-val">${s.citations}</div>
            <div class="dash-stat-label">citations</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-icon">${icon('note_add', 18)}</div>
            <div class="dash-stat-val">${s.notes}</div>
            <div class="dash-stat-label">fiches créées</div>
          </div>
        </div>

        <div class="dash-section">
          <h3>${icon('trending_up', 15)} 7 derniers jours — temps de lecture</h3>
          <div class="dash-bars">${bars}</div>
        </div>

        <div class="dash-section">
          <h3>${icon('trophy', 15)} Badges <span class="dash-badge-count">${unlocked.length}/${BADGES.length}</span></h3>
          ${badgesHtml}
        </div>

        <div class="dash-section dash-streak">
          <h3>${icon('local_fire_department', 15)} Plus longue série : <strong>${s.longestStreak} jours</strong></h3>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.dash-close').onclick = () => modal.remove();
  modal.querySelector('.dash-overlay').onclick = () => modal.remove();

  // Reprendre une lecture (ouvre le PDF à la dernière page)
  modal.querySelectorAll('[data-book]').forEach(btn => {
    btn.onclick = async () => {
      try {
        const book = await libGet(parseInt(btn.dataset.book));
        if (!book) return;
        const file = new File([book.data], book.name, { type: 'application/pdf' });
        if (book.lastPage && window.pdf) window.pdf.startPage = book.lastPage;
        modal.remove();
        await window.loadPdfFile(file);
        if (window.pdf) window.pdf.bookId = book.id;
      } catch (e) { console.warn('dash resume book', e); }
    };
  });
  // Ouvrir la fiche déjà écrite d'un livre
  modal.querySelectorAll('[data-note-book]').forEach(btn => {
    btn.onclick = () => {
      modal.remove();
      if (window.openNoteForBook) window.openNoteForBook(btn.dataset.noteBook);
    };
  });
  // Reprendre un sujet (retour au crash-test)
  modal.querySelectorAll('[data-sujet]').forEach(btn => {
    btn.onclick = () => {
      try {
        const rec = sujetsAll().find(x => x.id === parseInt(btn.dataset.sujet));
        if (!rec) return;
        window.state.sujet = Object.assign(sujetInitial(), rec);
        window.state.noteType = 'sujet';
        window.state.step = Math.max(1, STEPS_SUJET.findIndex(st => st.id === 'suj-50q'));
        window.state.done = false;
        modal.remove();
        window.render();
      } catch (e) { console.warn('dash resume sujet', e); }
    };
  });
}

window.openDashboard = openDashboard;

// =============================================================
// Bouton dans le top-bar
// =============================================================
function _injectDashboardButton() {
  const _inject = () => {
    document.querySelectorAll('.top-bar').forEach(bar => {
      if (bar.dataset.dashBtn) return;
      bar.dataset.dashBtn = '1';
      const btn = document.createElement('button');
      btn.className = 'btn-pdf-toggle';
      btn.title = 'Tableau de bord';
      btn.innerHTML = icon('monitoring');
      btn.style.marginRight = '6px';
      btn.onclick = openDashboard;
      const pdfBtn = bar.querySelector('#btn-pdf-toggle');
      if (pdfBtn) bar.insertBefore(btn, pdfBtn);
      else bar.appendChild(btn);
    });
  };
  new MutationObserver(_inject).observe(document.body, { childList: true, subtree: true });
  _inject();
}

// =============================================================
// Styles
// =============================================================
const _dashStyle = document.createElement('style');
_dashStyle.textContent = `
#dash-modal { position: fixed; inset: 0; z-index: 550; }
.dash-overlay { position: absolute; inset: 0; background: rgba(15,15,15,0.4); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
.dash-content { position: absolute; top: 4vh; left: 50%; transform: translateX(-50%); width: 92vw; max-width: 820px; max-height: 92vh; max-height: 92dvh; background: var(--bg); border-radius: var(--radius-lg); display: flex; flex-direction: column; box-shadow: var(--shadow-lg); overflow: hidden; }
.dash-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid var(--border); }
.dash-header h2 { font-size: 18px; font-weight: 700; color: var(--text); letter-spacing: -0.01em; }
.dash-close { background: transparent; border: none; font-size: 16px; cursor: pointer; color: var(--text2); padding: 4px 8px; border-radius: var(--radius); height: 28px; min-width: 28px; transition: background .1s; }
.dash-close:hover { background: var(--hover); color: var(--text); }
.dash-body { padding: 24px; overflow-y: auto; flex: 1; }
.dash-level-card { background: var(--bg2); color: var(--text); padding: 18px 20px; border-radius: var(--radius); margin-bottom: 24px; box-shadow: inset 0 0 0 1px var(--border); }
.dash-level-top { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px; flex-wrap: wrap; gap: 10px; }
.dash-level-title { font-size: 18px; font-weight: 700; color: var(--text); letter-spacing: -0.01em; }
.dash-level-num { font-size: 12px; color: var(--text2); margin-top: 2px; font-weight: 500; }
.dash-xp-text { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text); letter-spacing: -0.02em; }
.dash-xp-bar { height: 6px; background: var(--bg3); border-radius: 3px; overflow: hidden; margin-bottom: 6px; }
.dash-xp-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width .6s; }
.dash-xp-needed { font-size: 12px; color: var(--text2); }
.dash-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 24px; }
.dash-stat { padding: 14px 16px; background: var(--bg2); border-radius: var(--radius); text-align: left; box-shadow: inset 0 0 0 1px var(--border); }
.dash-stat-icon { font-size: 18px; margin-bottom: 8px; opacity: .8; }
.dash-stat-val { font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.dash-stat-label { font-size: 12px; color: var(--text2); margin-top: 4px; font-weight: 500; }
.dash-section { margin-bottom: 28px; }
.dash-section h3 { font-size: 13px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; color: var(--text2); }
.dash-badge-count { font-size: 11px; color: var(--text2); padding: 1px 8px; background: var(--bg3); border-radius: 3px; font-weight: 500; }
.dash-bars { display: flex; gap: 6px; height: 140px; align-items: flex-end; padding: 12px; background: var(--bg2); border-radius: var(--radius); box-shadow: inset 0 0 0 1px var(--border); }
.dash-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; }
.dash-bar-val { font-size: 11px; color: var(--text2); font-variant-numeric: tabular-nums; min-height: 14px; font-weight: 500; }
.dash-bar { flex: 1; width: 100%; max-width: 50px; background: var(--bg3); border-radius: 3px 3px 0 0; display: flex; align-items: flex-end; overflow: hidden; }
.dash-bar-fill { width: 100%; background: var(--text3); border-radius: 3px 3px 0 0; min-height: 2px; transition: height .4s; }
.dash-bar-fill.today { background: var(--accent); }
.dash-bar-label { font-size: 11px; color: var(--text2); text-transform: capitalize; font-weight: 500; }
.dash-badges { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 6px; }
.dash-badge { padding: 14px 8px; background: var(--bg2); border-radius: var(--radius); text-align: center; transition: background .1s; box-shadow: inset 0 0 0 1px var(--border); }
.dash-badge.unlocked { background: var(--bg2); }
.dash-badge.unlocked:hover { background: var(--bg3); }
.dash-badge.locked { opacity: .35; }
.badge-icon { font-size: 24px; margin-bottom: 6px; }
.badge-name { font-size: 11px; font-weight: 600; line-height: 1.3; color: var(--text); }
.dash-badge.locked .badge-name { color: var(--text2); }
.dash-empty { font-size: 13px; color: var(--text2); font-style: italic; padding: 14px 16px; background: var(--bg2); border-radius: var(--radius); box-shadow: inset 0 0 0 1px var(--border); }
.dash-books, .dash-sujets { display: flex; flex-direction: column; gap: 8px; }
.dash-book, .dash-sujet { display: flex; align-items: center; gap: 14px; padding: 12px 14px; background: var(--bg2); border-radius: var(--radius); box-shadow: inset 0 0 0 1px var(--border); }
.dash-book-icon { color: var(--text3); flex-shrink: 0; }
.dash-book-main, .dash-sujet-main { flex: 1; min-width: 0; }
.dash-book-head, .dash-sujet-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.dash-book-head strong, .dash-sujet-head strong { font-size: 14px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dash-book-head small { font-size: 11px; color: var(--text3); flex-shrink: 0; }
.dash-book-bar { height: 5px; background: var(--bg3); border-radius: 3px; overflow: hidden; margin-bottom: 5px; }
.dash-book-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width .5s; min-width: 2px; }
.dash-book-sub, .dash-sujet-sub { font-size: 12px; color: var(--text2); }
.dash-sujet-sub { margin-bottom: 7px; }
.dash-donut { flex-shrink: 0; }
.dash-donut-txt { font-size: 13px; font-weight: 700; fill: var(--text); font-family: inherit; font-variant-numeric: tabular-nums; }
.dash-chips { display: flex; gap: 4px; flex-wrap: wrap; }
.dash-chip { display: inline-flex; align-items: center; gap: 2px; font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 999px; background: var(--bg3); color: var(--text3); }
.dash-chip.progress { color: var(--text2); box-shadow: inset 0 0 0 1px var(--border2); background: var(--bg); }
.dash-chip.done { background: color-mix(in srgb, var(--success) 14%, transparent); color: var(--success); }
.dash-resume { flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%; border: none; background: var(--accent); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .1s; }
.dash-resume:hover { background: var(--accent-hover); }
.dash-note { flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%; border: none; background: var(--bg3); color: var(--text2); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .1s; box-shadow: inset 0 0 0 1px var(--border); }
.dash-note:hover { background: var(--hover-strong); color: var(--text); }
.dash-streak { padding: 14px 16px; background: var(--bg2); border-radius: var(--radius); box-shadow: inset 0 0 0 1px var(--border); }
.dash-streak h3 { font-size: 13px; color: var(--text2); font-weight: 500; margin: 0; }
.dash-streak strong { color: var(--text); font-size: 16px; font-weight: 700; }
@media (max-width: 600px) { .dash-content { width: 100vw; height: 100vh; height: 100dvh; top: 0; border-radius: 0; max-height: 100vh; max-height: 100dvh; } }
`;
document.head.appendChild(_dashStyle);

// =============================================================
// Init
// =============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _injectDashboardButton);
} else {
  _injectDashboardButton();
}
