# Webapp And Backend Notes For Menubar Compatibility

This document is for engineers changing the web app or backend. The native menubar app depends on a small set of backend contracts and does not automatically inherit frontend changes.

## Shared Contract Surface

The menubar currently depends on these backend routes:

- `/auth/login`
- `/auth/refresh`
- `/auth/me`
- `/tasks`
- `/tasks/:taskId`
- `/calendar/sync`
- `/resources/analyze`
- `/resources`

Relevant backend ownership today:

- auth routes: `server/routes/auth.js`
- task routes: `server/routes/tasks.js`
- calendar routes: `server/routes/calendar.js`
- resource routes: `server/routes/resources.js`

## Rules That Must Stay True

### Auth

- `/auth/login` must accept `email` and `password`.
- `/auth/login` must return `access_token`, `refresh_token`, `expires_at`, `token_type`, and `user`.
- `/auth/refresh` currently accepts camelCase `refreshToken`.
- `/auth/refresh` must return the same session shape as login.
- `/auth/me` must return `user.full_name` in snake_case.
- `401` from `/auth/me` must continue to mean the session is not usable.

If any of those change, the native auth flow must be updated in the same change set.

### Tasks

The menubar expects:

- `GET /tasks` => `{ tasks: [...] }`
- `POST /tasks` => `{ task: {...} }`
- `PATCH /tasks/:taskId` => `{ task: {...} }`

The native client relies on snake_case task fields such as:

- `due_date`
- `due_time`
- `workspace_name`
- `card_title`
- `created_date`
- `updated_date`
- `due_bucket`

### Calendar

The menubar uses `POST /calendar/sync` with `action: "fetch"` and expects:

- request keys: `calendarId`, `timeMin`, `timeMax`, `timeZone`, `payload.maxResults`
- response wrapper: `{ events: [...] }`

### Resources

The menubar uses:

- `POST /resources/analyze` with `url`, optional `title`, optional `content`
- `POST /resources` expecting `{ resource: {...} }`

## What Will Usually Break The Menubar

- renaming route paths
- changing wrapper keys like `task`, `tasks`, `events`, or `resource`
- changing snake_case response fields used by the native models
- changing refresh request shape from `refreshToken` without a native update
- returning partial auth success payloads without a valid restorable session

## Safe Change Checklist

Before merging a backend change that touches shared routes:

1. Compare the new request and response shape against the menubar contract.
2. Keep field names stable or update the native models and services in the same branch.
3. Re-test native sign-in and session restore.
4. Re-test menubar tasks, calendar, and resource capture.
5. Update this document and the menubar-side compatibility doc if the contract changed intentionally.

## Where The Native Side Documents Its Assumptions

See the matching native doc:

- [`lifeos-menubar/docs/WEBAPP_COMPATIBILITY.md`](/Users/stefanusferdi/Documents/Data%20Penting/Antigravity%20Projects/LifeOS%20Trifecta/lifeos-menubar/docs/WEBAPP_COMPATIBILITY.md)
