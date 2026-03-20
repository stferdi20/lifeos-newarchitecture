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
GOOGLE_GEMINI_API_KEY=
GOOGLE_GEMINI_MODEL_CHEAP=gemini-2.5-flash-lite
GOOGLE_GEMINI_MODEL_STANDARD=gemini-2.5-flash
GOOGLE_GEMINI_MODEL_PREMIUM=gemini-2.5-pro
OPENROUTER_API_KEY=
HUGGINGFACE_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
GOOGLE_OAUTH_STATE_SECRET=
GOOGLE_TOKEN_ENCRYPTION_KEY=
```

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
