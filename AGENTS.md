# Agent Workflow

This repository is the web app/backend repo for LifeOS and is connected to:

- `origin`: `https://github.com/stferdi20/lifeos-newarchitecture`

## Required workflow for coding agents

- If you change tracked files in this repo, do not stop at local edits only.
- After verifying the change, commit the relevant repo changes and push them to `origin`, unless the user explicitly says not to push yet.
- Do not ask the user to manually run terminal commands for normal git push steps when you can perform them directly.
- Keep commits scoped to the feature or fix you are making. Avoid bundling unrelated dirty-worktree changes into the same commit.
- Never revert or overwrite unrelated local changes you did not make.

## Scope note

- This repo covers the web app and backend.
- The native menubar app in the sibling `lifeos-menubar` folder is not part of this git repo unless the user moves it into version control separately.
