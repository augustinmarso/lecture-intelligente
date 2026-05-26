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
  if (level >= 30) return '🌟 Sage';
  if (level >= 20) return '📚 Érudit';
  if (level >= 12) return '🎓 Étudiant';
  if (level >= 7)  return '🔍 Lecteur curieux';
  if (level >= 3)  return '📖 Apprenti';
  return '🌱 Débutant';
}

// =============================================================
// Badges
// =============================================================
const BADGES = [
  { id: 'first-page',  icon: '👣', name: 'Premier pas',     desc: 'Lire ta toute première page', check: s => Object.keys(s.pagesRead).length >= 1 },
  { id: '100-pages',   icon: '📄', name: 'Centurion',       desc: 'Lire 100 pages au total',    check: s => Object.keys(s.pagesRead).length >= 100 },
  { id: '1000-pages',  icon: '📚', name: 'Millénaire',      desc: '1000 pages — un vrai lecteur', check: s => Object.keys(s.pagesRead).length >= 1000 },
  { id: '1-book',      icon: '🥉', name: 'Premier livre',   desc: 'Ouvrir ton premier livre',   check: s => Object.keys(s.booksOpened).length >= 1 },
  { id: '10-books',    icon: '📖', name: 'Bibliophile',     desc: '10 livres dans ta bibliothèque', check: s => Object.keys(s.booksOpened).length >= 10 },
  { id: '50-books',    icon: '🏆', name: 'Collectionneur',  desc: '50 livres — collection sérieuse', check: s => Object.keys(s.booksOpened).length >= 50 },
  { id: 'streak-3',    icon: '🔥', name: 'Régularité',      desc: '3 jours consécutifs',        check: s => s.streakDays >= 3 },
  { id: 'streak-7',    icon: '⚡', name: 'Semaine de feu',  desc: '7 jours consécutifs',        check: s => s.streakDays >= 7 },
  { id: 'streak-30',   icon: '💎', name: 'Mois parfait',    desc: '30 jours consécutifs',       check: s => s.streakDays >= 30 },
  { id: '1h-day',      icon: '⏰', name: 'Marathonien',     desc: '1 heure de lecture en une journée', check: s => Object.values(s.daily).some(d => d.minutes >= 60) },
  { id: '10-citations',icon: '📜', name: 'Citateur',        desc: '10 citations archivées',     check: s => s.citations >= 10 },
  { id: '100-citations',icon: '✨', name: 'Anthologiste',   desc: '100 citations archivées',    check: s => s.citations >= 100 },
  { id: '1-note',      icon: '📝', name: 'Première fiche',  desc: 'Créer ta première fiche',    check: s => s.notes >= 1 },
  { id: '10-notes',    icon: '🧠', name: 'Bâtisseur de second cerveau', desc: '10 fiches créées', check: s => s.notes >= 10 },
  { id: 'level-5',     icon: '🎖', name: 'Niveau 5',        desc: 'Atteindre le niveau 5',     check: s => levelFromXp(s.xp) >= 5 },
  { id: 'level-10',    icon: '🏅', name: 'Niveau 10',       desc: 'Atteindre le niveau 10',    check: s => levelFromXp(s.xp) >= 10 },
  { id: 'level-20',    icon: '👑', name: 'Niveau 20',       desc: 'Atteindre le niveau 20',    check: s => levelFromXp(s.xp) >= 20 },
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
  if (window.showToast) window.showToast(`🎉 Badge débloqué : ${badge.icon} ${badge.name}`);
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

function openDashboard() {
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
        <div class="badge-icon">${b.icon}</div>
        <div class="badge-name">${_esc(b.name)}</div>
      </div>`).join('')}
      ${locked.slice(0, 6).map(b => `<div class="dash-badge locked" title="${_esc(b.desc)}">
        <div class="badge-icon">🔒</div>
        <div class="badge-name">${_esc(b.name)}</div>
      </div>`).join('')}
    </div>
  `;

  const modal = document.createElement('div');
  modal.id = 'dash-modal';
  modal.innerHTML = `
    <div class="dash-overlay"></div>
    <div class="dash-content">
      <div class="dash-header">
        <h2>📊 Mon tableau de bord</h2>
        <button class="dash-close">✕</button>
      </div>
      <div class="dash-body">
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
            <div class="dash-stat-icon">📄</div>
            <div class="dash-stat-val">${totalPages}</div>
            <div class="dash-stat-label">pages lues</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-icon">📚</div>
            <div class="dash-stat-val">${totalBooks}</div>
            <div class="dash-stat-label">livres ouverts</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-icon">⏱</div>
            <div class="dash-stat-val">${_fmtTime(s.readingTimeMs)}</div>
            <div class="dash-stat-label">temps total</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-icon">🔥</div>
            <div class="dash-stat-val">${s.streakDays}</div>
            <div class="dash-stat-label">jours consécutifs</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-icon">📜</div>
            <div class="dash-stat-val">${s.citations}</div>
            <div class="dash-stat-label">citations</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-icon">📝</div>
            <div class="dash-stat-val">${s.notes}</div>
            <div class="dash-stat-label">fiches créées</div>
          </div>
        </div>

        <div class="dash-section">
          <h3>📈 7 derniers jours — temps de lecture</h3>
          <div class="dash-bars">${bars}</div>
        </div>

        <div class="dash-section">
          <h3>🏆 Badges <span class="dash-badge-count">${unlocked.length}/${BADGES.length}</span></h3>
          ${badgesHtml}
        </div>

        <div class="dash-section dash-streak">
          <h3>🔥 Plus longue série : <strong>${s.longestStreak} jours</strong></h3>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.dash-close').onclick = () => modal.remove();
  modal.querySelector('.dash-overlay').onclick = () => modal.remove();
}

window.openDashboard = openDashboard;

// =============================================================
// Bouton dans le top-bar
// =============================================================
function _injectDashboardButton() {
  const obs = new MutationObserver(() => {
    document.querySelectorAll('.top-bar').forEach(bar => {
      if (bar.dataset.dashBtn) return;
      bar.dataset.dashBtn = '1';
      const btn = document.createElement('button');
      btn.className = 'btn-pdf-toggle';
      btn.title = 'Mon tableau de bord';
      btn.textContent = '📊';
      btn.style.marginRight = '6px';
      btn.onclick = openDashboard;
      const pdfBtn = bar.querySelector('#btn-pdf-toggle');
      if (pdfBtn) bar.insertBefore(btn, pdfBtn);
      else bar.appendChild(btn);
    });
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// =============================================================
// Styles
// =============================================================
const _dashStyle = document.createElement('style');
_dashStyle.textContent = `
#dash-modal { position: fixed; inset: 0; z-index: 550; }
.dash-overlay { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
.dash-content { position: absolute; top: 4vh; left: 50%; transform: translateX(-50%); width: 92vw; max-width: 820px; max-height: 92vh; background: var(--bg); border-radius: var(--radius-lg); display: flex; flex-direction: column; box-shadow: 0 12px 50px rgba(0,0,0,.4); overflow: hidden; }
.dash-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 0.5px solid var(--border); }
.dash-header h2 { font-family: 'Lora', serif; font-size: 22px; font-weight: 500; }
.dash-close { background: transparent; border: none; font-size: 18px; cursor: pointer; color: var(--text2); padding: 6px 12px; border-radius: var(--radius); }
.dash-close:hover { background: var(--bg2); }
.dash-body { padding: 20px; overflow-y: auto; flex: 1; }
.dash-level-card { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #7c3aed)); color: #fff; padding: 18px 20px; border-radius: var(--radius-lg); margin-bottom: 18px; }
.dash-level-top { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 10px; flex-wrap: wrap; gap: 10px; }
.dash-level-title { font-family: 'Lora', serif; font-size: 22px; font-weight: 500; }
.dash-level-num { font-size: 12px; opacity: .85; letter-spacing: .04em; text-transform: uppercase; }
.dash-xp-text { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dash-xp-bar { height: 8px; background: rgba(255,255,255,.2); border-radius: 4px; overflow: hidden; margin-bottom: 6px; }
.dash-xp-fill { height: 100%; background: #fff; border-radius: 4px; transition: width .6s; }
.dash-xp-needed { font-size: 11px; opacity: .85; }
.dash-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 22px; }
.dash-stat { padding: 14px; background: var(--bg2); border-radius: var(--radius); text-align: center; }
.dash-stat-icon { font-size: 22px; margin-bottom: 4px; }
.dash-stat-val { font-family: 'Lora', serif; font-size: 22px; font-weight: 500; color: var(--text); }
.dash-stat-label { font-size: 11px; color: var(--text2); letter-spacing: .04em; text-transform: uppercase; }
.dash-section { margin-bottom: 22px; }
.dash-section h3 { font-size: 14px; font-weight: 500; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.dash-badge-count { font-size: 11px; color: var(--text2); padding: 2px 8px; background: var(--bg2); border-radius: 999px; }
.dash-bars { display: flex; gap: 6px; height: 140px; align-items: flex-end; padding: 10px; background: var(--bg2); border-radius: var(--radius); }
.dash-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; }
.dash-bar-val { font-size: 10px; color: var(--text2); font-variant-numeric: tabular-nums; min-height: 12px; }
.dash-bar { flex: 1; width: 100%; max-width: 50px; background: var(--bg3); border-radius: 3px 3px 0 0; display: flex; align-items: flex-end; overflow: hidden; }
.dash-bar-fill { width: 100%; background: var(--accent); border-radius: 3px 3px 0 0; min-height: 2px; transition: height .4s; }
.dash-bar-fill.today { background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #7c3aed)); }
.dash-bar-label { font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: .04em; }
.dash-badges { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 8px; }
.dash-badge { padding: 12px 8px; background: var(--bg2); border-radius: var(--radius); text-align: center; transition: transform .15s; }
.dash-badge.unlocked { background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 15%, var(--bg2)), var(--bg2)); border: 0.5px solid color-mix(in srgb, var(--accent) 40%, transparent); }
.dash-badge.unlocked:hover { transform: translateY(-2px); }
.dash-badge.locked { opacity: .4; }
.badge-icon { font-size: 26px; margin-bottom: 6px; }
.badge-name { font-size: 11px; font-weight: 500; line-height: 1.3; }
.dash-streak h3 { font-size: 13px; color: var(--text2); font-weight: 400; }
.dash-streak strong { color: var(--accent); font-size: 16px; }
@media (max-width: 600px) { .dash-content { width: 100vw; height: 100vh; top: 0; border-radius: 0; max-height: 100vh; } }
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
