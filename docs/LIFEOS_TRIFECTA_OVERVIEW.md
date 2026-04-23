# LifeOS Trifecta Overview

LifeOS is a three-surface productivity system:

- the main web app for deep work and administration
- an installable PWA-style browser experience for mobile and quick capture
- a native macOS menubar companion for instant access to the most important actions

All three surfaces share the same backend and data model, so the goal is not to keep three separate apps in sync. The goal is to make each surface feel optimized for a different moment in the workflow.

## The Three Surfaces

### 1. Web App

The web app is the primary LifeOS surface. It runs in the browser, provides the full feature set, and is the place where most structured work happens.

Best for:

- planning and reviewing work
- managing projects, tasks, resources, and snippets
- exploring knowledge, media, investments, and trends
- configuring account connections and automation

Primary entry points:

- `src/App.jsx`
- `src/Layout.jsx`
- `src/components/layout/Sidebar.jsx`

### 2. PWA / Mobile Browser Experience

The PWA is the same web app presented as an installable, mobile-friendly app shell. It is not a separate codebase.

Best for:

- opening LifeOS from the home screen or browser app switcher
- capturing links from iPhone Share Sheet or shortcut flows
- quick review and handoff on mobile

Primary entry points:

- `index.html` links to `/manifest.json`
- `src/pages/Capture.jsx`
- `docs/IPHONE_SHORTCUT_CAPTURE.md`

Current note:

- the repo includes the manifest link expected by an installable PWA, but there is no checked-in service worker or offline cache layer in this workspace

### 3. Menubar App

The menubar app is the native macOS companion. It is intentionally smaller and faster than the web app and focuses on quick access.

Best for:

- checking and updating tasks
- looking at the calendar
- capturing a resource link
- opening the full web dashboard when needed

Primary entry points:

- `lifeos-menubar/README.md`
- `lifeos-menubar/docs/WEBAPP_COMPATIBILITY.md`

## Shared Foundation

The surfaces are connected by the same backend and session model.

Shared capabilities include:

- Supabase-based authentication in the current web stack
- backend routes for tasks, calendar, resources, snippets, and more
- queue-backed resource capture and background enrichment
- Google integrations for calendar and reminders
- optional local worker support for Instagram and YouTube-style capture workflows

The most important cross-surface rule is compatibility: if a backend contract changes, the menubar and web app may both need updates.

## Web App Feature Map

### Dashboard

The dashboard is the default landing page in the web app. It is organized as a set of widgets for quick scanning and short actions.

It currently includes:

- greeting / daily context
- today schedule
- quick resource capture
- quick creator capture
- habit summary
- task overview
- idea spark
- AI news widget
- investment widget

### Calendar

The calendar page is the main planning surface for time-based events and schedules.

It supports:

- viewing calendar events
- creating and editing events
- natural language event entry
- recurring schedules and event categories
- syncing with Google Calendar

### Projects

Projects is the structured board for work that needs workflow, status, and organization.

It supports:

- workspaces
- lists and cards
- kanban-style drag and drop
- card details and task-style editing
- archiving and workspace management
- a Gantt-style view for timeline context
- a legacy projects route and a Kanban v2 route, selected by migration/feature state

### Tasks

Tasks is the operational action list.

It is meant for:

- standalone action items
- promoting checklist items or card-level work into tracked tasks
- filtering by active, due soon, linked, and personal views
- syncing reminder updates back through the backend

### Habits

Habits is a simple tracker for routines and streaks.

It supports:

- habit creation and editing
- emoji-based habit icons
- habit logging and history
- streak-oriented tracking

### Resources

Resources is the knowledge capture and organization hub.

It supports:

- URL capture and queue-based processing
- manual notes
- bulk add flows
- filtering by type, area, project, archive state, and tags
- resource detail inspection
- re-enrichment of captured items
- retrying failed captures
- Instagram and YouTube queue state awareness
- linking resources to projects and life areas

Resources is the main destination for anything that starts as a link, note, article, video, or imported item.

### Snippets

Snippets is the shared reusable content library.

It supports:

- text snippets
- image snippets
- copying and clipboard reuse
- favorites
- workspace association
- snippet copy tracking

This is one of the strongest examples of cross-surface behavior because the web app and menubar both rely on the same shared snippet system.

### Media

Media is a tracker for media consumption and media-related records.

It supports:

- a library view
- a yearly view
- search and detail review
- bulk additions
- repair workflows

### Creator Vault

Creator Vault is the creator-facing content workspace.

It is used for:

- storing creator assets and reference material
- organizing creator-oriented work in one place

### Investments

Investments tracks personal financial and collection assets.

It supports:

- stocks
- crypto
- trading card game assets
- bank / cash entries
- price refreshes and portfolio summaries

### Prompt Wizard

Prompt Wizard is the prompt-building and reuse workspace.

It supports:

- creating prompts
- saving prompts
- reusing prompts
- organizing prompt assets for repeated AI workflows

### Trends

Trends is the realtime trend aggregation view.

It focuses on:

- AI
- tech
- startups
- crypto

### News

News is the AI-curated news feed.

It currently offers category-based browsing for:

- AI and machine learning
- tech
- startups
- crypto and web3

### Settings

Settings is the control panel for connections and account state.

It currently includes:

- account display and logout
- Google connections
- Instagram downloader status / automation controls
- YouTube transcript status / automation controls

### Legacy and Redirected Pages

These routes currently redirect into Resources rather than acting as distinct feature areas:

- Ideas
- Notes
- Tools

## Menubar Feature Map

The menubar app is intentionally narrower than the web app.

It currently includes:

- the menubar status item and popover shell
- a dedicated Tasks surface backed by the shared backend
- a dedicated Calendar surface backed by the shared backend
- a Resources Capture flow for quick URL capture
- a Settings screen
- a button to open the deployed web dashboard
- connection validation through `/auth/me`
- native Supabase sign-in with email/password
- magic-link fallback through callback URLs

The menubar is designed for speed and perceived immediacy, so cached data and background refresh behavior matter more than a full-page reload experience.

## Typical Workflow

### Capture First

1. A link or idea appears in the browser, on mobile, or in the menubar.
2. The user sends it to LifeOS through quick capture.
3. LifeOS creates a placeholder record immediately.
4. Background analysis enriches the item later.
5. If the worker is offline, the item stays queued and resumes when the worker returns.

### Organize Second

1. The captured item is reviewed in Resources.
2. It can be tagged, linked to a project, linked to a life area, or enriched.
3. If it becomes actionable, it can turn into a task or a project card.

### Execute Third

1. Tasks holds the day-to-day action list.
2. Projects holds the larger work structure and card flow.
3. Calendar holds time-based commitments and scheduling.
4. Dashboard surfaces the most relevant subset of the above for fast review.

### Review and Extend

1. Snippets store reusable text and media.
2. Habits track routines.
3. Media, Investments, News, Trends, and Creator Vault extend LifeOS into adjacent personal knowledge areas.
4. Settings keeps integrations and automation healthy.

## Cross-Surface Rules

- The web app is the deepest surface.
- The PWA is the quickest mobile-friendly browser surface.
- The menubar is the fastest desktop surface for recurring check-ins.
- Shared backend routes must stay compatible across all three.
- If a feature is used in more than one surface, changes should be coordinated rather than treated as isolated UI work.

## Practical Summary

If you want the shortest possible description:

- web app = full LifeOS control center
- PWA = installable and mobile-friendly capture surface
- menubar = instant macOS companion for tasks, calendar, and capture
