# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install      # install dependencies
npm start         # run server (node server.js)
npm run dev       # run server with nodemon auto-reload
```

No build step, no bundler, no test suite, no linter configured. The frontend is served directly as static files from `public/` by Express (`express.static`).

Server runs on `http://localhost:3000` by default (`PORT` env var). Required env vars (see `.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APIFY_TOKEN`, `PORT`.

## Architecture

JARVIS OS is a founder command-center dashboard: a single-page vanilla HTML/CSS/JS frontend (`public/index.html`, `public/app.js`, `public/style.css`) backed by a thin Express proxy (`server.js`). There is no frontend framework and no module bundler — everything in `app.js` runs in one global scope across ~1300 lines.

### Secrets/config split: Supabase vs. localStorage

This is the most important architectural rule in the codebase and is easy to violate by accident:

- **Supabase `profiles` table stores ONLY `{id, name, email, niche}`.** Nothing else is persisted server-side for a user.
- **Everything else lives in browser localStorage**, under the keys defined in `LS` (`public/app.js`): session token (`jarvis_session`), news topics (`jarvis_topic1`/`jarvis_topic2`), API keys (`jarvis_groq`, `jarvis_tavily`, `jarvis_apify`), the agenda (`jarvis_agenda_${userId}`), and chat history (`jarvis_chat_${userId}`).
- API keys (Groq/Tavily/Apify) are **never** stored or read server-side. The client sends them in the request body on every call (`groq_key`, `tavily_key`, `apify_token`), and `server.js` passes them straight through to the third-party API per-request. Do not add server-side key storage or env-var fallback for these — that was deliberately removed.
- The agenda (merged tasks+events) is **fully localStorage-based**. The Supabase `tasks` table and the `/api/tasks/*` routes in `server.js` still exist in code but the frontend no longer calls them (the underlying Supabase table was dropped). Don't resurrect `/api/tasks` calls from `app.js` without first confirming the table exists again.

### Auth

Standard Supabase email+password auth (`auth.signUp` / `signInWithPassword` / `getUser`), not OTP/magic-link despite what `README.md` still says in places — the README is stale on this point. Routes: `POST /api/auth/signup`, `/signin`, `/signout`, `/session` in `server.js`. New signups always get routed through profile setup (`screen-profile`) since `isFullProfile()` just checks `!!profile?.niche`.

### Screen flow (`public/app.js`, `transitionTo()`)

`screen-boot` → `screen-auth` → `screen-profile` (first-time only) → `screen-dashboard`, all toggled via `.screen` class on divs in `index.html`. An `#init-overlay` gate ("CLICK TO INITIALIZE") sits in front of everything and exists solely to satisfy browser autoplay policy before the Web Audio engine (`AUDIO`/`tone()`/`playClick()` etc.) can play sound.

### Dashboard panels and their data sources

- **News Feed 1** (`news-panel-1`) — `POST /api/news` with `{topic, tavily_key}`, Tavily search API.
- **Content Intelligence** (`ig-panel`) — NOT routed through `server.js`/Apify anymore. `runContentIntelligence()` in `app.js` posts directly from the browser to an n8n webhook (`CONTENT_INTEL_WEBHOOK = 'http://localhost:5678/webhook/content-intelligence'`) with `{username, minLikes, limit, resultsType, contentType, groq_key}`, and renders the AI-generated report (metrics, engagement chart, top performer, last-7-days, executive summary, hooks, content ideas, recommendations) via `renderIntelReport()`. The old `server.js` route `POST /api/instagram-trends` (Apify `instagram-search-scraper`) still exists but is currently unused by the frontend — it's dead code kept for reference, not deleted.
- **Calendar / Agenda** — unified into one concept ("Agenda": tasks + events, distinguished by `item.type`). Fully localStorage-backed (`loadAgenda`/`saveAgenda`/`addAgendaItem` in `app.js`), keyed per-user as `jarvis_agenda_${userId}`. Calendar widget reads from the same `STATE.agenda` array. `startTaskNotifier()` polls for due items and fires browser notifications + a chime.
- **JARVIS chat** — `POST /api/chat` with `{userId, message, history, groq_key}`. The system prompt is built server-side in `server.js` from live Supabase data (name, niche, today's date, today's tasks, upcoming events) to keep responses grounded and prevent hallucinated schedule items. Uses Groq model `llama-3.1-8b-instant`. Replies are also spoken via Web Speech API (`speakText()` in `app.js`).

### Visual design system (`public/style.css`)

Dark/cyan/monospace "JARVIS" aesthetic: `--bg:#000008`, `--cyan:#00e5ff`, `--green:#00ff88`, fonts `--font-mono` (IBM Plex Mono) and `--font-orb` (Orbitron, used for large numeric/title display). Every panel follows the same markup convention — four `.panel-corner` bracket-decoration divs (┌┐└┘) plus a `.panel-header-bar` > `.panel-title`. New panels should reuse these classes and the existing CSS custom properties rather than introducing new color literals, to stay visually consistent.
