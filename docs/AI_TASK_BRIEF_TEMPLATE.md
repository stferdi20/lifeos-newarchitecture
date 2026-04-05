# AI Task Brief Template

Use this template when handing work to another vibecoder or agent.

## Goal

- What should be built, fixed, or updated?

## Plan mode clarification

- If the task brief is still missing key information, the agent working in Plan mode must ask a relevant clarifying question before proceeding.
- Use this section to note the most important ambiguity the agent should resolve first.

## Non-goals

- What should not be changed as part of this task?

## Allowed files or areas

- List the files, folders, or subsystems the agent is allowed to modify.

## Contracts to preserve

- List any routes, payloads, auth behavior, migration expectations, or downstream consumers that must keep working.
- Note when `docs/MENUBAR_COMPATIBILITY.md` must be reviewed before changes.

## Required validation

- List the checks that must be run, such as `npm run lint`, `npm run build`, manual route checks, migration verification, or worker validation.

## Documentation expected

- List any docs that likely need updating, or state that the agent must perform the documentation check and update relevant docs if needed.

## AGENTS.md / operator guide review

- State whether the task changes repo workflow, contributor expectations, or coordination guidance.
- Require the agent to explicitly report whether `AGENTS.md` or `docs/AI_OPERATOR_GUIDE.md` needed updates.

## Commit and push expectation

- State the branch expectation.
- State whether the agent should commit and push by default or stop before push.

## Final handoff format

The final handoff must include:

- scope completed
- validation run
- remaining risks
- files intentionally avoided because of unrelated work
- documentation and guidance checkpoint result

## Example

- Goal: Add a backend route for X and wire the web page to use it.
- Non-goals: Do not refactor unrelated dashboard components.
- Allowed files or areas: `server/routes/x.js`, `server/services/x.js`, `src/lib/x-api.js`, `src/pages/X.jsx`.
- Contracts to preserve: Existing menubar auth flow and current `/auth/*` responses.
- Required validation: `npm run lint`, `npm run build`, manual sanity check of the new route.
- Documentation expected: Update README or feature docs if setup or behavior changes.
- AGENTS.md / operator guide review: Confirm whether workflow guidance changed; update docs if yes.
- Commit and push expectation: Commit scoped changes and push to the current `codex/` branch unless blocked.
- Final handoff format: Use the standard operator-guide handoff template.
