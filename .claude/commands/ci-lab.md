---
description: Open a ci-lab pull request that Test A and Test B can show
---

Create one pull request in `/Users/adna/Desktop/playground` only. Never push or open a pull request in the operator repo.

Fetch `origin` and branch from `origin/main`. If the playground worktree has other uncommitted changes, stop. Do not mix those in.

Stamp the branch `adna/ci-lab-demo-YYYYMMDD-HHMM` with the local date and time. Use that same stamp in the three strings below. Replace only the assigned string.

In `apps/ci-lab/account-srvc/src/main/java/account/Main.java`:

```java
static final String BADGE = "demo-YYYYMMDD-HHMM";
```

In `apps/ci-lab/login-app/src/App.jsx`:

```jsx
<h1>Account portal demo-YYYYMMDD-HHMM</h1>
```

In `apps/ci-lab/auth-srvc/src/main/java/auth/Main.java`:

```java
static final String MESSAGE = "authenticated by demo-YYYYMMDD-HHMM";
```

Commit those three files with `Show the ci-lab pull-request build in both checks.` Push to `origin` and open a pull request against `main`. Title: `ci-lab demo YYYYMMDD-HHMM`.

Test A prints `badge=demo-YYYYMMDD-HHMM`. Test B shows the new heading, and after sign-in shows `authenticated by demo-YYYYMMDD-HHMM`.

Return the pull request URL. Do not print `MIRRORD_CI_API_KEY` and do not stage `.env.local`.
