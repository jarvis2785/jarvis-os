# JARVIS OS — Founder Command Center

A full-stack founder dashboard with AI chat, live news feeds, task management, and a custom calendar.

## Stack
- **Frontend**: Vanilla HTML/CSS/JS (single page)
- **Backend**: Node.js + Express
- **Auth**: Supabase (email OTP, no password)
- **Database**: Supabase
- **AI Chat**: Groq API (llama3-8b-8192)
- **News**: Tavily API
- **Voice**: Web Speech API (browser built-in)

---

## Setup

### 1. Clone & install

```bash
cd jarvis-os
npm install
```

### 2. Environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
PORT=3000
```

### 3. Create Supabase tables

Go to your Supabase project → SQL Editor → run this:

```sql
-- Enable UUID extension (usually already enabled)
create extension if not exists "uuid-ossp";

-- Profiles table
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  name text not null,
  niche text,
  news_topic_1 text,
  news_topic_2 text,
  groq_key text,
  tavily_key text,
  created_at timestamp with time zone default now()
);

-- Tasks table
create table tasks (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  text text not null,
  date text,
  time text,
  done boolean default false,
  created_at timestamp with time zone default now()
);

-- If you already created the tasks table without the date column, run:
-- alter table tasks add column date text;

-- Unified agenda: tasks and events now live in the SAME table.
-- The `type` column distinguishes them ('task' or 'event'):
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS type text DEFAULT 'task';

-- Row Level Security (optional but recommended)
alter table profiles enable row level security;
alter table tasks enable row level security;

create policy "Users can manage own profile" on profiles
  for all using (auth.uid() = id);

create policy "Users can manage own tasks" on tasks
  for all using (auth.uid() = user_id);

-- NOTE: events are now stored as rows in the `tasks` table with type='event'.
-- The separate `events` table is no longer used. You can drop it if you wish:
-- drop table if exists events;
```

### 4. Supabase Auth settings

In Supabase dashboard → Authentication → Settings:
- Enable **Email OTP** (it's on by default)
- Set **OTP expiry** to 600 seconds (10 min) or your preference
- Add `http://localhost:3000` to **Redirect URLs** if needed

### 5. Get API keys

| Key | Where to get |
|-----|-------------|
| Groq API key | https://console.groq.com |
| Tavily API key | https://tavily.com |
| Apify token (optional, for Instagram trends) | https://console.apify.com/account/integrations |

These are entered by the user in the profile setup screen — they're stored in Supabase and used server-side only. Never exposed to the browser.

---

## Run locally

```bash
npm start
# or for auto-reload during development:
npm run dev
```

Open: `http://localhost:3000`

---

## Flow

1. **Boot screen** — animated terminal boot with Web Audio API synth sound
2. **Auth** — enter name + email → receive OTP → enter code
3. **Profile setup** (new users only) — configure niche, news topics, API keys
4. **Dashboard** — full command center with:
   - Live news feeds (2 topics)
   - Custom calendar with event management
   - Task manager with time-based browser notifications
   - JARVIS AI chat (Groq) with text-to-speech

---

## Architecture notes

- All Groq and Tavily API calls happen **server-side** in `server.js`
- User API keys are fetched from Supabase on each request — never sent to the browser
- Frontend only calls `/api/*` routes
- Auth uses Supabase's built-in OTP flow via the server-side SDK
