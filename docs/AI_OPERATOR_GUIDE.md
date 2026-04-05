# AI Operator Guide

This guide is the day-to-day playbook for working in the LifeOS webapp/backend repo with other vibecoders or agents.

## Start-of-task checklist

1. Read `AGENTS.md`.
2. Run `git status --short` and identify unrelated dirty files before editing anything.
3. Confirm the exact task scope, affected subsystems, and likely risk level.
4. Check whether the task touches any high-risk areas in `docs/CHANGE_SAFETY_MAP.md`.
5. If the task can affect menubar-consumed routes or shared contracts, read `docs/MENUBAR_COMPATIBILITY.md`.
6. Decide the minimum validation needed for this task before you start coding.
7. If the feature exists on both webapp and menubar, decide up front whether both surfaces should be updated together.

## How to claim scope and avoid stepping on other agents

- Prefer a narrow file and behavior scope for each task.
- Assume any unrelated dirty file belongs to someone else unless the task clearly says otherwise.
- If multiple agents are active, split work by subsystem or file ownership instead of sharing the same files.
- If you notice another agent already changed the file you need, accommodate that work when safe. Do not revert it.
- If safe coexistence is unclear, stop and surface the overlap instead of improvising.

## When to proceed and when to ask

Proceed without asking when:

- the repo structure and existing patterns make the intended change clear
- the impact is local and reversible
- the user already gave enough direction to validate scope and success

In Plan mode, do the opposite by default:

- ask at least one relevant clarifying question before proposing a plan or starting work
- prefer questions that narrow scope, clarify the desired outcome, and surface hidden constraints
- avoid making assumptions while the task is still being scoped in Plan mode
- if the first answer still leaves ambiguity, ask a second focused question before moving on

Stop and ask when:

- the same file has conflicting in-progress work you cannot safely preserve
- the task implies a behavior or contract decision with non-obvious downstream impact
- the task changes a cross-surface feature and it is unclear whether the webapp and menubar should keep identical behavior
- you would need to change auth, route shape, migration semantics, or compatibility behavior without a clear source of truth
- validation is blocked in a way that materially weakens confidence and there is no good fallback

## Cross-surface default

When a feature exists in both the webapp and the menubar:

- assume the desired outcome is a seamless shared behavior, not two independent implementations
- check whether UX, caching, create/edit flows, validation, and backend payload handling should stay aligned
- update both surfaces in the same task when the change is straightforward
- if only one surface changes, explicitly justify why the other surface was left alone

For snippet-related work:

- keep real snippets aligned across both surfaces
- treat clipboard history as menubar-local by default
- only promoted history items should cross into the shared backend snippet system unless the user asks for a different model

## Documentation and guidance checkpoint

For every non-trivial task, perform and report this check:

1. Does user-facing or developer-facing documentation need to be updated?
2. Does `AGENTS.md` need to change because repo workflow or contributor expectations changed?
3. Does this operator guide need to change because coordination or safety guidance changed?

Required behavior:

- If yes, update the relevant docs in the same task.
- If no, say that the check was performed and no update was needed.
- Include the result in your final handoff every time.

## Validation baseline

Use the smallest honest validation set that matches the change:

- UI-only: `npm run lint` and `npm run build`
- backend/shared route changes: `npm run lint`, `npm run build`, plus a relevant manual route sanity check
- migrations: validate logic as far as the environment allows and document assumptions/rollback concerns
- Instagram downloader changes: validate both the Node side and Python side that changed, or state what remains unverified

If you could not run something important, do not hide it.

## Blocker handling

If you hit a blocker:

- describe the blocker concretely
- name the exact file or contract involved
- explain what you already checked
- state the safest next action

Common blockers:

- unrelated dirty work in the same file
- unclear shared contract ownership
- missing credentials or local services required for validation
- migration risk that cannot be validated safely in the current environment

## Commit and push default

When a task is finished and validation has passed:

- commit the scoped repo changes
- push them to `origin`
- prefer landing validated work on `main` unless the user explicitly asks for a different branch or asks you not to push yet
- do not wait for an extra user reminder before committing and pushing when the task is otherwise complete

Do not bundle unrelated dirty-worktree changes into that commit. If unrelated edits block a safe commit or push, keep them out of scope and explain the blocker clearly.

## Handoff template

Use this structure for partial or finished work:

- Scope completed: what you changed
- Validation: what you ran and what passed
- Remaining risk: what still needs checking
- Files intentionally avoided: unrelated or conflicting files you left alone
- Docs/guidance checkpoint: whether docs, `AGENTS.md`, or this guide were updated or confirmed unchanged
- Next recommended step: only when useful

## Definition of done

A task is done only when all of the following are true:

- the requested change is implemented or the blocker is clearly documented
- validation appropriate to the change has been run, or the gap is explicitly called out
- unrelated local work was preserved
- documentation impact was checked
- `AGENTS.md` and this guide were checked for needed updates
- the final handoff is specific enough that another agent can continue without rediscovering context
