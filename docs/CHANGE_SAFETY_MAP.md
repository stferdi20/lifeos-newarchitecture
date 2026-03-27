# Change Safety Map

Use this as a quick risk index before changing shared or sensitive parts of the repo.

## Menubar-shared routes

- What can break: The native menubar app can fail even if the web UI still works.
- What must be checked: Read `docs/MENUBAR_COMPATIBILITY.md`, confirm route shape compatibility, and call out any request/response/auth changes.
- Docs or guides to review: `docs/MENUBAR_COMPATIBILITY.md`, README if setup or route behavior changed, `AGENTS.md`/operator guide only if process expectations changed.

## Auth and session flows

- What can break: Login, refresh, current-user fetches, protected routes, and downstream clients.
- What must be checked: Existing auth routes, token assumptions, env requirements, and menubar compatibility when relevant.
- Docs or guides to review: README for env/setup changes, compatibility docs for shared consumers, guidance docs only if workflow changed.

## Supabase migrations and RLS

- What can break: production data, access control, local dev setup, deploy order, rollback safety.
- What must be checked: migration intent, grants/RLS impact, sequencing assumptions, and whether rollback or data backfill needs to be documented.
- Docs or guides to review: README, deployment/setup docs, migration docs, and guidance docs if the contributor workflow for migrations changed.

## Base44 compatibility code

- What can break: partially migrated pages still relying on compatibility data or legacy behavior.
- What must be checked: whether the target flow still uses compatibility functions or stores, and whether replacing them changes data shape or fallback behavior.
- Docs or guides to review: README or migration docs if the migration story changed, guidance docs only if repo operating rules changed.

## Environment or config changes

- What can break: local setup, Vercel deployment, backend integrations, secret requirements.
- What must be checked: `.env.example`, README env sections, deployment docs, and any service-specific setup instructions.
- Docs or guides to review: README, `docs/VERCEL_DEPLOYMENT.md`, service setup docs, plus guidance docs if contributors now need to follow a new process.

## Instagram downloader split architecture

- What can break: queue flow, worker polling, shared secrets, upload flow, status updates, local-first behavior.
- What must be checked: both Node and Python sides when relevant, queue semantics, env requirements, and what remains unverified if one side was not exercised.
- Docs or guides to review: README and service docs for setup/behavior changes, guidance docs if collaboration or ownership expectations changed.

## Shared API payload or route-shape changes

- What can break: frontend callers, menubar clients, background integrations, and any scripts expecting current response shapes.
- What must be checked: all consumers of the route/client, manual sanity validation, compatibility notes, and rollout risk.
- Docs or guides to review: feature docs, README when behavior changed, `docs/MENUBAR_COMPATIBILITY.md` when applicable, and guidance docs if this exposed a missing workflow rule.
