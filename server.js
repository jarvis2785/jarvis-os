require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ── AUTH ──────────────────────────────────────────────────────────────────────

// Helper: profile is complete when niche is set (API keys live in localStorage)
function isFullProfile(profile) {
  return !!profile?.niche;
}

app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password required' });
  }

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return res.status(400).json({ error: error.message });

  // If email confirmation is required, session will be null
  if (!data.session) {
    return res.json({
      success: true,
      requiresConfirmation: true,
      message: 'CHECK YOUR EMAIL TO CONFIRM YOUR ACCOUNT, THEN SIGN IN.'
    });
  }

  // Create a minimal profile row with name + email (niche added on profile setup)
  const { data: profile } = await supabase
    .from('profiles')
    .insert({ id: data.user.id, name, email })
    .select('id, name, email, niche')
    .single();

  res.json({
    success: true,
    session: data.session,
    user: data.user,
    hasProfile: false,   // always needs setup after first signup
    profile: profile || { name }
  });
});

app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });

  const userId = data.user?.id;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, email, niche')
    .eq('id', userId)
    .single();

  res.json({
    success: true,
    session: data.session,
    user: data.user,
    hasProfile: isFullProfile(profile),
    profile: profile || null
  });
});

app.post('/api/auth/signout', async (req, res) => {
  // Session invalidation is handled client-side (clear localStorage).
  // Optionally we could call supabase.auth.admin.signOut but that needs service key.
  res.json({ success: true });
});

// Verify a stored access token and return current user + profile
app.post('/api/auth/session', async (req, res) => {
  const { accessToken } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'Access token required' });

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const userId = data.user.id;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, email, niche')
    .eq('id', userId)
    .single();

  res.json({
    success: true,
    user: data.user,
    hasProfile: isFullProfile(profile),
    profile: profile || null
  });
});

// ── PROFILE ───────────────────────────────────────────────────────────────────

app.post('/api/profile', async (req, res) => {
  const { userId, name, niche } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: userId, name, niche })
    .select('id, name, email, niche')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, profile: data });
});

app.get('/api/profile/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, niche')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Profile not found' });
  res.json({ profile: data });
});

// ── TASKS ─────────────────────────────────────────────────────────────────────

app.get('/api/tasks/:userId', async (req, res) => {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', req.params.userId)
    .order('created_at', { ascending: true });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ tasks: data });
});

app.post('/api/tasks', async (req, res) => {
  const { userId, text, time, date, type } = req.body;
  const row = { user_id: userId, text, time: time || null, done: false };
  if (date) row.date = date;
  row.type = type === 'event' ? 'event' : 'task';
  const { data, error } = await supabase
    .from('tasks')
    .insert(row)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ task: data });
});

app.patch('/api/tasks/:id', async (req, res) => {
  const { done } = req.body;
  const { data, error } = await supabase
    .from('tasks')
    .update({ done })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ task: data });
});

app.delete('/api/tasks/:id', async (req, res) => {
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// ── CHAT ──────────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { userId, message, history, groq_key } = req.body;
  if (!userId || !message) return res.status(400).json({ error: 'userId and message required' });
  if (!groq_key) return res.status(400).json({ error: 'Groq key required' });

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('name, niche')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    return res.status(400).json({ error: 'Profile not found' });
  }

  // ── Build grounded context from the unified agenda (tasks table) ──
  const todayStr = new Date().toISOString().split('T')[0];

  const { data: agendaToday } = await supabase
    .from('tasks')
    .select('text, time, type, done, date')
    .eq('user_id', userId)
    .eq('date', todayStr);

  const { data: agendaUpcoming } = await supabase
    .from('tasks')
    .select('text, time, type, date')
    .eq('user_id', userId)
    .gt('date', todayStr)
    .order('date', { ascending: true })
    .limit(10);

  const todaysTasks = (agendaToday || []).filter(t => (t.type || 'task') === 'task');
  const upcomingEvents = [
    ...(agendaToday || []).filter(t => t.type === 'event'),
    ...(agendaUpcoming || []).filter(t => t.type === 'event')
  ];

  const tasksTodayStr = todaysTasks.length
    ? todaysTasks
        .map(t => `  - ${t.text}${t.time ? ' @ ' + t.time : ''}${t.done ? ' (done)' : ''}`)
        .join('\n')
    : '  - No tasks set for today';

  const eventsStr = upcomingEvents.length
    ? upcomingEvents
        .map(e => `  - ${e.text}${e.date ? ' on ' + e.date : ''}${e.time ? ' @ ' + e.time : ''}`)
        .join('\n')
    : '  - No upcoming events';

  const todayHuman = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  const systemPrompt = `You are JARVIS, a personal AI built exclusively for ${profile.name}, a founder in ${profile.niche}.

PERSONALITY:
- Direct, sharp, no fluff
- Never use filler phrases like 'Certainly!' or 'Great question!'
- Never make up information you don't have
- Keep replies under 4 sentences unless asked for more
- Speak like a smart advisor, not a customer service bot

CONTEXT YOU HAVE:
- User's name: ${profile.name}
- User's niche: ${profile.niche}
- Today's date: ${todayHuman}
- Today's tasks:
${tasksTodayStr}
- Upcoming events:
${eventsStr}

RULES:
- Only reference tasks and events that exist in the CONTEXT above
- Never invent meetings, calls, or agenda items
- If asked about schedule and there's nothing in context, say so directly
- If asked about news or trends, say you don't have live data but suggest they check the news panels
- If asked what to do today, reference actual tasks from context`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...(history || []).slice(-10),
    { role: 'user', content: message }
  ];

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groq_key}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages,
        max_tokens: 300,
        temperature: 0.7
      })
    });

    const groqData = await response.json();
    if (!response.ok) {
      return res.status(400).json({ error: groqData.error?.message || 'Groq API error' });
    }

    const reply = groqData.choices?.[0]?.message?.content || 'No response.';
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reach Groq API' });
  }
});

// ── NEWS ──────────────────────────────────────────────────────────────────────

app.post('/api/news', async (req, res) => {
  const { topic, tavily_key } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic required' });
  if (!tavily_key) return res.status(400).json({ error: 'Tavily key required' });

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavily_key,
        query: topic,
        search_depth: 'basic',
        include_answer: false,
        max_results: 8,
        topic: 'news'
      })
    });

    const tavilyData = await response.json();
    if (!response.ok) {
      return res.status(400).json({ error: tavilyData.message || 'Tavily API error' });
    }

    const results = (tavilyData.results || []).map(r => ({
      title: r.title,
      url: r.url,
      source: new URL(r.url).hostname.replace('www.', ''),
      published_date: r.published_date || null,
      snippet: r.content?.slice(0, 120) + '...'
    }));

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reach Tavily API' });
  }
});

// ── INSTAGRAM TRENDS (Apify) ──────────────────────────────────────────────────

app.post('/api/instagram-trends', async (req, res) => {
  const { hashtag: rawHashtag, minLikes: rawMinLikes, limit: rawLimit, apify_token } = req.body;

  if (!apify_token) return res.status(400).json({ error: 'APIFY_KEY_MISSING' });
  if (!rawHashtag)  return res.status(400).json({ error: 'hashtag required' });

  const hashtag = String(rawHashtag)
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[^a-z0-9]/g, '');
  if (!hashtag) return res.status(400).json({ error: 'Invalid hashtag' });

  const minLikes = Math.max(0, parseInt(rawMinLikes, 10) || 100);
  const limit    = Math.min(20, Math.max(1, parseInt(rawLimit, 10) || 8));
  const scrapeCount = Math.min(50, Math.max(limit, 12));

  try {
    const apifyUrl = `https://api.apify.com/v2/acts/apify~instagram-search-scraper/run-sync-get-dataset-items?token=${apify_token}&timeout=60`;
    const response = await fetch(apifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchQueries: [hashtag],
        searchType:    'hashtag',
        resultsLimit:  parseInt(limit) || 10
      })
    });

    if (!response.ok) {
      const errTxt = await response.text();
      return res.status(400).json({ error: `Apify error: ${errTxt.slice(0, 200)}` });
    }

    const items = await response.json();
    const list  = Array.isArray(items) ? items : [];

    // DEBUG: see the raw shape of the search scraper's objects
    if (list.length > 0) {
      console.log('[Apify search] first raw result:', JSON.stringify(list[0], null, 2));
    } else {
      console.log('[Apify search] zero results for hashtag:', hashtag);
    }

    // Map to { caption, likes, comments, url, thumbnail, timestamp, type }
    const norm = list.map(p => {
      const likes     = Number(p.likesCount ?? p.likes ?? 0);
      const comments  = Number(p.commentsCount ?? p.comments ?? 0);
      const caption   = (p.caption || p.text || '').slice(0, 100);
      const url       = p.url || (p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : '#');
      const thumbnail = p.displayUrl || p.thumbnailSrc || p.imageUrl || null;
      const timestamp = p.timestamp || p.takenAtTimestamp || p.takenAt || null;
      const type      = p.type || p.productType || (p.isVideo ? 'video' : 'image');
      return { caption, likes, comments, url, thumbnail, timestamp, type };
    });

    // Filter by minLikes, sort by likes desc, take top results
    const filtered = norm.filter(r => r.likes >= minLikes);
    filtered.sort((a, b) => b.likes - a.likes);
    const top = filtered.slice(0, limit);

    res.json({ hashtag, minLikes, limit, results: top });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reach Apify API' });
  }
});

// ── CALENDAR ITEMS ────────────────────────────────────────────────────────────

async function getUserId(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data } = await supabase.auth.getUser(token);
  return data?.user?.id || null;
}

app.get('/api/calendar', async (req, res) => {
  const userId = await getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { data, error } = await supabase
    .from('calendar_items')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true, nullsFirst: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ items: data });
});

app.post('/api/calendar', async (req, res) => {
  const userId = await getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { title, date, time, type } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const { data, error } = await supabase
    .from('calendar_items')
    .insert({ user_id: userId, title, date: date || null, time: time || null, type: type || 'task', completed: false })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ item: data });
});

app.patch('/api/calendar/:id', async (req, res) => {
  const userId = await getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { completed } = req.body;
  const { data, error } = await supabase
    .from('calendar_items')
    .update({ completed })
    .eq('id', req.params.id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ item: data });
});

app.delete('/api/calendar/:id', async (req, res) => {
  const userId = await getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { error } = await supabase
    .from('calendar_items')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', userId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// ── ONBOARDING (first-time tour completion flag on profiles) ──────────────────
// Reads/writes profiles.onboarding_complete for the authenticated user.
// Kept as dedicated routes so the existing /api/profile selects stay untouched.

app.get('/api/onboarding', async (req, res) => {
  const userId = await getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { data, error } = await supabase
    .from('profiles')
    .select('onboarding_complete')
    .eq('id', userId)
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ onboarding_complete: !!data?.onboarding_complete });
});

app.post('/api/onboarding/complete', async (req, res) => {
  const userId = await getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { error } = await supabase
    .from('profiles')
    .update({ onboarding_complete: true })
    .eq('id', userId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// ── START ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`JARVIS OS server running on http://localhost:${PORT}`);
});
