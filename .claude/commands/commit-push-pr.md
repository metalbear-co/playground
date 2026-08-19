Take all current changes, create a new branch, commit, push, and open a PR.

1. Review all staged and unstaged changes with `git status` and `git diff`.
2. Create a new descriptive branch name based on the changes (e.g., `feat/add-login-page`, `fix/null-pointer-in-parser`).
3. Switch to that new branch.
4. Stage all relevant changed files (avoid secrets or generated files).
5. Create a commit with a concise, descriptive message summarizing the changes.
6. Push the branch to origin with `--set-upstream`.
7. Open a pull request using `gh pr create` targeting the main branch, with a clear title and summary of the changes.
8. Return the PR URL when done.
