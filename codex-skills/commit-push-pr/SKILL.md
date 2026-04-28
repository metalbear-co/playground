---
name: commit-push-pr
description: Use when the user explicitly wants the current local git changes reviewed, committed on a new branch, pushed to origin, and opened as a pull request.
---

# Commit Push PR

Use this skill only when the user wants the current local changes turned into a branch and PR.

## Workflow

1. Review both staged and unstaged changes with `git status` and `git diff`.
2. Create a descriptive branch name based on the actual change.
3. Switch to the new branch.
4. Stage the relevant files. Avoid secrets, generated artifacts, and unrelated changes.
5. Create a concise commit message that matches the change.
6. Push with upstream tracking.
7. Open a pull request against `main` with a clear title and summary.
8. Return the PR URL.

## Guardrails

- Do not revert unrelated local changes.
- If the worktree is already on a feature branch, decide whether reusing it is safer than branching again.
- Prefer `gh pr create` when available.
- If PR creation cannot be completed because auth is missing, stop with the exact blocker.
