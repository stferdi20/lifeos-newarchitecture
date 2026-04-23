# Vercel Deployment Guide

This app is designed to deploy to Vercel as:

- a static `Vite` frontend from `dist`
- a serverless `Hono` API through [`api/[[...route]].js`](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/lifeos-new architecture/api/[[...route]].js)
- `Supabase` for auth, database, and storage

## Before You Deploy

Make sure these are ready first:

1. Your Supabase project is working.
2. Your SQL migrations have been run.
3. Your `uploads` bucket exists.
4. Your `resource-thumbnails` bucket exists.
5. Your Google OAuth app exists.
6. Your OpenRouter key is working.

## Vercel Env Vars

Add these in the Vercel project settings:

```bash
VITE_LIFEOS_AUTH_MODE=supabase
VITE_LIFEOS_API_MODE=hybrid
VITE_API_BASE_URL=/api
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET_UPLOADS=uploads
SUPABASE_STORAGE_BUCKET_RESOURCE_THUMBNAILS=resource-thumbnails
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

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
GOOGLE_OAUTH_STATE_SECRET=
GOOGLE_TOKEN_ENCRYPTION_KEY=
LIFEOS_SHORTCUT_CAPTURE_TOKEN=
LIFEOS_SHORTCUT_CAPTURE_USER_ID=
INSTAGRAM_DOWNLOADER_BASE_URL=
INSTAGRAM_DOWNLOADER_SHARED_SECRET=
YOUTUBE_TRANSCRIPT_WORKER_BASE_URL=
YOUTUBE_TRANSCRIPT_WORKER_SHARED_SECRET=
YTDLP_BIN=yt-dlp
YTDLP_TIMEOUT_MS=20000
```

Recommended production redirect URI:

```bash
GOOGLE_OAUTH_REDIRECT_URI=https://YOUR-VERCEL-DOMAIN.vercel.app/api/google/callback
APP_ORIGIN=https://YOUR-VERCEL-DOMAIN.vercel.app
```

## First-Time Beginner Flow

1. Push this repo to GitHub.
2. Go to [Vercel](https://vercel.com/).
3. Click `Add New...` -> `Project`.
4. Import your GitHub repo.
5. Keep the default framework detection if Vercel suggests `Vite`.
6. Add all environment variables from the list above.
7. Click `Deploy`.

## External API Readiness

These integrations are already proxied through your backend, so the browser still only calls `/api` on Vercel:

- Yahoo Finance stock search and quotes
- CoinGecko crypto search and FX helper calls
- Pokemon TCG, YGOProDeck, Scryfall, and OptCG lookups
- OpenRouter, Gemini, Google Calendar, Google Docs, and Google Tasks
- the Python downloader worker if you want transcript-first YouTube enrichment and Instagram downloads

## YouTube Transcript Note

YouTube now follows its own queue-backed worker pattern and settings surface.

Production order:

1. immediate transcript extraction if available
2. queue a YouTube transcript job for the local Python worker
3. the worker prefers the undocumented YouTube web-client caption fetcher
4. `yt-dlp` remains only as a last-resort fallback when the caption fetcher cannot recover a transcript
5. description or metadata fallback

Important consequence:

- if your local Python worker is already polling the backend for Instagram jobs, it can also process YouTube transcript jobs
- Vercel does not need a public `yt-dlp` binary for this pattern
- the worker does not need `yt-dlp` to succeed in the common path, but keeping it installed still gives you a rescue path for edge cases
- `YOUTUBE_TRANSCRIPT_WORKER_BASE_URL` is only needed if you want direct backend-to-worker calls instead of the queue-backed worker flow
- queue-backed YouTube backfill is still created even when direct worker calls are unavailable, so transcript recovery can resume later when the worker comes back online
- the web app exposes YouTube transcript preferences and queue health in a separate Settings card, not inside the Instagram downloader panel

## Google OAuth Setup

After you know your Vercel domain:

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Go to `APIs & Services` -> `Credentials`.
3. Open your OAuth client.
4. Add this to `Authorized redirect URIs`:

```bash
https://YOUR-VERCEL-DOMAIN.vercel.app/api/google/callback
```

5. Save the client.
6. Copy the same callback URL into `GOOGLE_OAUTH_REDIRECT_URI` in Vercel.

## First Smoke Checks

After deploy, check these in order:

1. Open `/api/health`
2. Open the app homepage
3. Log in with Supabase auth
4. Open `Projects`
5. Open `Calendar`
6. Test `Connect Google`
7. Test one AI-powered action such as resource enrichment
8. Test one file upload

## Good Defaults

- Keep the frontend using `/api`
- Keep the API on Vercel Functions
- Keep all LLM calls on the backend
- Keep OpenRouter as the primary provider for resource enrichment, with Gemini as fallback
- Keep Supabase as the only database/auth source
- Keep the Python downloader worker online for production Instagram downloads and YouTube transcript extraction

## If Something Fails

- `401` or empty data: check `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Google connect fails: check `APP_ORIGIN` and `GOOGLE_OAUTH_REDIRECT_URI` in both Vercel and Google Cloud
- uploads fail: make sure the `uploads` bucket exists
- Instagram thumbnails fail: make sure the `resource-thumbnails` bucket exists and `SUPABASE_STORAGE_BUCKET_RESOURCE_THUMBNAILS` matches it
- AI fails: check `OPENROUTER_API_KEY` first, then `OPENROUTER_MODEL_CHEAP` and `OPENROUTER_MODEL_STANDARD`; if fallback is expected, also check `GOOGLE_GEMINI_API_KEY`
- finance or TCG lookup fails: check Vercel function logs for upstream timeout or provider outage
