# Beginner-Safe Proof Migration Setup

This guide assumes:

- you already created a new Supabase project
- you are new to Supabase
- you want the first migration to stay local and disposable

## 1. Fill the local env file

Open [.env.local](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/lifeos-new architecture/.env.local).

Already filled for you:

- `VITE_BASE44_APP_ID`
- `VITE_BASE44_APP_BASE_URL`
- `VITE_LIFEOS_AUTH_MODE=supabase`
- `VITE_LIFEOS_API_MODE=hybrid`

Still needed from you:

- `BASE44_ACCESS_TOKEN`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LIFEOS_MIGRATION_USER_ID`

## 2. Get the Supabase values from the Dashboard

In your Supabase project:

1. Open `Project Settings`.
2. Open `Data API` or `API Keys` depending on the dashboard layout.
3. Copy:
   - Project URL -> put this into both `VITE_SUPABASE_URL` and `SUPABASE_URL`
   - publishable / anon key -> put this into `VITE_SUPABASE_PUBLISHABLE_KEY`
   - service role key -> put this into `SUPABASE_SERVICE_ROLE_KEY`

## 3. Run the database migrations

In the Supabase Dashboard:

1. Open `SQL Editor`.
2. Run the contents of:
   - [20260319170000_initial_architecture.sql](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/lifeos-new architecture/supabase/migrations/20260319170000_initial_architecture.sql)
   - [20260319193000_phase2_core_board.sql](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/lifeos-new architecture/supabase/migrations/20260319193000_phase2_core_board.sql)
   - [20260319194500_fix_api_role_grants.sql](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/lifeos-new architecture/supabase/migrations/20260319194500_fix_api_role_grants.sql)
3. Run them in that order.

Expected result:

- tables like `workspaces`, `lists`, `cards`, `tasks`, `comments`, `attachments`, and `activity_events` exist
- API roles like `authenticated` and `service_role` can access the new tables

## 4. Create the uploads storage bucket

In the Supabase Dashboard:

1. Open `Storage`.
2. Create a new bucket called `uploads`.
3. Leave the bucket name as `uploads` so it matches the repo default.

## 5. Create one test auth user

In the Supabase Dashboard:

1. Open `Authentication`.
2. Open `Users`.
3. Create a user with email + password.
4. Copy that user’s UUID.
5. Put that UUID into `LIFEOS_MIGRATION_USER_ID` inside [.env.local](/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/lifeos-new architecture/.env.local).

This user will own the imported data and will also be the user you sign in with for smoke testing.

## 6. Get the Base44 access token

The app ID and Base44 base URL are already discovered locally.

Still needed:

- `BASE44_ACCESS_TOKEN`

Use the Base44 session you already use for this app and retrieve the access token from the app/session context you normally log in with. Once you have it, place it into `.env.local`.

## 7. Run preflight before migration

From the project root:

```bash
npm run migrate:preflight
```

This tells you which required values are already present and what is still missing.

## 8. Run the proof migration

Once preflight is clean:

```bash
npm run migrate:export:base44
npm run migrate:import:supabase -- --user-id YOUR_SUPABASE_AUTH_USER_ID
npm run migrate:verify:core -- --user-id YOUR_SUPABASE_AUTH_USER_ID
```

## 9. Smoke test locally

After import:

1. Start the app with `npm run dev`
2. Sign in using the Supabase test user you created
3. Check:
   - `Dashboard`
   - `Projects`
   - card detail modal
   - comments
   - linked tasks
   - attachments
4. Create at least one new workspace, list, card, linked task, comment, and attachment

## 10. If something goes wrong

Because this is a fresh dev Supabase project, the safe fix path is:

1. reset the dev DB or recreate the dev project
2. fix the env or mapping issue
3. rerun export/import/verify

Do not manually patch imported rows unless the issue is tiny and clearly understood.
