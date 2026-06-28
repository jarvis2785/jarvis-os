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
  agendaExpanded: false,         // "show more" state
  pendingCalendar: null,           // multi-turn calendar context { title, date, time, type, awaiting }
  calSelectedDate: null            // date cell clicked on the calendar, filters agenda panel
};

// ── LOCALSTORAGE KEYS ─────────────────────────────────────────────────────────
const LS = {
  SESSION:  'jarvis_session',
  TOPIC1:   'jarvis_topic1',
  TOPIC2:   'jarvis_topic2',
  GROQ:     'jarvis_groq',
  TAVILY:   'jarvis_tavily',
  APIFY:    'jarvis_apify',
  SCRAPEBOT:       'jarvis_scrapebot',
  CONFIG_COMPLETE: 'jarvis_config_complete',
  agenda:          uid => `jarvis_agenda_${uid}`,
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
    LS.SESSION, LS.CONFIG_COMPLETE,
    LS.agenda(STATE.userId || ''),
    LS.chat(STATE.userId || '')
  );
  // API keys (GROQ, TAVILY, APIFY, SCRAPEBOT) and topics (TOPIC1, TOPIC2) are
  // intentionally kept so the user doesn't have to re-enter them on every login.
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

    const keysExist = lsGet(LS.GROQ) && lsGet(LS.TAVILY) && lsGet(LS.APIFY) && lsGet(LS.SCRAPEBOT);
    if (keysExist) lsSet(LS.CONFIG_COMPLETE, 'true');
    if (data.hasProfile && keysExist) {
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

    const keysExist = lsGet(LS.GROQ) && lsGet(LS.TAVILY) && lsGet(LS.APIFY) && lsGet(LS.SCRAPEBOT);
    if (keysExist) lsSet(LS.CONFIG_COMPLETE, 'true');
    if (data.hasProfile && keysExist) {
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

// ── PROFILE FIELD VALIDATION ──────────────────────────────────────────────────
const PROFILE_FIELDS = [
  { id: 'profile-niche'     },
  { id: 'profile-topic1'    },
  { id: 'profile-topic2'    },
  { id: 'profile-groq'      },
  { id: 'profile-tavily'    },
  { id: 'profile-apify'     },
  { id: 'profile-scrapebot' }
];

function clearProfileFieldErrors() {
  PROFILE_FIELDS.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('field-error');
    document.getElementById(`err-${id}`)?.remove();
  });
}

function validateProfileForm() {
  clearProfileFieldErrors();
  let valid = true;
  PROFILE_FIELDS.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (!el || el.value.trim()) return;
    el.classList.add('field-error');
    const errDiv = document.createElement('div');
    errDiv.className = 'field-error-msg';
    errDiv.id = `err-${id}`;
    errDiv.textContent = 'This field is required';
    el.insertAdjacentElement('afterend', errDiv);
    valid = false;
  });
  return valid;
}

// ── PROFILE SETUP ─────────────────────────────────────────────────────────────
document.getElementById('btn-save-profile').addEventListener('click', async () => {
  if (!validateProfileForm()) return;

  const niche        = document.getElementById('profile-niche').value.trim();
  const topic1       = document.getElementById('profile-topic1').value.trim();
  const topic2       = document.getElementById('profile-topic2').value.trim();
  const groqKey      = document.getElementById('profile-groq').value.trim();
  const tavilyKey    = document.getElementById('profile-tavily').value.trim();
  const apifyKey     = document.getElementById('profile-apify').value.trim();
  const scrapebotKey = document.getElementById('profile-scrapebot').value.trim();
  const errEl        = document.getElementById('profile-error');
  errEl.textContent  = '';

  const btn = document.getElementById('btn-save-profile');
  btn.classList.add('loading');
  btn.textContent = 'INITIALIZING';

  try {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: STATE.userId, name: STATE.profile?.name || '', niche })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    STATE.profile = data.profile;

    lsSet(LS.TOPIC1,          topic1);
    lsSet(LS.TOPIC2,          topic2);
    lsSet(LS.GROQ,            groqKey);
    lsSet(LS.TAVILY,          tavilyKey);
    lsSet(LS.APIFY,           apifyKey);
    lsSet(LS.SCRAPEBOT,       scrapebotKey);
    lsSet(LS.CONFIG_COMPLETE, 'true');

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
  const name = p?.name || p?.email || 'FOUNDER';

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
  clearProfileFieldErrors();
  transitionTo('screen-profile');
  document.getElementById('profile-niche').value     = STATE.profile?.niche || '';
  document.getElementById('profile-topic1').value    = lsGet(LS.TOPIC1);
  document.getElementById('profile-topic2').value    = lsGet(LS.TOPIC2);
  document.getElementById('profile-groq').value      = lsGet(LS.GROQ);
  document.getElementById('profile-tavily').value    = lsGet(LS.TAVILY);
  document.getElementById('profile-apify').value     = lsGet(LS.APIFY);
  document.getElementById('profile-scrapebot').value = lsGet(LS.SCRAPEBOT);
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
    return data.results;
  } catch (err) {
    const msg = String(err.message || err);
    if (isExhaustedError(msg)) {
      listEl.innerHTML = `<div class="loading-text">${escapeHtml(exhaustedMessage('tavily'))}</div>`;
    } else {
      listEl.innerHTML = `<div class="loading-text">ERROR: ${escapeHtml(msg)}</div>`;
    }
  }
}

document.getElementById('refresh-news-1').addEventListener('click', () => loadNews(1));

// ── API KEY ERROR HELPERS ─────────────────────────────────────────────────────
// Where to regenerate each provider's key (shown when a key is exhausted).
const KEY_HELP = {
  groq:      { label: 'Groq',        url: 'console.groq.com' },
  apify:     { label: 'Apify',       url: 'apify.com/account/integrations' },
  scrapebot: { label: 'ScrapingBot', url: 'scrapingbot.io/dashboard' },
  tavily:    { label: 'Tavily',      url: 'tavily.com/dashboard' }
};

// True when an error string looks like a rate-limit / quota / exhausted-key failure.
function isExhaustedError(text) {
  return /\b(limit|quota|exhausted|rate|insufficient|exceeded|403|429)\b/i.test(String(text || ''));
}

// Best-effort guess at which provider an error came from, based on its text.
function detectKeyService(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('scrapingbot') || t.includes('scraping bot') || t.includes('scrapebot') || t.includes('scraping_bot')) return 'scrapebot';
  if (t.includes('apify'))  return 'apify';
  if (t.includes('groq'))   return 'groq';
  if (t.includes('tavily')) return 'tavily';
  return null;
}

// Builds the user-facing "key exhausted" message for a given provider (or a
// generic one when the provider can't be determined from the error).
function exhaustedMessage(service) {
  const info = KEY_HELP[service];
  if (!info) {
    return '⚠ API KEY EXHAUSTED — One of your API keys has hit its limit. Check your Groq, Apify and ScrapingBot keys in System Configuration and regenerate whichever has run out.';
  }
  return `⚠ API KEY EXHAUSTED — Your ${info.label} API key has hit its limit. Generate a new key at ${info.url} and update it in System Configuration.`;
}

// ── CONTENT INTELLIGENCE ──────────────────────────────────────────────────────
const CONTENT_INTEL_WEBHOOK = 'https://9b36-122-179-174-167.ngrok-free.app/webhook/content-intelligence';

document.getElementById('btn-analyze').addEventListener('click', runContentIntelligence);
['ig-username-input', 'ig-limit-input', 'ig-groq-input'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') runContentIntelligence();
  });
});

async function runContentIntelligence() {
  const listEl = document.getElementById('ig-list');
  const btn    = document.getElementById('btn-analyze');

  // Guard: both required keys must be configured before scanning
  const groqLs      = lsGet(LS.GROQ);
  const scrapebotLs = lsGet(LS.SCRAPEBOT);
  if (!groqLs || !scrapebotLs) {
    showIntelError('⚠ KEYS NOT CONFIGURED — Click RECONFIGURE in the top right to set up your API keys.');
    return;
  }

  const username = document.getElementById('ig-username-input').value.trim().replace(/^@/, '');
  const limit    = Math.max(1, Math.min(50, parseInt(document.getElementById('ig-limit-input').value, 10) || 10));
  const groqKey  = document.getElementById('ig-groq-input').value.trim() || groqLs;

  if (!username) {
    listEl.innerHTML = '<div class="intel-error">// USERNAME REQUIRED</div>';
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
        // All third-party keys come straight from localStorage — never hardcoded.
        groq_key:      lsGet(LS.GROQ),
        scrapebot_key: lsGet(LS.SCRAPEBOT),
        apify_key:     lsGet(LS.APIFY)
      })
    });

    if (!res.ok) {
      const txt = await res.text();
      showIntelError(`${res.status} ${res.statusText} ${txt}`);
      return;
    }

    const data = await res.json();
    // Webhook can report failure in-band (success:false) — show the raw message
    // exactly as n8n sent it, no classification or template replacement.
    if (data && data.success === false) {
      const msg = data.error || data.message || 'Analysis failed';
      document.getElementById('ig-list').innerHTML =
        `<div class="intel-error">${escapeHtml(msg)}</div>`;
      return;
    }
    renderIntelReport(data);
  } catch (err) {
    showIntelError(err.message, true);
    console.error('Content Intelligence error:', err);
  } finally {
    btn.classList.remove('loading');
    btn.textContent = 'ANALYZE';
  }
}

function classifyIntelError(text, isNetwork) {
  if (isNetwork) {
    return '⚠ WEBHOOK OFFLINE — n8n is not running. Start your n8n instance and try again.';
  }
  const t = String(text || '');
  if (/\b(401|403|invalid.?key|unauthorized|forbidden)\b/i.test(t)) {
    return '⚠ API KEY INVALID — Your Groq or ScrapingBot key is invalid. Click RECONFIGURE to update your keys.';
  }
  if (/\b(429|rate.?limit|quota|exhausted|limit.?exceeded)\b/i.test(t)) {
    return '⚠ API KEY EXHAUSTED — Your key has hit its usage limit. Get a new key and click RECONFIGURE.\n→ Groq: console.groq.com\n→ ScrapingBot: scrapingbot.io/dashboard\n→ Apify: apify.com/account/integrations';
  }
  const display = t.trim().slice(0, 200) || 'Unknown error';
  return `⚠ ANALYSIS FAILED — ${display}`;
}

function showIntelError(text, isNetwork) {
  const listEl = document.getElementById('ig-list');
  const html   = escapeHtml(classifyIntelError(text, isNetwork)).replace(/\n/g, '<br>');
  listEl.innerHTML = `<div class="intel-error">${html}</div>`;
}

// The webhook/LLM node can hand back the report in several shapes:
//   data.report = { ...fields }            (expected)
//   data.report = "{\"executiveSummary\":...}"  (stringified JSON — common in n8n)
//   data.output / data.result wrapping the report
//   the report fields sitting at the top level of `data` itself
// Normalize all of these to a plain object so the section conditionals work.
function coerceReport(data) {
  const REPORT_KEYS = [
    'executiveSummary', 'whatWorked', 'contentFormatAnalysis',
    'contentIdeas', 'whatToAvoid', 'strategicRecommendations', 'captionAnalysis'
  ];
  const hasReportShape = obj =>
    obj && typeof obj === 'object' && REPORT_KEYS.some(k => obj[k] != null);

  const parse = val => {
    if (typeof val !== 'string') return val;
    try { return JSON.parse(val); } catch { return null; }
  };

  const candidates = [
    parse(data.report),
    data.report,
    parse(data.output),
    data.output,
    parse(data.result),
    data.result,
    data
  ];

  for (const c of candidates) {
    if (hasReportShape(c)) return c;
  }
  // Last resort: whatever report-like object we have, even if empty
  return (data.report && typeof data.report === 'object') ? data.report : {};
}

function postIntelSummaryToChat(data) {
  const posts    = Array.isArray(data.posts) ? data.posts : [];
  const report   = coerceReport(data);
  const top      = posts[0];
  const username = document.getElementById('ig-username-input').value.trim() || 'account';
  const lines    = [`// CONTENT INTELLIGENCE — @${username}`];

  if (top) {
    const caption = (top.caption || '(no caption)').slice(0, 80);
    const views   = top.views ?? top.videoViewCount ?? top.videoPlayCount ?? top.playCount;
    const likes   = top.likes ?? top.likesCount;
    const stats   = [
      views != null ? `${formatCount(views)} views` : '',
      likes != null ? `${formatCount(likes)} likes` : ''
    ].filter(Boolean).join(', ');
    lines.push(`TOP POST: "${caption}"${stats ? ` — ${stats}` : ''}`);

    const hook = report.topPerformingPosts?.[0]?.spokenHook || top.spokenHook || '';
    if (hook) lines.push(`TOP HOOK: "${hook.slice(0, 100)}"`);
  }

  const summary = report.executiveSummary || '';
  if (summary) lines.push(`KEY INSIGHT: ${summary.slice(0, 120)}`);

  const ideas = Array.isArray(report.contentIdeas) ? report.contentIdeas : [];
  const idea0 = ideas[0];
  if (idea0) {
    const action = idea0.title || idea0.name || idea0.idea || idea0.concept || '';
    if (action) lines.push(`ACTION: ${action}`);
  }

  appendChatMsg('jarvis', lines.join('\n'));
  speakText(`Content intelligence scan complete, sir.${summary ? ' ' + summary.slice(0, 80) : ''}`);
}

function renderIntelReport(data) {
  const listEl = document.getElementById('ig-list');

  if (!data || data.success === false) {
    listEl.innerHTML = `<div class="intel-error">// ANALYSIS FAILED — ${escapeHtml(data?.error || 'NO DATA')}</div>`;
    return;
  }

  // Expose the latest report so the JARVIS chat terminal can query it.
  window.lastIntelReport = data;
  // Post a chat summary once the panel finishes rendering.
  setTimeout(() => postIntelSummaryToChat(data), 50);

  const posts    = Array.isArray(data.posts) ? data.posts : [];
  const stats    = data.stats || {};
  const report   = coerceReport(data);
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
    // The Whisper-transcribed hook for the top post specifically lives on
    // report.topPerformingPosts[0]; fall back to the post's own spokenHook field.
    const topSpokenHook = report.topPerformingPosts?.[0]?.spokenHook || topPost.spokenHook || '';
    sections.push(`
      <div class="intel-section">
        <div class="intel-post-block">
          <div class="intel-post-tag">// TOP PERFORMER</div>
          ${renderPostBody(topPost, topSpokenHook)}
        </div>
      </div>
    `);
  }

  // ─ D. LAST 7 DAYS ─ (skip if it's the same post as the top performer)
  if (last7 && last7.url && last7.url !== topPost?.url) {
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

  // ─ A. WHAT WORKED ─
  const whatWorked = report.whatWorked || {};
  if (whatWorked.topPostBreakdown || whatWorked.audienceInsight || whatWorked.replicationFormula) {
    const parts = [];
    if (whatWorked.topPostBreakdown) {
      parts.push(`
        <div class="intel-subsection">
          <div class="intel-sublabel">TOP POST BREAKDOWN</div>
          <div class="intel-text">${escapeHtml(whatWorked.topPostBreakdown)}</div>
        </div>
      `);
    }
    if (whatWorked.audienceInsight) {
      parts.push(`
        <div class="intel-subsection">
          <div class="intel-sublabel">AUDIENCE INSIGHT</div>
          <div class="intel-text">${escapeHtml(whatWorked.audienceInsight)}</div>
        </div>
      `);
    }
    if (whatWorked.replicationFormula) {
      parts.push(`
        <div class="intel-subsection">
          <div class="intel-sublabel intel-sublabel-cyan">REPLICATION FORMULA</div>
          <div class="intel-replication-box">${escapeHtml(whatWorked.replicationFormula)}</div>
        </div>
      `);
    }
    sections.push(`
      <div class="intel-section">
        <div class="intel-label">:: WHAT WORKED</div>
        ${parts.join('')}
      </div>
    `);
  }

  // ─ B. CONTENT FORMAT ANALYSIS ─
  const cfa = report.contentFormatAnalysis || {};
  const topFormats = Array.isArray(cfa.topFormats) ? cfa.topFormats : [];
  if (cfa.whatIsWorking || topFormats.length) {
    const formatItems = topFormats.map(f => {
      if (!f) return '';
      const name      = escapeHtml(f.format || f.name || '');
      const avg       = f.avgEngagement != null ? formatCount(f.avgEngagement) : '';
      const insight   = escapeHtml(f.insight || '');
      if (!name && !insight) return '';
      return `
        <li>
          <span class="intel-idea-title">${name}${avg ? ` — ${avg}` : ''}</span>
          ${insight ? `<span class="intel-idea-hook">${insight}</span>` : ''}
        </li>
      `;
    }).filter(Boolean).join('');
    sections.push(`
      <div class="intel-section">
        <div class="intel-label">:: CONTENT FORMAT ANALYSIS</div>
        ${cfa.whatIsWorking ? `<div class="intel-text">${escapeHtml(cfa.whatIsWorking)}</div>` : ''}
        ${formatItems ? `<ul class="intel-list">${formatItems}</ul>` : ''}
      </div>
    `);
  }

  // ─ C. CONTENT IDEAS ─ (each idea may use varying field names depending on the webhook run)
  const ideas = Array.isArray(report.contentIdeas) ? report.contentIdeas : [];
  const ideaItems = ideas.map(idea => {
    if (!idea) return '';
    const title = idea.title || idea.name || idea.idea || idea.concept || idea.headline || '';
    const hook  = idea.hook || idea.openingLine || idea.description || idea.tagline || '';
    const angle = idea.angle || idea.contentAngle || idea.format || '';
    const why   = idea.whyItWillWork || idea.why || idea.reasoning || idea.rationale || '';
    if (!title && !hook && !angle && !why) return '';
    return `
      <li>
        ${title ? `<span class="intel-idea-title">${escapeHtml(title)}</span>` : ''}
        ${hook  ? `<span class="intel-idea-hook">${escapeHtml(hook)}</span>` : ''}
        ${angle ? `<div class="intel-idea-angle">${escapeHtml(angle)}</div>` : ''}
        ${why   ? `<div class="intel-idea-why">▸ ${escapeHtml(why)}</div>` : ''}
      </li>
    `;
  }).filter(Boolean).join('');
  if (ideaItems) {
    sections.push(`
      <div class="intel-section">
        <div class="intel-label">:: CONTENT IDEAS</div>
        <ul class="intel-list">${ideaItems}</ul>
      </div>
    `);
  }

  // ─ D. WHAT TO AVOID ─ (object: {pattern, specificPosts, whyTheyFailed} — also tolerates legacy string/array shapes)
  if (report.whatToAvoid) {
    const wta = report.whatToAvoid;
    if (Array.isArray(wta)) {
      sections.push(reportListSection('WHAT TO AVOID', wta));
    } else if (typeof wta === 'object') {
      const parts = [];
      if (wta.pattern) {
        parts.push(`<div class="intel-text">${escapeHtml(wta.pattern)}</div>`);
      }
      const specificPosts = Array.isArray(wta.specificPosts)
        ? wta.specificPosts.filter(Boolean)
        : (typeof wta.specificPosts === 'string'
            ? wta.specificPosts.split('\n').map(s => s.trim()).filter(Boolean)
            : []);
      if (specificPosts.length) {
        parts.push(`<ul class="intel-list">${specificPosts.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`);
      }
      if (wta.whyTheyFailed) {
        parts.push(`<div class="intel-text intel-avoid-why">${escapeHtml(wta.whyTheyFailed)}</div>`);
      }
      if (parts.length) {
        sections.push(`
          <div class="intel-section">
            <div class="intel-label">:: WHAT TO AVOID</div>
            ${parts.join('')}
          </div>
        `);
      }
    } else {
      sections.push(reportTextSection('WHAT TO AVOID', wta));
    }
  }

  // ─ E. RECOMMENDATIONS ─
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

function renderPostBody(post, spokenHookOverride) {
  const rawCaption = post.caption || '(no caption)';
  const caption  = rawCaption.length > 120 ? rawCaption.slice(0, 120).trimEnd() + '...' : rawCaption;
  const likes    = post.likes ?? post.likesCount;
  const views    = post.views ?? post.videoViewCount ?? post.videoPlayCount ?? post.playCount;
  const comments = post.comments ?? post.commentsCount;
  const url      = post.url || '#';
  // Prefer the Whisper-transcribed hook passed in; fall back to the post's own field
  const spokenHook = String(spokenHookOverride || post.spokenHook || '').trim();
  return `
    <div class="intel-post-caption">${escapeHtml(caption)}</div>
    ${spokenHook ? `
      <div class="intel-spoken-hook">
        <div class="intel-spoken-label">// SPOKEN HOOK</div>
        <div class="intel-spoken-text">${escapeHtml(spokenHook)}</div>
      </div>` : ''}
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

async function pushCalendarItem(item) {
  try {
    const res = await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lsGet(LS.SESSION)}` },
      body: JSON.stringify({ title: item.text, date: item.date, time: item.time, type: item.type })
    });
    if (res.ok) {
      const { item: saved } = await res.json();
      // Swap local temporary ID for the Supabase UUID so delete/toggle work correctly.
      const local = STATE.agenda.find(a => a.id === item.id);
      if (local) { local.id = saved.id; saveAgenda(); }
    }
  } catch {}
}

async function loadAgenda() {
  if (!STATE.userId) return;
  try {
    const res = await fetch('/api/calendar', {
      headers: { Authorization: `Bearer ${lsGet(LS.SESSION)}` }
    });
    if (res.ok) {
      const { items } = await res.json();
      STATE.agenda = (items || []).map(row => ({
        id:         row.id,
        user_id:    row.user_id,
        text:       row.title,
        date:       row.date   || null,
        time:       row.time   || null,
        done:       !!row.completed,
        type:       row.type   || 'task',
        created_at: row.created_at || new Date().toISOString()
      }));
      lsSet(LS.agenda(STATE.userId), JSON.stringify(STATE.agenda));
    } else {
      const raw = lsGet(LS.agenda(STATE.userId));
      STATE.agenda = raw ? JSON.parse(raw) : [];
    }
  } catch {
    const raw = lsGet(LS.agenda(STATE.userId));
    STATE.agenda = raw ? JSON.parse(raw) : [];
  }
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

  // ── Date-filter mode: a calendar cell is selected ──
  if (STATE.calSelectedDate) {
    const dateItems = STATE.agenda.filter(i => i.date === STATE.calSelectedDate).sort(agendaSort);
    if (!dateItems.length) {
      list.innerHTML = `<div class="agenda-empty">No items for ${formatEventDate(STATE.calSelectedDate)}.</div>`;
    } else {
      const header = document.createElement('div');
      header.className = 'agenda-group-header';
      header.innerHTML = `<span>${formatEventDate(STATE.calSelectedDate)}</span><span class="agenda-group-count">${dateItems.length}</span>`;
      list.appendChild(header);
      dateItems.forEach(item => list.appendChild(renderAgendaItem(item)));
    }
    if (showMoreBtn) showMoreBtn.style.display = 'none';
    return;
  }

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
    fetch(`/api/calendar/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lsGet(LS.SESSION)}` },
      body: JSON.stringify({ completed: item.done })
    }).catch(() => {});
    return;
  }

  if (delBtn) {
    const id = delBtn.dataset.id;
    STATE.agenda = STATE.agenda.filter(t => t.id !== id);
    saveAgenda();
    renderAgenda();
    renderCalendar();
    fetch(`/api/calendar/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${lsGet(LS.SESSION)}` }
    }).catch(() => {});
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
  pushCalendarItem(item);
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
    const isSelected = STATE.calSelectedDate === dateStr;
    day.className = 'cal-day' +
      (isToday    ? ' today'    : '') +
      (hasEvent   ? ' has-event': '') +
      (isSelected ? ' selected' : '');
    day.textContent = d;
    day.dataset.date = dateStr;
    day.addEventListener('click', () => {
      if (STATE.calSelectedDate === dateStr) {
        STATE.calSelectedDate = null;
      } else {
        STATE.calSelectedDate = dateStr;
        document.getElementById('agenda-date').value = dateStr;
        document.getElementById('agenda-input').focus();
      }
      renderCalendar();
      renderAgenda();
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

// ── TYPING INDICATOR ──────────────────────────────────────────────────────────
function showTypingIndicator() {
  const history = document.getElementById('chat-history');
  if (document.getElementById('chat-typing')) return;
  const div = document.createElement('div');
  div.className = 'chat-msg jarvis typing';
  div.id = 'chat-typing';
  div.innerHTML = `<span class="chat-prefix">JARVIS ▸</span><span class="typing-dots"><span></span><span></span><span></span></span>`;
  history.appendChild(div);
  history.scrollTop = history.scrollHeight;
}
function removeTypingIndicator() {
  document.getElementById('chat-typing')?.remove();
}

// ── JARVIS COMMAND CENTER ─────────────────────────────────────────────────────
// The terminal detects intent from natural language / voice and either operates
// a dashboard panel directly or falls back to the Groq AI for open-ended queries.

const JARVIS_SYSTEM_PROMPT = "You are JARVIS, the AI assistant inside JARVIS OS — a founder command center built by Shaan Soni. You are Tony Stark's JARVIS but for founders. You are sharp, direct, intelligent, occasionally witty. You address the user as 'sir'. You help with business strategy, content, AI systems, and productivity. Keep responses concise and actionable. Never be generic. You are NEVER to offer to send invites, prepare briefings, or contact people on the user's behalf. Never respond to calendar-related messages — those are handled separately by a dedicated system. If someone mentions a meeting, call, or schedule, say nothing about it.";

function hasTimePassed(hhmmStr) {
  if (!hhmmStr) return false;
  const [h, min] = hhmmStr.split(':').map(Number);
  const now = new Date();
  return (h * 60 + min) <= (now.getHours() * 60 + now.getMinutes());
}

function parseTimeToHHMM(str) {
  const m = String(str).trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3];
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// ── CALENDAR NLU (Groq-powered) ───────────────────────────────────────────────

async function parseCalendarNLU(raw) {
  const key = lsGet(LS.GROQ);
  if (!key) throw new Error('Groq key not configured — click RECONFIGURE.');

  const systemPrompt = `Extract calendar info from the user message. Return ONLY this JSON, no other text: {"title":"event name only, no action words","date":"YYYY-MM-DD or null","time":"HH:MM or null"} Today is ${TODAY_STR()}.`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: raw }
      ],
      max_tokens: 100,
      temperature: 0
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Groq API error');

  const text  = (data.choices?.[0]?.message?.content || '').trim();
  const first = text.indexOf('{');
  const last  = text.lastIndexOf('}');
  if (first === -1 || last === -1) return { title: null, date: null, time: null };
  try {
    const parsed = JSON.parse(text.slice(first, last + 1));
    return { title: parsed.title || null, date: parsed.date || null, time: parsed.time || null };
  } catch {
    return { title: null, date: null, time: null };
  }
}

// Fallback day-name resolver — used when Groq returns date:null but user said a weekday.
// Handles misspellings like "fryday", "wednessday", etc. via prefix matching.
function resolveLocalDate(raw) {
  const m = raw.toLowerCase();
  if (/\btoday\b|\btonight\b/.test(m)) return TODAY_STR();
  if (/\btomorrow\b/.test(m)) {
    const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0];
  }
  if (/\bday\s+after\s+tomorrow\b/.test(m)) {
    const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().split('T')[0];
  }
  const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  // Match any 3+ letter prefix of a day name, with optional suffix noise (e.g. "fryday")
  const dayRe = /\b(sun|mon|tue|wed|thu|fri|sat)\w{0,6}\b/i;
  const dm = m.match(dayRe);
  if (dm) {
    const prefix = dm[1].toLowerCase();
    const target = DAYS.findIndex(d => d.startsWith(prefix));
    if (target !== -1) {
      const today = new Date();
      let diff = target - today.getDay();
      if (diff <= 0) diff += 7;
      const d = new Date(today);
      d.setDate(d.getDate() + diff);
      return d.toISOString().split('T')[0];
    }
  }
  return null;
}

function commitCalendarItem(title, date, time, type) {
  if (!title || !title.trim()) return;
  STATE.agendaTypeSelected = type || 'event';
  document.querySelectorAll('.type-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.type === STATE.agendaTypeSelected));
  document.getElementById('agenda-input').value = title;
  document.getElementById('agenda-date').value  = date  || '';
  document.getElementById('agenda-time').value  = time  || '';
  addAgendaItem();
  STATE.pendingCalendar = null;
}

function detectIntent(raw) {
  const m = raw.toLowerCase().trim();

  // ── CALENDAR: add task / event / reminder (explicit command form) ──
  if (/\badd\s+(?:a\s+|an\s+)?(?:task|event|reminder|meeting)\b/.test(m) ||
      /^(?:remind me|create\s+(?:a\s+)?(?:task|event|reminder)|schedule\s+(?:a\s+|an\s+)?(?:call|meeting|event|sync|session|lunch|dinner|catch.?up|interview))\b/.test(m)) {
    return { type: 'calendar-add' };
  }

  // ── CALENDAR: natural language scheduling with time/date reference ──
  const apptNoun = /\b(call|meeting|sync|review|pitch|catch.?up|lunch|dinner|coffee|interview|session|standup|demo|webinar|briefing)\b/;
  const timeRef  = /\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b|\btomorrow\b|\bday\s+after\s+tomorrow\b|\bnext\s+(?:sun|mon|tue|wed|thu|fri|sat)\w*\b|\bon\s+(?:sun|mon|tue|wed|thu|fri|sat)\w*\b/i;
  if (apptNoun.test(m) && timeRef.test(m) &&
      !/post|create|content|instagram|reel|news/.test(m) &&
      !/\b(analy[sz]e|content intelligence|run content)\b/.test(m)) {
    return { type: 'calendar-add' };
  }

  // ── CALENDAR: bare "call with X" / "meeting with X" — no time ref needed ──
  // Fires when message starts with or is entirely an appointment phrase (no question words).
  if (/^(?:call|meeting|sync|catch\s*up|lunch|dinner|coffee|interview|standup|demo|pitch|briefing)\b/i.test(m) &&
      !/^(?:what|how|when|where|did|can|will|could|should|would|tell|show|list|is|are|was|were|do|does)/.test(m) &&
      !/post|create|content|instagram|reel|news|analy[sz]e/.test(m)) {
    return { type: 'calendar-add' };
  }

  // ── CALENDAR: query schedule (don't steal content or news questions) ──
  const isContenty = /post|create|content|instagram|reel|news/.test(m);
  if (!isContenty && (/\b(schedule|agenda)\b/.test(m) || /what do i have/.test(m) ||
      /\bwhat'?s\b.*\b(today|on (my )?(plate|schedule|agenda)|going on)\b/.test(m))) {
    return { type: 'calendar-query' };
  }

  // ── CONTENT: what should I post ──
  if (/what (should|do|can) i post/.test(m) || /what to post/.test(m)) {
    return { type: 'report-whattopost' };
  }
  // ── CONTENT: top / best post ──
  if (/\b(top|best)\b[^.]*\bpost\b/.test(m) || /performed best|best performing|what performed/.test(m)) {
    return { type: 'report-toppost' };
  }
  // ── CONTENT: content ideas ──
  if (/content idea|what should i create|give me (content )?ideas|ideas to (post|make|create)/.test(m)) {
    return { type: 'report-ideas' };
  }
  // ── CONTENT: analyze / run intelligence ──
  if (/\b(analy[sz]e|content intelligence|run content)\b/.test(m) ||
      /what'?s working on my (instagram|account|reels)/.test(m)) {
    let username = '';
    if (!/\bmy (instagram|account|reels|content|profile)\b/.test(m)) {
      const um = m.match(/(?:analy[sz]e|scan|on|for|intelligence(?:\s+on|\s+for)?)\s+@?([a-z0-9._]+)/);
      if (um) username = um[1];
    }
    return { type: 'content-analyze', username };
  }

  // ── NEWS ──
  if (/\bnews\b|\barticles?\b|\bheadlines?\b/.test(m)) {
    let topic = '';
    const t1 = m.match(/news (?:about|on|regarding|for|of)\s+(.+)/);
    const t2 = m.match(/(?:fetch|get|show me|latest|pull up|find)\s+(.+?)\s+news/);
    const t3 = m.match(/(?:articles?|headlines?) (?:about|on|for)\s+(.+)/);
    if (t1) topic = t1[1];
    else if (t2) topic = t2[1];
    else if (t3) topic = t3[1];
    topic = (topic || '').replace(/[?.!]+$/, '').replace(/\b(please|now|today)\b/g, '').trim();
    return { type: 'news', topic };
  }

  return { type: 'groq' };
}

// ── Intent handlers (return the JARVIS reply string) ──
async function handleNewsCmd(topic) {
  if (topic) {
    lsSet(LS.TOPIC1, topic);
    document.getElementById('news-title-1').textContent = `NEWS FEED 01 — ${topic.toUpperCase()}`;
  }
  const current = lsGet(LS.TOPIC1);
  if (!current) return 'No topic set, sir. Tell me what to pull — for example, "news about AI startups".';
  const results = await loadNews(1);
  if (!results?.length) return `Fetching intelligence on ${current}, sir.`;
  const lines = results.map(r => `- ${r.title} — ${r.source}`).join('\n');
  return `// NEWS INTELLIGENCE — ${current.toUpperCase()}\n${lines}`;
}

function handleAnalyzeCmd(username) {
  const uEl = document.getElementById('ig-username-input');
  const gEl = document.getElementById('ig-groq-input');
  const uname = String(username || uEl.value || '').replace(/^@/, '').trim();
  if (!uname) return 'I need a target handle to scan, sir. Try "analyze nike".';
  uEl.value = uname;
  if (!gEl.value) gEl.value = lsGet(LS.GROQ);
  runContentIntelligence();
  return `Initiating content scan on @${uname}, sir. Give me roughly thirty seconds.`;
}

function handleScheduleQuery() {
  const today = TODAY_STR();
  const items = STATE.agenda
    .filter(i => i.date === today)
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  if (!items.length) return 'Your schedule is clear for today, sir. Nothing on the books.';
  const lines = items.map(i => {
    const t = i.time ? ` at ${i.time}` : '';
    const kind = i.type === 'event' ? 'Event' : 'Task';
    const status = i.done ? ' (done)' : '';
    return `• ${kind}: ${i.text}${t}${status}`;
  });
  return `Here is your agenda for today, sir:\n${lines.join('\n')}`;
}

async function handleCalendarAdd(raw, preParsed) {
  const m = raw.toLowerCase();
  const isTask = /\b(task|todo|to-do)\b/.test(m) ||
    (/\bremind me to\b/.test(m) && !/\b(call|meeting|sync|pitch|lunch|dinner|coffee|interview|session|standup|demo|webinar|briefing)\b/.test(m));
  const type = isTask ? 'task' : 'event';

  const { title, date: groqDate, time } = preParsed || (await parseCalendarNLU(raw));
  const date = groqDate || resolveLocalDate(raw);
  console.log('CALENDAR DEBUG - title:', title, 'date:', date, 'time:', time);

  if (!title) {
    STATE.pendingCalendar = { title: null, date, time, type, awaiting: 'what' };
    return "I didn't catch that, sir. What would you like to schedule?";
  }

  if (date && time) {
    if (date === TODAY_STR() && hasTimePassed(time)) {
      STATE.pendingCalendar = { title, date: null, time, type, awaiting: 'confirm-tomorrow' };
      return `Sir, ${time} has already passed today — did you mean tomorrow?`;
    }
    commitCalendarItem(title, date, time, type);
    return `Done sir, "${title}" added for ${formatEventDate(date)} at ${time}.`;
  }

  if (!date && time) {
    STATE.pendingCalendar = { title, date: null, time, type, awaiting: 'date' };
    return `Sure sir, ${title} at ${time} — is that for today or tomorrow?`;
  }

  if (date && !time) {
    STATE.pendingCalendar = { title, date, time: null, type, awaiting: 'time' };
    return `Got it sir, what time for ${title} on ${formatEventDate(date)}?`;
  }

  STATE.pendingCalendar = { title, date: null, time: null, type, awaiting: 'both' };
  return `I'll add that sir — what date and time for ${title}?`;
}

async function handleCalendarFollowUp(message) {
  const pending = STATE.pendingCalendar;

  if (pending.awaiting === 'confirm-tomorrow') {
    if (/^\s*(yes|yeah|yep|sure|ok|okay|tomorrow)\s*$/i.test(message)) {
      commitCalendarItem(pending.title, (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })(), pending.time, pending.type);
      return `Done sir, "${pending.title}" added for tomorrow at ${pending.time}.`;
    }
    STATE.pendingCalendar = null;
    return null;
  }

  const parsed = await parseCalendarNLU(message);
  const date = parsed.date || resolveLocalDate(message) || pending.date || null;
  const time = parsed.time || pending.time || null;

  if (!date && !time) return null;

  if (date && time) {
    if (date === TODAY_STR() && hasTimePassed(time)) {
      STATE.pendingCalendar = { ...pending, date: null, time, awaiting: 'confirm-tomorrow' };
      return `Sir, ${time} has already passed today — did you mean tomorrow?`;
    }
    commitCalendarItem(pending.title, date, time, pending.type);
    return `Done sir, "${pending.title}" added for ${formatEventDate(date)} at ${time}.`;
  }

  if (!date && time) {
    STATE.pendingCalendar = { ...pending, time, awaiting: 'date' };
    return `Sure sir, ${pending.title} at ${time} — is that for today or tomorrow?`;
  }

  if (date && !time) {
    STATE.pendingCalendar = { ...pending, date, awaiting: 'time' };
    return `Got it sir, what time for ${pending.title} on ${formatEventDate(date)}?`;
  }

  return null;
}

function handleTopPost() {
  const data = window.lastIntelReport;
  if (!data) return 'No content report loaded yet, sir. Run an analysis first — try "analyze [username]".';
  const post = (data.posts || [])[0];
  if (!post) return 'The last report had no posts to rank, sir.';
  const caption = (post.caption || '(no caption)').slice(0, 140);
  const views = post.views ?? post.videoViewCount ?? post.videoPlayCount ?? post.playCount;
  const likes = post.likes ?? post.likesCount;
  const stats = [];
  if (views != null) stats.push(`${formatCount(views)} views`);
  if (likes != null) stats.push(`${formatCount(likes)} likes`);
  return `Your top performer, sir: "${caption}"${stats.length ? ` — ${stats.join(', ')}.` : '.'}`;
}

function handleContentIdeas() {
  const report = window.lastIntelReport ? coerceReport(window.lastIntelReport) : {};
  const ideas = Array.isArray(report.contentIdeas) ? report.contentIdeas : [];
  if (!ideas.length) return 'No content ideas on record, sir. Run an analysis and I will generate some.';
  const lines = ideas.slice(0, 5).map((idea, i) => {
    const title = idea.title || idea.name || idea.idea || idea.concept || `Idea ${i + 1}`;
    const hook  = idea.hook || idea.openingLine || '';
    return `${i + 1}. ${title}${hook ? ` — "${hook}"` : ''}`;
  });
  return `Here is what I would create next, sir:\n${lines.join('\n')}`;
}

function handleWhatToPost() {
  const report = window.lastIntelReport ? coerceReport(window.lastIntelReport) : {};
  const ideas = Array.isArray(report.contentIdeas) ? report.contentIdeas : [];
  if (!ideas.length) return 'I have no fresh report to pull from, sir. Run "analyze [username]" and I will tell you exactly what to post.';
  const top = ideas[0];
  const title = top.title || top.name || top.idea || top.concept || 'your next post';
  const hook  = top.hook || top.openingLine || '';
  const angle = top.angle || top.contentAngle || '';
  let r = `My pick for your next post, sir: "${title}".`;
  if (hook)  r += ` Open with: "${hook}".`;
  if (angle) r += ` Angle — ${angle}`;
  return r;
}

async function callGroqDirect(message) {
  const key = lsGet(LS.GROQ);
  if (!key) throw new Error('Groq key not set. Add it in RECONFIGURE.');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: JARVIS_SYSTEM_PROMPT },
        ...STATE.chatHistory.slice(-10)
      ],
      max_tokens: 400,
      temperature: 0.7
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Groq API error');
  return data.choices?.[0]?.message?.content || 'No response.';
}

async function sendChat(rawMessage) {
  const input   = document.getElementById('chat-input');
  const message = String(rawMessage != null ? rawMessage : input.value).trim();
  if (!message) return;

  if (rawMessage == null) input.value = '';
  appendChatMsg('user', message);
  STATE.chatHistory.push({ role: 'user', content: message });

  const btn = document.getElementById('btn-send-chat');
  btn.disabled = true;
  btn.textContent = '...';
  startProcessingSound();
  showTypingIndicator();

  try {
    let reply;

    // Pending calendar context: try to complete the entry with this reply.
    if (STATE.pendingCalendar) {
      const fu = await handleCalendarFollowUp(message);
      if (fu != null) reply = fu;
      else STATE.pendingCalendar = null; // couldn't parse — fall through to normal detection
    }

    if (reply == null) {
      // Pre-check: ask Groq if this message contains a calendar title.
      // If it does, route straight to calendar handling — no detectIntent needed.
      // Pass the pre-parsed result into handleCalendarAdd to avoid a second Groq call.
      let calPreCheck = null;
      try { calPreCheck = await parseCalendarNLU(message); } catch { /* fall through */ }

      if (calPreCheck?.title) {
        reply = await handleCalendarAdd(message, calPreCheck);
      } else {
        // No calendar title detected — run keyword-based intent routing.
        const intent = detectIntent(message);
        switch (intent.type) {
          case 'news':               reply = await handleNewsCmd(intent.topic); break;
          case 'content-analyze':    reply = handleAnalyzeCmd(intent.username);  break;
          case 'calendar-query':     reply = handleScheduleQuery();              break;
          case 'calendar-add':       reply = await handleCalendarAdd(message);   break;
          case 'report-toppost':     reply = handleTopPost();                    break;
          case 'report-ideas':       reply = handleContentIdeas();               break;
          case 'report-whattopost':  reply = handleWhatToPost();                 break;
          default:                   reply = await callGroqDirect(message);
        }
      }
    }

    removeTypingIndicator();
    stopProcessingSound();
    playJarvisChime();
    appendChatMsg('jarvis', reply);
    STATE.chatHistory.push({ role: 'assistant', content: reply });
    speakText(reply);
  } catch (err) {
    removeTypingIndicator();
    stopProcessingSound();
    const msg = String(err.message || err);
    if (isExhaustedError(msg)) {
      // Groq is the only direct API the chat calls → show its exhausted message in orange.
      appendChatMsg('error', exhaustedMessage('groq'));
    } else {
      appendChatMsg('error', `ERROR: ${msg.toUpperCase()}`);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'SEND';
  }
}

document.getElementById('btn-send-chat').addEventListener('click', () => sendChat());
document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendChat();
});
document.getElementById('btn-clr-chat').addEventListener('click', () => {
  document.getElementById('chat-history').innerHTML = '';
  STATE.chatHistory = [];
});

// ── VOICE OUTPUT TOGGLE (TTS mute) ────────────────────────────────────────────
document.getElementById('btn-toggle-voice').addEventListener('click', () => {
  STATE.voiceEnabled = !STATE.voiceEnabled;
  const btn = document.getElementById('btn-toggle-voice');
  if (STATE.voiceEnabled) {
    btn.textContent = 'MUTE';
    btn.classList.remove('muted');
  } else {
    btn.textContent = 'UNMUTE';
    btn.classList.add('muted');
    window.speechSynthesis?.cancel();
  }
});

// ── VOICE INPUT (SpeechRecognition) ───────────────────────────────────────────
// Clicking the "VOICE ON" indicator starts listening; the transcript is dropped
// into the input and auto-sent.
let jarvisRecognition = null;
let jarvisListening   = false;

function updateMicUI() {
  const ind = document.getElementById('voice-status');
  if (jarvisListening) {
    ind.textContent = '◉ LISTENING';
    ind.classList.add('listening');
  } else {
    ind.textContent = '◉ VOICE ON';
    ind.classList.remove('listening');
  }
}

function setupSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = 'en-US';
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join(' ').trim();
    if (transcript) {
      document.getElementById('chat-input').value = transcript;
      sendChat();
    }
  };
  rec.onerror = () => { jarvisListening = false; updateMicUI(); };
  rec.onend   = () => { jarvisListening = false; updateMicUI(); };
  return rec;
}

document.getElementById('voice-status').addEventListener('click', () => {
  if (!jarvisRecognition) jarvisRecognition = setupSpeechRecognition();
  if (!jarvisRecognition) {
    appendChatMsg('error', 'VOICE INPUT NOT SUPPORTED IN THIS BROWSER');
    return;
  }
  if (jarvisListening) {
    jarvisRecognition.stop();
    jarvisListening = false;
    updateMicUI();
  } else {
    try {
      jarvisRecognition.start();
      jarvisListening = true;
      updateMicUI();
      playClick();
    } catch (_) { /* start() throws if already running — ignore */ }
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
