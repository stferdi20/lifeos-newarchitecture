# LifeOS Product Feature Research

Purpose: collect current patterns from adjacent productivity, task, and resource-management apps, then translate them into LifeOS-sized feature bets.

Last researched: 2026-04-23

## Sources Reviewed

- Todoist features: capture, priorities, labels, Today, Upcoming, filters, flexible list/calendar/board views, productivity history.
- Sunsama user manual: guided daily planning, ordering daily work, planning realistic work hours, calendar timeboxing.
- Sunsama calendar integration: calendar event import, task timeboxing, calendar event creation and editing.
- Akiflow features: universal inbox, task capture, rituals, time blocking, command bar, focus timer, shortcut-heavy workflows.
- Readwise Reader docs: unified reading inbox for articles, newsletters, PDFs, videos, tweets, highlights, and review.
- Raindrop.io docs: unsorted bookmark inbox, collections, AI collection suggestions, highlights and annotations across web pages, PDFs, and books.

## Feature Patterns Worth Borrowing

1. Daily planning ritual
   - Why it matters: users need a small commitment surface, not only a full backlog.
   - LifeOS fit: Tasks already know due date, priority, status, card, workspace, and reminders, so a planner can work before adding schema.
   - First shipped step: Today Plan on the Tasks page.

2. Universal capture inbox
   - Why it matters: Akiflow, Todoist, Reader, and Raindrop all reduce friction by giving every incoming item a temporary home.
   - LifeOS fit: Resources and Capture already support placeholder resources and background enrichment.
   - Next step: add a triage queue that groups unsorted resources, pending captures, and tasks without workspace/card context.

3. Smart resource triage
   - Why it matters: Raindrop and mymind-style flows win by reducing manual filing.
   - LifeOS fit: resource enrichment already classifies metadata; the UI can expose "suggested project", "suggested tags", and "review later" actions.
   - Next step: add review chips to unsorted resources before changing backend automation.

4. Time blocking and capacity
   - Why it matters: Sunsama/Akiflow make the day visible against calendar availability.
   - LifeOS fit: Calendar data and task due times already exist.
   - Next step: show a "planned load" meter and then allow dragging tasks into calendar slots.

5. Highlight and annotation capture
   - Why it matters: Reader/Raindrop turn saved resources into reusable knowledge.
   - LifeOS fit: Resources already store descriptions, thumbnails, transcript/enrichment fields, and project links.
   - Next step: support a lightweight highlight/note layer per resource.

6. Command bar for capture and navigation
   - Why it matters: Akiflow's keyboard-first command bar turns routine actions into muscle memory.
   - LifeOS fit: the app has many surfaces and already separates API clients by domain.
   - Next step: add a global command palette for "new task", "capture URL", "new resource", "jump to page", and "search resources".

## Recommended Implementation Order

1. Today Plan for Tasks: low risk, frontend-only, immediate utility.
2. Resource triage queue: moderate UI work, uses existing Resources API.
3. Command bar quick capture: moderate shared UX work, touches navigation and create flows.
4. Time blocking from tasks to calendar: higher risk because it may create/update Google Calendar events.
5. Resource highlights and annotations: likely needs schema and route changes.

## Implemented

- 2026-04-23: Added Today Plan to the Tasks page with a focus queue, planned-load signal, and quick actions to start or schedule suggested tasks.
