# LifeOS Webapp Agent Contract

This repository is the main web app/backend repo for LifeOS and is connected to:

- `origin`: `https://github.com/stferdi20/lifeos-newarchitecture`

Read this file before editing tracked files. The goal is to make multi-agent work safe, predictable, and easy to hand off.

## Repo map and boundaries

- `src/`: React + Vite web app UI, page flows, hooks, and frontend API clients.
- `server/`: Hono backend routes, services, and runtime helpers.
- `api/`: Vercel serverless entrypoint that exposes the backend.
- `supabase/migrations/`: schema, grants, RLS, and queue/storage changes.
- `instagram-downloader-service/`: separate Python worker/service used by the web/backend flow.
- `docs/`: operator-facing and developer-facing docs. Update when behavior or workflow changes.

This repo covers the web app and backend. The native menubar app in the sibling `lifeos-menubar` folder is not part of this git repo, but this repo still owns backend contracts that the menubar consumes.

## Cross-surface sync rule

- If a change in this repo affects a feature that also exists in the menubar app, do not treat the webapp/backend change as isolated by default.
- Check whether the native menubar flow, payload shape, caching strategy, copy behavior, or UX should also be updated so both surfaces stay connected and seamless.
- If the counterpart should change, update it in the same task when possible.
- If the counterpart change is risky or ambiguous, pause and confirm with the user instead of letting the two surfaces drift.
- Apply the same reasoning in reverse when a menubar task implies webapp or backend support changes.
- For snippet work specifically: synced snippets stay shared across webapp and menubar, but clipboard history remains menubar-local unless the user explicitly asks to sync raw history.

## Required start-of-task workflow

Before making edits:

1. Read `git status` and identify unrelated dirty files.
2. Define the exact scope you own for this task.
3. Avoid files that already contain unrelated in-progress work unless the task explicitly requires coordination there.
4. If you must touch a file with unrelated local edits, read it carefully and preserve that work. Never overwrite or revert it.
5. If the same file contains conflicting user-owned changes and you cannot safely isolate your work, stop and report the conflict instead of guessing.

## Plan mode clarification rule

- If Plan mode is active, ask the user at least one relevant clarifying question before proposing a plan or starting implementation.
- Favor questions that resolve scope, desired behavior, constraints, tradeoffs, and success criteria.
- Do not fill in missing details with assumptions while Plan mode is active.
- If the answer still leaves the task ambiguous, ask another focused question before moving forward.

## Ownership and dirty-worktree rules

- Never bundle unrelated pre-existing changes into your commit.
- Stage only the files and hunks required for your task.
- Keep commits scoped to one feature, fix, or documentation update.
- Never revert or overwrite unrelated local changes you did not make.
- If a dirty worktree prevents a safe commit, explain exactly which files blocked you.

## Change-type validation requirements

Run validation appropriate to the area you changed and report what you actually ran.

- UI-only changes in `src/`: run `npm run lint` and `npm run build`.
- Backend-only changes in `server/` or `api/`: run `npm run lint`, `npm run build`, and perform a relevant manual API sanity check when route behavior changed.
- Shared web + backend contract changes: run `npm run lint`, `npm run build`, and explicitly call out any payload, route, or auth contract change.
- Migration changes in `supabase/migrations/`: validate the migration logic as far as the environment allows and document rollout assumptions, data risk, and rollback constraints.
- Instagram downloader changes across backend/worker boundaries: validate both sides that changed and note any steps that still require the Python worker or external credentials.

If you could not run a recommended check, say so explicitly in your final handoff.

## Compatibility guardrails

Before changing auth, tasks, calendar, resources, or other shared API contracts, read:

- `docs/MENUBAR_COMPATIBILITY.md`

Treat these as high-risk changes:

- request/response shape changes
- auth/session behavior changes
- route renames or removals
- background worker protocol changes
- migration changes that affect current production or compatibility data

When in doubt, document the compatibility risk instead of assuming the web app is the only consumer.

## Documentation and guidance checkpoint

For every non-trivial change, you must explicitly check all three of these:

1. Does user-facing or developer-facing documentation need to be updated?
2. Does `AGENTS.md` need to change because repo workflow or contributor expectations changed?
3. Does `docs/AI_OPERATOR_GUIDE.md` need to change because coordination, handoff, or safety guidance changed?

Required behavior:

- If any answer is yes, update the relevant docs in the same task.
- If all answers are no, say that you performed the check and no doc or guide update was needed.
- Your final handoff must include the result of this checkpoint.

Do not treat this as optional housekeeping.

## Commit and push workflow

- Use a `codex/` branch by default unless the user asked for a different branch or you are already on the correct task branch.
- After verifying your change, commit the relevant repo changes and push them to `origin`, unless the user explicitly says not to push yet.
- Default to finishing each completed task with a commit and push without waiting for an extra reminder.
- Treat commit-and-push as the normal completion path, not an optional follow-up step. Do not wait for the user to repeat this instruction on each task.
- Unless the user explicitly asks for branch-only work, PR-only work, or no promotion to production, land validated changes onto `main` and push `origin/main` before handoff.
- If work begins on a `codex/` branch, finish by fast-forwarding or otherwise safely merging the validated branch into `main`, then push `main`.
- Do not ask the user to run normal git commands that you can run directly.
- Do not stage unrelated dirty-worktree changes just to make a push succeed.
- If a safe commit is impossible because unrelated work is mixed into the same hunks, stop and explain the blocker.

## Required final handoff format

Your final update to the user must include:

- what behavior or docs changed
- what validation you ran
- what risks or follow-up checks remain
- which files you intentionally avoided because they contained unrelated work
- the result of the documentation and guidance checkpoint

## Operator references

Use these docs while working:

- `docs/AI_OPERATOR_GUIDE.md`
- `docs/AI_TASK_BRIEF_TEMPLATE.md`
- `docs/CHANGE_SAFETY_MAP.md`
- `docs/MENUBAR_COMPATIBILITY.md`
