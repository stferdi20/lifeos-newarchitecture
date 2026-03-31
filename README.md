# LifeOS Migration Workspace

This repo now includes the self-owned runtime needed to replace Base44:

- `React + Vite` frontend kept in place for fast iteration
- `Hono` backend in [`server/app.js`](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/lifeos-new architecture/server/app.js)
- `Vercel` serverless entrypoint in [`api/[[...route]].js`](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/lifeos-new architecture/api/[[...route]].js)
- `Supabase` schema and RLS migration in [`supabase/migrations/20260319170000_initial_architecture.sql`](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/lifeos-new architecture/supabase/migrations/20260319170000_initial_architecture.sql)
- API role grants fix in [`supabase/migrations/20260319194500_fix_api_role_grants.sql`](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/lifeos-new architecture/supabase/migrations/20260319194500_fix_api_role_grants.sql)
- legacy-domain compatibility store in [`supabase/migrations/20260319220000_compat_entity_store.sql`](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/lifeos-new architecture/supabase/migrations/20260319220000_compat_entity_store.sql)
- backend-only Gemini routing, Google OAuth/calendar/docs/tasks flows, and Supabase-backed APIs
- a local Base44 compatibility shim so remaining pages can run on your backend while data is imported

## Run Locally

1. Copy `.env.example` to `.env.local` and fill in the keys you want to enable.
2. Install dependencies:

```bash
npm install
```

3. Start the frontend and local API together:

```bash
npm run dev
```

This runs:

- `vite` on the web side
- `node server/dev.js` for the backend API

The repo now defaults to the self-owned stack:

```bash
VITE_LIFEOS_AUTH_MODE=supabase
VITE_LIFEOS_API_MODE=hybrid
```

## Key Environment Variables

Frontend:

```bash
VITE_LIFEOS_AUTH_MODE=supabase
VITE_LIFEOS_API_MODE=hybrid|supabase
VITE_API_BASE_URL=/api
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Backend:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
APP_ORIGIN=
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL_CHEAP=qwen/qwen-2.5-7b-instruct
OPENROUTER_MODEL_STANDARD=mistralai/mistral-small-3.2-24b-instruct
OPENROUTER_MODEL_PREMIUM=anthropic/claude-3.7-sonnet
GOOGLE_GEMINI_API_KEY=
GOOGLE_GEMINI_MODEL_CHEAP=gemini-2.5-flash-lite
GOOGLE_GEMINI_MODEL_STANDARD=gemini-2.5-flash
GOOGLE_GEMINI_MODEL_PREMIUM=gemini-2.5-pro
HUGGINGFACE_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
GOOGLE_OAUTH_STATE_SECRET=
GOOGLE_TOKEN_ENCRYPTION_KEY=
INSTAGRAM_DOWNLOADER_BASE_URL=
INSTAGRAM_DOWNLOADER_SHARED_SECRET=
INSTAGRAM_DOWNLOADER_TIMEOUT_MS=120000
INSTAGRAM_DOWNLOADER_STATUS_STALE_MS=90000
YTDLP_BIN=yt-dlp
YTDLP_TIMEOUT_MS=20000
```

OpenRouter is the primary backend LLM provider for resource enrichment. Gemini and Hugging Face remain available as fallbacks when their keys are configured.

Sequential live re-enrichment for deployed resources is available with:

```bash
npm run reenrich:live -- --base-url https://lifeos-self-hosted.vercel.app --token YOUR_ACCESS_TOKEN
```

Helpful flags:

- `--dry-run` to inspect targets and suggested corrections without mutating live data
- `--project-id <id>` to limit to one project
- `--search <term>` / `--type <type>` / `--area-id <id>` / `--tag <tag>` for narrower scopes
- `--include-instagram` only if you explicitly want to override the default non-IG safeguard

YouTube transcript extraction now follows the same worker pattern as Instagram:

- if a transcript is immediately available, enrichment uses it right away
- if not, the resource is saved and a queue-backed worker job is created
- your local Python worker can later fetch the transcript and upgrade the resource automatically

Direct worker calls through `INSTAGRAM_DOWNLOADER_BASE_URL` are still supported, but they are no longer required for the same local-worker pattern that Instagram already uses.

Generic URL capture now also supports an async queue-backed flow:

- `POST /api/resources/capture` creates a visible placeholder resource immediately
- background analysis upgrades that same resource later
- `/capture?url=...` is the mobile-friendly entrypoint for iPhone Shortcuts and share flows
- generic capture now drains through the same local worker pattern already used for Instagram and YouTube jobs
- Instagram links shared through `/capture` are automatically handed off into the Instagram downloader queue so they do not get stuck in the generic analyzer path

Shortcut and operator setup details live in:

- [iPhone Shortcut Capture Guide](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/LifeOS Trifecta/lifeos-new architecture/docs/IPHONE_SHORTCUT_CAPTURE.md)

## Instagram Downloader

Local-first Instagram downloading now uses a separate Python service in [`instagram-downloader-service/README.md`](/Users/stefanusferdi/Documents/Data%20Penting/Antigravity%20Projects/LifeOS%20Trifecta/lifeos-new%20architecture/instagram-downloader-service/README.md).

Run it locally:

```bash
cd "/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/LifeOS Trifecta/lifeos-new architecture/instagram-downloader-service"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 9001
```

For Instagram reel preview images, make sure `ffmpeg` is installed on the Mac running the local worker.

Then point the existing backend at it:

```bash
INSTAGRAM_DOWNLOADER_BASE_URL=http://127.0.0.1:9001
INSTAGRAM_DOWNLOADER_SHARED_SECRET=your-shared-secret
```

That same worker now handles YouTube transcript extraction for the main backend. If your local worker is already polling the backend queue for Instagram jobs, YouTube transcript jobs will flow through the same worker without needing Vercel to reach your machine directly.

App-facing backend route:

```bash
POST /api/resources/instagram-download
```

Queue-backed production flow:

- the web app submits Instagram URLs to the Vercel-backed API
- the API creates a visible pending resource and queue job
- your self-hosted Python worker polls the queue when it is online
- on success, media is uploaded to Google Drive and the pending resource is updated
- successful queue rows are deleted so the queue stays small

Third-party public provider calls are backend-owned now. Stock search, crypto search, CoinGecko FX conversion, and TCG lookups run through `/api`, so Vercel does not need separate frontend env vars for those services.

Optional local migration bypass while auth is still being cut over:

```bash
LIFEOS_DEV_USER_ID=
LIFEOS_DEV_USER_EMAIL=
LIFEOS_DEV_USER_NAME=
LIFEOS_MIGRATION_USER_ID=
```

## Core Data Migration

Beginner-safe dashboard-first setup:

- [Proof Migration Setup](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/lifeos-new architecture/docs/PROOF_MIGRATION_SETUP.md)

Run a preflight check first:

```bash
npm run migrate:preflight
```

Export Base44 core data locally:

```bash
npm run migrate:export:base44
```

Import the exported data into Supabase for a specific existing auth user:

```bash
npm run migrate:import:supabase -- --user-id YOUR_SUPABASE_AUTH_USER_ID
```

Verify expected versus actual counts after import:

```bash
npm run migrate:verify:core -- --user-id YOUR_SUPABASE_AUTH_USER_ID
```

Export the remaining Base44 legacy entities:

```bash
npm run migrate:export:domains
```

Import those remaining legacy entities into the compatibility store:

```bash
npm run migrate:import:domains -- --user-id YOUR_SUPABASE_AUTH_USER_ID
```

Verify the imported legacy-domain counts:

```bash
npm run migrate:verify:domains -- --user-id YOUR_SUPABASE_AUTH_USER_ID
```

## Vercel Launch

Beginner-safe deployment guide:

- [Vercel Deployment Guide](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/lifeos-new architecture/docs/VERCEL_DEPLOYMENT.md)

## AI Collaboration

If you are working in this repo with Codex or other vibecoders, start with:

- [Agent Contract](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/LifeOS Trifecta/lifeos-new architecture/AGENTS.md)
- [AI Operator Guide](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/LifeOS Trifecta/lifeos-new architecture/docs/AI_OPERATOR_GUIDE.md)
- [AI Task Brief Template](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/LifeOS Trifecta/lifeos-new architecture/docs/AI_TASK_BRIEF_TEMPLATE.md)
- [Change Safety Map](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/LifeOS Trifecta/lifeos-new architecture/docs/CHANGE_SAFETY_MAP.md)

Non-trivial tasks in this repo now require an explicit documentation and guidance checkpoint:

- check whether user-facing or developer-facing docs need updates
- check whether `AGENTS.md` needs updates because workflow expectations changed
- check whether the operator guide needs updates because coordination guidance changed

If any answer is yes, update the relevant docs in the same task. If all answers are no, record that the check was performed.

## Current Migration Slice

Implemented now:

- backend health/auth/workspace/card/task routes
- task reminder routes backed by Google Tasks
- resource analysis and calendar parsing via backend AI router
- Supabase-only auth path and `/Login` screen
- local compatibility layer for remaining legacy Base44 entities/functions
- `Projects` board on backend CRUD + reorder + comments/activity
- card detail modal on backend AI, linked tasks, reminder sync, and managed file uploads
- Base44 export, Supabase import, and verification scripts for the core board model
- remaining-domain export/import/verify scripts for compatibility-store migration
- Vercel deployment docs and env checklist

Still intentionally incomplete:

- full route-by-route replacement of all `base44Client` imports with typed domain APIs
- removal of archived `base44/functions/` reference code from the repo
- complete production smoke testing on a live Vercel deployment

## Menubar Compatibility

This web/backend app currently owns the backend contract used by the native menubar app. That means a backend refactor can break the menubar even if the web UI still works.

The main shared routes are:

- `/auth/login`
- `/auth/refresh`
- `/auth/me`
- `/tasks`
- `/calendar/sync`
- `/resources/analyze`
- `/resources`

Before changing auth, tasks, calendar, or resource route shapes, read:

- [`docs/MENUBAR_COMPATIBILITY.md`](/Users/stefanusferdi/Documents/Data%20Penting/Antigravity%20Projects/LifeOS%20Trifecta/lifeos-new%20architecture/docs/MENUBAR_COMPATIBILITY.md)
