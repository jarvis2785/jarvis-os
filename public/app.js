/* ── JARVIS OS — Frontend Logic ─────────────────────────────────────────── */

// ── STATE ─────────────────────────────────────────────────────────────────────
const STATE = {
  userId: null,
  profile: null,
  agenda: [],                    // unified tasks + events (rows in `tasks` table with `type`)
  chatHistory: [],
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  voiceEnabled: true,
  taskTimers: {},
  agendaTypeSelected: 'task',    // current type-toggle selection
  agendaExpanded: false          // "show more" state
};

// ── LOCALSTORAGE KEYS ─────────────────────────────────────────────────────────
const LS = {
  SESSION:  'jarvis_session',
  TOPIC1:   'jarvis_topic1',
  TOPIC2:   'jarvis_topic2',
  GROQ:     'jarvis_groq',
  TAVILY:   'jarvis_tavily',
  APIFY:    'jarvis_apify',
  agenda:   uid => `jarvis_agenda_${uid}`,
  chat:     uid => `jarvis_chat_${uid}`
};

function lsGet(key)        { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
function lsSet(key, val)   { try { localStorage.setItem(key, val); } catch {} }
function lsRemove(...keys) { keys.forEach(k => { try { localStorage.removeItem(k); } catch {} }); }

// ── AUDIO ENGINE (Web Audio API) ───────────────────────────────────────────────
const AUDIO = {
  ctx: null,
  master: null,
  ambient: null,
  processingTimer: null,
  enabled: false
};

function initAudio() {
  if (AUDIO.ctx) return AUDIO.ctx;
  try {
    AUDIO.ctx = new (window.AudioContext || window.webkitAudioContext)();
    AUDIO.master = AUDIO.ctx.createGain();
    AUDIO.master.gain.value = 1.0;
    AUDIO.master.connect(AUDIO.ctx.destination);
    AUDIO.enabled = true;
  } catch (e) {
    AUDIO.enabled = false;
  }
  return AUDIO.ctx;
}

// One-shot oscillator helper
function tone(freq, dur = 0.1, opts = {}) {
  if (!AUDIO.enabled || !AUDIO.ctx) return;
  const { type = 'sine', vol = 0.08, when = 0, attack = 0.01, target = AUDIO.master } = opts;
  const t0 = AUDIO.ctx.currentTime + when;
  const osc = AUDIO.ctx.createOscillator();
  const gain = AUDIO.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(target);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// a) CLICK
function playClick() {
  if (!AUDIO.enabled) return;
  tone(1400, 0.04, { type: 'square', vol: 0.05, attack: 0.002 });
  tone(2400, 0.03, { type: 'sine',   vol: 0.03, when: 0.01, attack: 0.001 });
}

// b) PROCESSING (looping while waiting)
function startProcessingSound() {
  if (!AUDIO.enabled || AUDIO.processingTimer) return;
  AUDIO.processingTimer = setInterval(() => {
    tone(880,  0.12, { type: 'sine', vol: 0.035, attack: 0.005 });
    setTimeout(() => tone(1100, 0.08, { type: 'sine', vol: 0.025, attack: 0.005 }), 80);
  }, 480);
}
function stopProcessingSound() {
  if (AUDIO.processingTimer) {
    clearInterval(AUDIO.processingTimer);
    AUDIO.processingTimer = null;
  }
}

// c) TASK NOTIFICATION (two-tone ascending)
function playTaskNotify() {
  if (!AUDIO.enabled) return;
  tone(659.25, 0.25, { type: 'sine', vol: 0.14, attack: 0.01 });           // E5
  tone(987.77, 0.35, { type: 'sine', vol: 0.13, when: 0.18, attack: 0.01 }); // B5
}

// d) AMBIENT HUM (continuous, gain 0.03)
function startAmbientHum() {
  if (!AUDIO.enabled || AUDIO.ambient) return;
  const ctx = AUDIO.ctx;
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const osc3 = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  filter.type = 'lowpass';
  filter.frequency.value = 240;
  osc1.type = 'sine';     osc1.frequency.value = 55;
  osc2.type = 'sine';     osc2.frequency.value = 82.41;
  osc3.type = 'triangle'; osc3.frequency.value = 110;
  gain.gain.value = 0.03;
  osc1.connect(gain);
  osc2.connect(gain);
  osc3.connect(gain);
  gain.connect(filter);
  filter.connect(AUDIO.master);
  osc1.start(); osc2.start(); osc3.start();
  AUDIO.ambient = { osc1, osc2, osc3, gain };
}

// e) JARVIS RESPONSE CHIME
function playJarvisChime() {
  if (!AUDIO.enabled) return;
  tone(880,  0.45, { type: 'sine', vol: 0.07, attack: 0.02 });
  tone(1320, 0.45, { type: 'sine', vol: 0.05, when: 0.06, attack: 0.02 });
  tone(1760, 0.40, { type: 'sine', vol: 0.03, when: 0.12, attack: 0.02 });
}

// f) BOOT SOUND (epic sequence)
function playBootSound() {
  if (!AUDIO.enabled) return;
  tone(80,   0.5,  { type: 'sawtooth', vol: 0.06 });
  tone(160,  0.4,  { type: 'sine',     vol: 0.08, when: 0.1 });
  tone(320,  0.25, { type: 'sine',     vol: 0.10, when: 0.5 });
  tone(640,  0.20, { type: 'sine',     vol: 0.10, when: 0.8 });
  tone(1280, 0.15, { type: 'sine',     vol: 0.08, when: 1.0 });
  tone(2560, 0.10, { type: 'sine',     vol: 0.06, when: 1.1 });
  // Ready chord
  tone(440,  0.7,  { type: 'sine', vol: 0.10, when: 1.5 });
  tone(554,  0.7,  { type: 'sine', vol: 0.08, when: 1.5 });
  tone(659,  0.7,  { type: 'sine', vol: 0.07, when: 1.6 });
}

// Global click sound (delegated)
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t) return;
  const trigger = t.closest('button, .task-checkbox, .cal-day, .news-item, .ig-item, .auth-tab, .pw-toggle');
  if (trigger) playClick();
});

// ── BOOT SEQUENCE ─────────────────────────────────────────────────────────────
function runBootSequence() {
  playBootSound();

  const lines = [
    { text: 'JARVIS OS v1.0 INITIALIZING...', delay: 800 },
    { text: 'LOADING CORE SYSTEMS...', delay: 1600 },
    { text: '[ OK ] NEURAL ENGINE', delay: 2200, ok: true },
    { text: '[ OK ] COMMAND INTERFACE', delay: 2700, ok: true },
    { text: 'ESTABLISHING SECURE CONNECTION...', delay: 3200 },
    { text: '[ OK ] ENCRYPTION LAYER', delay: 3800, ok: true },
    { text: '[ OK ] SUPABASE LINK', delay: 4200, ok: true },
    { text: 'READY.', delay: 4800, ready: true }
  ];

  const container = document.getElementById('boot-lines');

  lines.forEach(({ text, delay, ok, ready }) => {
    setTimeout(() => {
      const span = document.createElement('span');
      span.className = 'boot-line' + (ok || ready ? ' boot-ok' : '');
      span.textContent = text;
      container.appendChild(span);
      // Trigger animation
      requestAnimationFrame(() => {
        span.style.opacity = '0';
        span.style.animation = `fadeLineIn 0.3s forwards`;
      });
    }, delay);
  });

  setTimeout(async () => {
    document.getElementById('boot-cursor').style.display = 'none';
    const restored = await tryRestoreSession();
    if (!restored) {
      transitionTo('screen-auth');
    }
  }, 5800);
}

// ── SCREEN TRANSITIONS ─────────────────────────────────────────────────────────
function transitionTo(screenId) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  const target = document.getElementById(screenId);
  target.style.display = 'block';
  target.classList.add('active', 'fade-in');
}

// ── CLOCK ─────────────────────────────────────────────────────────────────────
function startClock() {
  const tick = () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('live-clock').textContent = `${h}:${m}:${s}`;
    document.getElementById('live-date').textContent = now.toLocaleDateString('en-US', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    }).toUpperCase();
  };
  tick();
  setInterval(tick, 1000);
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'GOOD MORNING';
  if (h < 17) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
}

// ── SESSION MANAGEMENT ────────────────────────────────────────────────────────

function saveSession(userId, accessToken) {
  lsSet(LS.SESSION, JSON.stringify({ userId, accessToken }));
}

function clearSession() {
  lsRemove(
    LS.SESSION, LS.TOPIC1, LS.TOPIC2,
    LS.GROQ, LS.TAVILY, LS.APIFY,
    LS.agenda(STATE.userId || ''),
    LS.chat(STATE.userId || '')
  );
}

function getSavedSession() {
  try {
    const raw = lsGet(LS.SESSION);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Try to restore a saved session. Returns true if successful.
async function tryRestoreSession() {
  const saved = getSavedSession();
  if (!saved?.accessToken) return false;

  try {
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: saved.accessToken })
    });
    const data = await res.json();
    if (!res.ok || !data.success) { clearSession(); return false; }

    STATE.userId  = data.user.id;
    STATE.profile = data.profile;  // { id, name, email, niche }
    saveSession(data.user.id, saved.accessToken);

    if (data.hasProfile) {
      await initDashboard();
      transitionTo('screen-dashboard');
    } else {
      transitionTo('screen-profile');
    }
    return true;
  } catch {
    clearSession();
    return false;
  }
}

// ── AUTH TABS ─────────────────────────────────────────────────────────────────
function switchAuthTab(tab) {
  const isSignin = tab === 'signin';
  document.getElementById('tab-signin').classList.toggle('active', isSignin);
  document.getElementById('tab-signup').classList.toggle('active', !isSignin);
  document.getElementById('form-signin').style.display = isSignin ? 'block' : 'none';
  document.getElementById('form-signup').style.display = isSignin ? 'none' : 'block';
  // Clear errors on tab switch
  document.getElementById('signin-error').textContent = '';
  document.getElementById('signup-error').textContent = '';
}

document.getElementById('tab-signin').addEventListener('click', () => switchAuthTab('signin'));
document.getElementById('tab-signup').addEventListener('click', () => switchAuthTab('signup'));

// ── PASSWORD SHOW/HIDE TOGGLES ────────────────────────────────────────────────
document.querySelectorAll('.pw-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.textContent = isHidden ? 'HIDE' : 'SHOW';
  });
});

// ── SIGN IN ───────────────────────────────────────────────────────────────────
async function handleSignIn() {
  const email    = document.getElementById('signin-email').value.trim();
  const password = document.getElementById('signin-password').value;
  const errEl    = document.getElementById('signin-error');

  if (!email || !password) { errEl.textContent = 'EMAIL AND PASSWORD REQUIRED.'; return; }
  errEl.textContent = '';

  const btn = document.getElementById('btn-signin');
  btn.classList.add('loading');
  btn.textContent = 'AUTHENTICATING';

  try {
    const res = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    STATE.userId  = data.user.id;
    STATE.profile = data.profile;  // { id, name, email, niche }
    saveSession(data.user.id, data.session.access_token);

    if (data.hasProfile) {
      await initDashboard();
      transitionTo('screen-dashboard');
    } else {
      transitionTo('screen-profile');
    }
  } catch (err) {
    errEl.textContent = err.message.toUpperCase();
  } finally {
    btn.classList.remove('loading');
    btn.textContent = 'ACCESS SYSTEM';
  }
}

document.getElementById('btn-signin').addEventListener('click', handleSignIn);
document.getElementById('signin-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleSignIn();
});

// ── SIGN UP ───────────────────────────────────────────────────────────────────
async function handleSignUp() {
  const name     = document.getElementById('signup-name').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const confirm  = document.getElementById('signup-confirm').value;
  const errEl    = document.getElementById('signup-error');

  if (!name || !email || !password || !confirm) {
    errEl.textContent = 'ALL FIELDS REQUIRED.'; return;
  }
  if (password.length < 6) {
    errEl.textContent = 'PASSWORD MUST BE AT LEAST 6 CHARACTERS.'; return;
  }
  if (password !== confirm) {
    errEl.textContent = 'PASSWORDS DO NOT MATCH.'; return;
  }
  errEl.textContent = '';

  const btn = document.getElementById('btn-signup');
  btn.classList.add('loading');
  btn.textContent = 'CREATING ACCOUNT';

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Supabase email confirmation required
    if (data.requiresConfirmation) {
      errEl.style.color = 'var(--green)';
      errEl.textContent = data.message;
      switchAuthTab('signin');
      document.getElementById('signin-email').value = email;
      return;
    }

    STATE.userId  = data.user.id;
    STATE.profile = data.profile;  // { id, name, email }
    saveSession(data.user.id, data.session.access_token);
    transitionTo('screen-profile');
  } catch (err) {
    errEl.textContent = err.message.toUpperCase();
  } finally {
    btn.classList.remove('loading');
    btn.textContent = 'CREATE ACCOUNT';
  }
}

document.getElementById('btn-signup').addEventListener('click', handleSignUp);
document.getElementById('signup-confirm').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleSignUp();
});

// ── PROFILE SETUP ─────────────────────────────────────────────────────────────
document.getElementById('btn-save-profile').addEventListener('click', async () => {
  const niche     = document.getElementById('profile-niche').value.trim();
  const topic1    = document.getElementById('profile-topic1').value.trim();
  const topic2    = document.getElementById('profile-topic2').value.trim();
  const groqKey   = document.getElementById('profile-groq').value.trim();
  const tavilyKey = document.getElementById('profile-tavily').value.trim();
  const apifyKey  = document.getElementById('profile-apify').value.trim();
  const errEl     = document.getElementById('profile-error');

  if (!niche || !topic1 || !topic2 || !groqKey || !tavilyKey) {
    errEl.textContent = 'NICHE, TOPICS, GROQ KEY AND TAVILY KEY ARE REQUIRED.';
    return;
  }
  errEl.textContent = '';

  const btn = document.getElementById('btn-save-profile');
  btn.classList.add('loading');
  btn.textContent = 'INITIALIZING';

  try {
    // Save only niche to Supabase
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: STATE.userId,
        name:   STATE.profile?.name || '',
        niche
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    STATE.profile = data.profile;  // { id, name, email, niche }

    // Save everything else to localStorage
    lsSet(LS.TOPIC1,  topic1);
    lsSet(LS.TOPIC2,  topic2);
    lsSet(LS.GROQ,    groqKey);
    lsSet(LS.TAVILY,  tavilyKey);
    if (apifyKey) lsSet(LS.APIFY, apifyKey);

    await initDashboard();
    transitionTo('screen-dashboard');
  } catch (err) {
    errEl.textContent = err.message.toUpperCase();
  } finally {
    btn.classList.remove('loading');
    btn.textContent = 'INITIALIZE JARVIS';
  }
});

// ── DASHBOARD INIT ─────────────────────────────────────────────────────────────
async function initDashboard() {
  const p = STATE.profile;
  const name = p?.name || 'FOUNDER';

  document.getElementById('greeting-text').textContent =
    `${getGreeting()}, ${name.toUpperCase()}`;
  document.getElementById('niche-text').textContent =
    p?.niche ? `SECTOR: ${p.niche.toUpperCase()}` : '';

  const topic1 = lsGet(LS.TOPIC1);
  const topic2 = lsGet(LS.TOPIC2);

  document.getElementById('news-title-1').textContent =
    `NEWS FEED 01 — ${(topic1 || 'TOPIC 1').toUpperCase()}`;

  // Prefill Content Intelligence inputs
  const seedUsername = topic2.toLowerCase().replace(/[^a-z0-9._]/g, '');
  document.getElementById('ig-username-input').value = seedUsername;
  document.getElementById('ig-limit-input').value    = 10;
  document.getElementById('ig-groq-input').value     = lsGet(LS.GROQ);

  startClock();
  renderCalendar();
  await Promise.all([
    loadAgenda(),
    loadNews(1)
  ]);

  requestNotificationPermission();
  startTaskNotifier();
  updateStatusDots();
  startAmbientHum();
}

// ── RECONFIGURE ───────────────────────────────────────────────────────────────
document.getElementById('btn-reconfigure').addEventListener('click', () => {
  transitionTo('screen-profile');
  document.getElementById('profile-niche').value   = STATE.profile?.niche   || '';
  document.getElementById('profile-topic1').value  = lsGet(LS.TOPIC1);
  document.getElementById('profile-topic2').value  = lsGet(LS.TOPIC2);
  document.getElementById('profile-groq').value    = '';
  document.getElementById('profile-tavily').value  = '';
  document.getElementById('profile-apify').value   = '';
});

// ── LOGOUT ────────────────────────────────────────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', async () => {
  try { await fetch('/api/auth/signout', { method: 'POST' }); } catch {}
  clearSession();   // clears all jarvis_* keys including agenda_[uid] and chat_[uid]
  window.speechSynthesis?.cancel();
  window.location.reload();
});

// ── STATUS DOTS ───────────────────────────────────────────────────────────────
function updateStatusDots() {
  document.getElementById('dot-system').classList.add('online');
  document.getElementById('dot-jarvis').classList.add('online');
  document.getElementById('dot-calendar').classList.add('online');
  document.getElementById('dot-tasks').classList.add('online');
}

function setNewsDotOnline() {
  document.getElementById('dot-news').classList.add('online');
}

// ── NEWS ───────────────────────────────────────────────────────────────────────
async function loadNews(feedNum) {
  const listEl    = document.getElementById(`news-list-${feedNum}`);
  const topic     = lsGet(LS.TOPIC1);
  const tavilyKey = lsGet(LS.TAVILY);

  if (!topic) {
    listEl.innerHTML = '<div class="loading-text">NO TOPIC CONFIGURED</div>';
    return;
  }
  if (!tavilyKey) {
    listEl.innerHTML = '<div class="loading-text">TAVILY KEY NOT SET</div>';
    return;
  }

  listEl.innerHTML = '<div class="loading-text">FETCHING INTEL...</div>';

  try {
    const res = await fetch('/api/news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, tavily_key: tavilyKey })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (!data.results?.length) {
      listEl.innerHTML = '<div class="loading-text">NO RESULTS FOUND</div>';
      return;
    }

    listEl.innerHTML = '';
    data.results.forEach(item => {
      const a = document.createElement('a');
      a.className = 'news-item';
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML = `
        <div class="news-source">${escapeHtml(item.source)}</div>
        <div class="news-headline">${escapeHtml(item.title)}</div>
        ${item.published_date ? `<div class="news-date">${formatNewsDate(item.published_date)}</div>` : ''}
      `;
      listEl.appendChild(a);
    });
    setNewsDotOnline();
  } catch (err) {
    listEl.innerHTML = `<div class="loading-text">ERROR: ${escapeHtml(err.message)}</div>`;
  }
}

document.getElementById('refresh-news-1').addEventListener('click', () => loadNews(1));

// ── CONTENT INTELLIGENCE ──────────────────────────────────────────────────────
const CONTENT_INTEL_WEBHOOK = 'http://localhost:5678/webhook/content-intelligence';

document.getElementById('btn-analyze').addEventListener('click', runContentIntelligence);
['ig-username-input', 'ig-limit-input', 'ig-groq-input'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') runContentIntelligence();
  });
});

async function runContentIntelligence() {
  const listEl = document.getElementById('ig-list');
  const btn    = document.getElementById('btn-analyze');

  const username = document.getElementById('ig-username-input').value.trim().replace(/^@/, '');
  const limit    = Math.max(1, Math.min(50, parseInt(document.getElementById('ig-limit-input').value, 10) || 10));
  const groqKey  = document.getElementById('ig-groq-input').value.trim();

  if (!username) {
    listEl.innerHTML = '<div class="intel-error">// USERNAME REQUIRED</div>';
    return;
  }
  if (!groqKey) {
    listEl.innerHTML = '<div class="intel-error">// GROQ KEY REQUIRED</div>';
    return;
  }

  // Persist groq key for next session
  lsSet(LS.GROQ, groqKey);

  // Loading state
  btn.classList.add('loading');
  btn.textContent = 'SCANNING';
  listEl.innerHTML = `
    <div class="loading-text">SCANNING @${escapeHtml(username)} — THIS TAKES ~30 SECONDS</div>
  `;

  try {
    const res = await fetch(CONTENT_INTEL_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        minLikes:    0,
        limit,
        resultsType: 'reels',
        contentType: 'all',
        groq_key:    groqKey
      })
    });

    if (!res.ok) {
      const txt = await res.text();
      listEl.innerHTML = `<div class="intel-error">// CONNECTION FAILED — ${escapeHtml(txt.slice(0, 100) || res.statusText)}</div>`;
      return;
    }

    const data = await res.json();
    renderIntelReport(data);
  } catch (err) {
    listEl.innerHTML = `<div class="intel-error">// CONNECTION FAILED — CHECK WEBHOOK</div>`;
    console.error('Content Intelligence error:', err);
  } finally {
    btn.classList.remove('loading');
    btn.textContent = 'ANALYZE';
  }
}

function renderIntelReport(data) {
  const listEl = document.getElementById('ig-list');

  if (!data || data.success === false) {
    listEl.innerHTML = `<div class="intel-error">// ANALYSIS FAILED — ${escapeHtml(data?.error || 'NO DATA')}</div>`;
    return;
  }

  const posts    = Array.isArray(data.posts) ? data.posts : [];
  const stats    = data.stats || {};
  const report   = data.report || {};
  const last7    = data.last7DaysTopPost || null;
  const topPost  = posts[0] || null;

  // Sections built piece-by-piece
  const sections = [];

  // ─ A. METRICS BAR ─
  sections.push(`
    <div class="intel-section">
      <div class="intel-label">:: METRICS</div>
      <div class="intel-metrics">
        ${metricCard('AVG VIEWS',    formatCount(stats.avgViews))}
        ${metricCard('AVG LIKES',    formatCount(stats.avgLikes))}
        ${metricCard('AVG COMMENTS', formatCount(stats.avgComments))}
        ${metricCard('TOP SCORE',    formatCount(stats.topEngagementScore))}
      </div>
    </div>
  `);

  // ─ B. ENGAGEMENT CHART ─
  if (posts.length) {
    const maxScore = Math.max(1, ...posts.map(p => Number(p.engagementScore) || 0));
    const bars = posts.map(p => {
      const score = Number(p.engagementScore) || 0;
      const pct   = Math.max(2, Math.round((score / maxScore) * 100));
      const cap   = (p.caption || '(no caption)').slice(0, 30);
      return `
        <div class="intel-bar-row">
          <div class="intel-bar-caption">${escapeHtml(cap)}</div>
          <div class="intel-bar-track">
            <div class="intel-bar-fill" style="width:${pct}%"></div>
            <span class="intel-bar-score">${formatCount(score)}</span>
          </div>
        </div>
      `;
    }).join('');

    sections.push(`
      <div class="intel-section">
        <div class="intel-label">:: ENGAGEMENT CHART</div>
        <div class="intel-chart">${bars}</div>
      </div>
    `);
  }

  // ─ C. TOP PERFORMER ─
  if (topPost) {
    sections.push(`
      <div class="intel-section">
        <div class="intel-post-block">
          <div class="intel-post-tag">// TOP PERFORMER</div>
          ${renderPostBody(topPost)}
        </div>
      </div>
    `);
  }

  // ─ D. LAST 7 DAYS ─
  if (last7) {
    sections.push(`
      <div class="intel-section">
        <div class="intel-post-block">
          <div class="intel-post-tag">// LAST 7 DAYS</div>
          ${renderPostBody(last7)}
        </div>
      </div>
    `);
  }

  // ─ E. INTEL REPORT ─
  // Executive summary
  if (report.executiveSummary) {
    sections.push(reportTextSection('EXECUTIVE SUMMARY', report.executiveSummary));
  }

  // Top hooks
  const topHooks = report.captionAnalysis?.topHooks || [];
  if (topHooks.length) {
    sections.push(reportListSection('TOP HOOKS', topHooks));
  }

  // Content ideas
  const ideas = Array.isArray(report.contentIdeas) ? report.contentIdeas : [];
  if (ideas.length) {
    const items = ideas.map(idea => {
      const title = escapeHtml(idea?.title || idea?.name || '');
      const hook  = escapeHtml(idea?.hook  || idea?.description || '');
      return `<li>
        <span class="intel-idea-title">${title}</span>
        ${hook ? `<span class="intel-idea-hook">${hook}</span>` : ''}
      </li>`;
    }).join('');
    sections.push(`
      <div class="intel-section">
        <div class="intel-label">:: CONTENT IDEAS</div>
        <ul class="intel-list">${items}</ul>
      </div>
    `);
  }

  // What to avoid (can be string or array)
  if (report.whatToAvoid) {
    if (Array.isArray(report.whatToAvoid)) {
      sections.push(reportListSection('WHAT TO AVOID', report.whatToAvoid));
    } else {
      sections.push(reportTextSection('WHAT TO AVOID', report.whatToAvoid));
    }
  }

  // Strategic recommendations
  const recs = Array.isArray(report.strategicRecommendations) ? report.strategicRecommendations : [];
  if (recs.length) {
    sections.push(reportListSection('RECOMMENDATIONS', recs));
  }

  listEl.innerHTML = `<div class="intel-report">${sections.join('')}</div>`;
}

function metricCard(label, value) {
  return `
    <div class="intel-metric">
      <div class="intel-metric-value">${value}</div>
      <div class="intel-metric-label">${label}</div>
    </div>
  `;
}

function reportTextSection(label, text) {
  return `
    <div class="intel-section">
      <div class="intel-label">:: ${escapeHtml(label)}</div>
      <div class="intel-text">${escapeHtml(text)}</div>
    </div>
  `;
}

function reportListSection(label, items) {
  const li = items
    .filter(x => x !== null && x !== undefined && x !== '')
    .map(x => `<li>${escapeHtml(typeof x === 'string' ? x : JSON.stringify(x))}</li>`)
    .join('');
  return `
    <div class="intel-section">
      <div class="intel-label">:: ${escapeHtml(label)}</div>
      <ul class="intel-list">${li}</ul>
    </div>
  `;
}

function renderPostBody(post) {
  const caption  = post.caption || '(no caption)';
  const likes    = post.likes ?? post.likesCount;
  const views    = post.views ?? post.videoViewCount ?? post.videoPlayCount ?? post.playCount;
  const comments = post.comments ?? post.commentsCount;
  const url      = post.url || '#';
  return `
    <div class="intel-post-caption">${escapeHtml(caption)}</div>
    <div class="intel-post-stats">
      ${views    != null ? `<span><span class="num">${formatCount(views)}</span> VIEWS</span>` : ''}
      ${likes    != null ? `<span><span class="num">${formatCount(likes)}</span> LIKES</span>` : ''}
      ${comments != null ? `<span><span class="num">${formatCount(comments)}</span> COMMENTS</span>` : ''}
    </div>
    <a class="intel-post-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">VIEW POST ▸</a>
  `;
}

function formatCount(n) {
  n = Number(n) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatNewsDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }).toUpperCase();
  } catch { return dateStr; }
}

// ── AGENDA (localStorage-only — no Supabase) ─────────────────────────────────
const TODAY_STR = () => new Date().toISOString().split('T')[0];
const AGENDA_VISIBLE_CAP = 10;

function newId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

function saveAgenda() {
  if (!STATE.userId) return;
  try { lsSet(LS.agenda(STATE.userId), JSON.stringify(STATE.agenda)); } catch {}
}

async function loadAgenda() {
  if (!STATE.userId) return;
  try {
    const raw = lsGet(LS.agenda(STATE.userId));
    STATE.agenda = raw ? JSON.parse(raw) : [];
  } catch {
    STATE.agenda = [];
  }
  // Normalize legacy items
  STATE.agenda = STATE.agenda.map(row => ({ ...row, type: row.type || 'task' }));
  renderAgenda();
  renderCalendar();
}

// Sort helper: by date asc (nulls last), then time asc (nulls last)
function agendaSort(a, b) {
  if (a.date && b.date) {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
  } else if (a.date) return -1;
  else if (b.date) return 1;
  if (a.time && b.time) return a.time.localeCompare(b.time);
  if (a.time) return -1;
  if (b.time) return 1;
  return 0;
}

function isOverdue(item) {
  return item.type === 'task'
      && !item.done
      && item.date
      && item.date < TODAY_STR();
}
function isToday(item) {
  return !item.done && (item.date === TODAY_STR() || (!item.date && item.type === 'task'));
}

function renderAgenda() {
  const list = document.getElementById('agenda-list');
  const showMoreBtn = document.getElementById('btn-show-more');
  list.innerHTML = '';

  const todayItems    = [];
  const upcomingItems = [];
  const completedItems = [];

  STATE.agenda.forEach(item => {
    if (item.done) completedItems.push(item);
    else if (isOverdue(item) || isToday(item)) todayItems.push(item);
    else if (item.date && item.date > TODAY_STR()) upcomingItems.push(item);
    else todayItems.push(item); // dateless events fall here as a safety net
  });

  todayItems.sort(agendaSort);
  upcomingItems.sort(agendaSort);
  completedItems.sort((a, b) => agendaSort(b, a));   // newest-done first

  // Flatten in display order, then cap if not expanded
  const allGroups = [
    { key: 'today',     label: 'TODAY',     items: todayItems     },
    { key: 'upcoming',  label: 'UPCOMING',  items: upcomingItems  },
    { key: 'completed', label: 'COMPLETED', items: completedItems }
  ];

  const totalItems = todayItems.length + upcomingItems.length + completedItems.length;
  let remainingBudget = STATE.agendaExpanded ? Infinity : AGENDA_VISIBLE_CAP;
  let hiddenCount = 0;

  allGroups.forEach(group => {
    if (!group.items.length) return;

    // How many of this group will we actually render?
    const willRender = Math.min(group.items.length, remainingBudget);
    hiddenCount += group.items.length - willRender;

    if (willRender > 0) {
      const header = document.createElement('div');
      header.className = 'agenda-group-header' + (group.key === 'completed' ? ' completed' : '');
      header.innerHTML = `<span>${group.label}</span><span class="agenda-group-count">${group.items.length}</span>`;
      list.appendChild(header);

      group.items.slice(0, willRender).forEach(item => list.appendChild(renderAgendaItem(item)));
      remainingBudget -= willRender;
    }
  });

  if (!totalItems) {
    list.innerHTML = '<div class="agenda-empty">No agenda items yet. Add one above.</div>';
  }

  // Show more button
  if (hiddenCount > 0) {
    showMoreBtn.textContent = `▼ SHOW ${hiddenCount} MORE`;
    showMoreBtn.style.display = 'block';
  } else if (STATE.agendaExpanded && totalItems > AGENDA_VISIBLE_CAP) {
    showMoreBtn.textContent = '▲ SHOW LESS';
    showMoreBtn.style.display = 'block';
  } else {
    showMoreBtn.style.display = 'none';
  }
}

function renderAgendaItem(item) {
  const div = document.createElement('div');
  let cls = 'agenda-item';
  if (item.done) cls += ' done';
  else if (isOverdue(item)) cls += ' overdue';
  else if (item.date === TODAY_STR()) cls += ' today';
  div.className = cls;
  div.dataset.id = item.id;

  const lead = item.type === 'event'
    ? `<span class="agenda-event-icon" title="Event">▣</span>`
    : `<div class="agenda-checkbox" data-id="${item.id}">${item.done ? '✓' : ''}</div>`;

  div.innerHTML = `
    ${lead}
    <span class="agenda-text">${escapeHtml(item.text)}</span>
    ${item.date ? `<span class="agenda-date-badge">${formatEventDate(item.date)}</span>` : ''}
    ${item.time ? `<span class="agenda-time-badge">${item.time}</span>` : ''}
    <button class="agenda-del-btn" data-id="${item.id}">✕</button>
  `;
  return div;
}

// Show-more toggle
document.getElementById('btn-show-more').addEventListener('click', () => {
  STATE.agendaExpanded = !STATE.agendaExpanded;
  renderAgenda();
});

// Delegated click for checkbox / delete (localStorage-only)
document.getElementById('agenda-list').addEventListener('click', (e) => {
  const checkbox = e.target.closest('.agenda-checkbox');
  const delBtn   = e.target.closest('.agenda-del-btn');

  if (checkbox) {
    const id = checkbox.dataset.id;
    const item = STATE.agenda.find(t => t.id === id);
    if (!item || item.type !== 'task') return;
    item.done = !item.done;
    saveAgenda();
    renderAgenda();
    return;
  }

  if (delBtn) {
    const id = delBtn.dataset.id;
    STATE.agenda = STATE.agenda.filter(t => t.id !== id);
    saveAgenda();
    renderAgenda();
    renderCalendar();
  }
});

// Type toggle (TASK / EVENT)
document.querySelectorAll('.type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    STATE.agendaTypeSelected = btn.dataset.type;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b === btn));
  });
});

function addAgendaItem() {
  const text = document.getElementById('agenda-input').value.trim();
  const date = document.getElementById('agenda-date').value;
  const time = document.getElementById('agenda-time').value;
  const type = STATE.agendaTypeSelected;
  if (!text) return;

  const item = {
    id:         newId(),
    user_id:    STATE.userId,
    text,
    date:       date || null,
    time:       time || null,
    done:       false,
    type,
    created_at: new Date().toISOString()
  };
  STATE.agenda.push(item);
  saveAgenda();
  renderAgenda();
  renderCalendar();
  document.getElementById('agenda-input').value = '';
  document.getElementById('agenda-date').value  = '';
  document.getElementById('agenda-time').value  = '';
}

document.getElementById('btn-add-agenda').addEventListener('click', addAgendaItem);
document.getElementById('agenda-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addAgendaItem();
});

// ── TASK NOTIFICATIONS ────────────────────────────────────────────────────────
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function startTaskNotifier() {
  setInterval(() => {
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const todayStr = now.toISOString().split('T')[0];
    STATE.agenda.forEach(item => {
      if (item.done || STATE.taskTimers[item.id]) return;
      if (!item.time || item.time !== hm) return;
      if (item.date && item.date !== todayStr) return;

      STATE.taskTimers[item.id] = true;
      playTaskNotify();
      if ('Notification' in window && Notification.permission === 'granted') {
        const label = item.type === 'event' ? 'EVENT' : 'TASK';
        new Notification('JARVIS OS', {
          body: `${label}: ${item.text}`,
          icon: '/favicon.ico'
        });
      }
    });
  }, 30000);
}

// ── CALENDAR ──────────────────────────────────────────────────────────────────
// (Dots show for ALL agenda items — tasks AND events — on their date.)

function renderCalendar() {
  const year = STATE.calYear;
  const month = STATE.calMonth;
  const today = new Date();

  document.getElementById('cal-month-label').textContent =
    new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  const agendaDates = new Set(STATE.agenda.filter(a => a.date).map(a => a.date));

  // Prev month padding
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    const day = document.createElement('div');
    day.className = 'cal-day other-month';
    day.textContent = d;
    grid.appendChild(day);
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = year === today.getFullYear() && month === today.getMonth() && d === today.getDate();
    const hasEvent = agendaDates.has(dateStr);

    const day = document.createElement('div');
    day.className = 'cal-day' + (isToday ? ' today' : '') + (hasEvent ? ' has-event' : '');
    day.textContent = d;
    day.dataset.date = dateStr;
    day.addEventListener('click', () => {
      document.getElementById('agenda-date').value = dateStr;
      document.getElementById('agenda-input').focus();
    });
    grid.appendChild(day);
  }

  // Next month padding
  const totalCells = firstDay + daysInMonth;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let d = 1; d <= remaining; d++) {
    const day = document.createElement('div');
    day.className = 'cal-day other-month';
    day.textContent = d;
    grid.appendChild(day);
  }
}

document.getElementById('cal-prev').addEventListener('click', () => {
  STATE.calMonth--;
  if (STATE.calMonth < 0) { STATE.calMonth = 11; STATE.calYear--; }
  renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
  STATE.calMonth++;
  if (STATE.calMonth > 11) { STATE.calMonth = 0; STATE.calYear++; }
  renderCalendar();
});

function formatEventDate(dateStr) {
  try {
    const [y, m, d] = dateStr.split('-');
    return new Date(Number(y), Number(m) - 1, Number(d))
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      .toUpperCase();
  } catch { return dateStr; }
}

// ── CHAT ──────────────────────────────────────────────────────────────────────
function appendChatMsg(role, text) {
  const history = document.getElementById('chat-history');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;

  if (role === 'jarvis') {
    div.innerHTML = `<span class="chat-prefix">JARVIS ▸</span>${escapeHtml(text)}`;
  } else if (role === 'user') {
    div.textContent = text;
  } else {
    div.textContent = text;
  }

  history.appendChild(div);
  history.scrollTop = history.scrollHeight;
}

function speakText(text) {
  if (!STATE.voiceEnabled) return;
  if (!('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.9;
  utter.pitch = 0.8;
  utter.volume = 1;

  const setVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    const robotVoice = voices.find(v =>
      v.name.toLowerCase().includes('daniel') ||
      v.name.toLowerCase().includes('alex') ||
      v.name.toLowerCase().includes('google uk') ||
      v.name.toLowerCase().includes('david') ||
      (v.lang === 'en-US' && !v.localService)
    ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
    if (robotVoice) utter.voice = robotVoice;
    window.speechSynthesis.speak(utter);
  };

  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.addEventListener('voiceschanged', setVoice, { once: true });
  } else {
    setVoice();
  }
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message || !STATE.userId) return;

  input.value = '';
  appendChatMsg('user', message);

  STATE.chatHistory.push({ role: 'user', content: message });

  const btn = document.getElementById('btn-send-chat');
  btn.disabled = true;
  btn.textContent = '...';
  startProcessingSound();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId:   STATE.userId,
        message,
        history:  STATE.chatHistory.slice(-10),
        groq_key: lsGet(LS.GROQ)
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    stopProcessingSound();
    playJarvisChime();
    appendChatMsg('jarvis', data.reply);
    STATE.chatHistory.push({ role: 'assistant', content: data.reply });
    speakText(data.reply);
  } catch (err) {
    stopProcessingSound();
    appendChatMsg('system-msg', `ERROR: ${err.message.toUpperCase()}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'SEND';
  }
}

document.getElementById('btn-send-chat').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendChat();
});
document.getElementById('btn-clr-chat').addEventListener('click', () => {
  document.getElementById('chat-history').innerHTML = '';
  STATE.chatHistory = [];
});

// ── VOICE TOGGLE ──────────────────────────────────────────────────────────────
document.getElementById('btn-toggle-voice').addEventListener('click', () => {
  STATE.voiceEnabled = !STATE.voiceEnabled;
  const indicator = document.getElementById('voice-status');
  const btn = document.getElementById('btn-toggle-voice');
  if (STATE.voiceEnabled) {
    indicator.textContent = '◉ VOICE ON';
    indicator.classList.remove('muted');
    btn.textContent = 'MUTE';
    window.speechSynthesis?.cancel();
  } else {
    indicator.textContent = '○ VOICE OFF';
    indicator.classList.add('muted');
    btn.textContent = 'UNMUTE';
    window.speechSynthesis?.cancel();
  }
});

// ── UTILS ──────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── INIT GATE ─────────────────────────────────────────────────────────────────
// Unlocks AudioContext (browser autoplay policy requires a user gesture).
function dismissInitOverlay() {
  initAudio();                 // user gesture → audio is allowed now
  if (AUDIO.ctx?.state === 'suspended') AUDIO.ctx.resume();
  const overlay = document.getElementById('init-overlay');
  overlay.classList.add('hidden');
  document.getElementById('screen-boot').classList.add('active');
  runBootSequence();
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-initialize').addEventListener('click', dismissInitOverlay);
  // Allow clicking anywhere on the overlay
  document.getElementById('init-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'init-overlay' || e.target.id === 'init-content') dismissInitOverlay();
  });
});
