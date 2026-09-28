# ci-lab

A pull request runs a functional test against the changed service with mirrord. The pull-request build is not deployed. `profile-srvc`, Postgres, and the services the pull request did not change stay in the `ci-lab` namespace.

GitHub Actions is the runner in this repo. The commands in [`.github/workflows/ci-lab.yaml`](../../.github/workflows/ci-lab.yaml) are the body of a Tekton task. A task that already runs inside the cluster can call Service DNS and skip the port-forwards these scripts use.

`mirrord ci start` is `mirrord exec` in the background. The test runs next. `mirrord ci stop` runs when the script exits.

## One-time baseline

Merging to `main` is what provisions it, the same way the other playground apps work. The image workflows push to `ghcr.io`, and the `ci-lab` Argo CD app syncs itself into the `ci-lab` namespace. A later pull request does not deploy the service it changes.

The namespace needs:

- `profile-srvc` and Postgres, for test A
- `account-srvc`, `auth-srvc`, and `login-app` as well, for test B

Test A does not deploy `account-srvc`. The jar under test is the one the check just built. The deployed `account-srvc` is only there so a login-app or auth pull request can fetch an account.

The check uses the same secrets as `ci-demo-mirrord-vs-baseline.yml` and `ci-demo-shop-mirrord-vs-baseline.yml`: `KUBECONFIG_BASE64` and `MIRRORD_CI_API_KEY`. Nothing new to add.

## What to change so the audience can see it

Test A: in `apps/ci-lab/account-srvc/src/main/java/account/Main.java`, change `BADGE` from `staging` to something else. The test prints that value.

Login app: any visible change in `apps/ci-lab/login-app/src/App.jsx`. The browser is showing that React page.

Auth: in `apps/ci-lab/auth-srvc/src/main/java/auth/Main.java`, change `MESSAGE`. After Sign in, the page prints that sentence.

## Show it on a pull request

Open the pull request, then open the `ci-lab` check.

| Files in the diff | Check that runs |
| --- | --- |
| `apps/ci-lab/account-srvc/**` | TestNG and RestAssured. `GET /v2/account` on the jar the check started. The log shows the JSON, including `tier` and `office` from `profile-srvc`, and the Postgres row (`fetched_by=pull-request`). |
| `apps/ci-lab/login-app/**` | Playwright. It fetches the account from the deployed `account-srvc`, then signs in through the pull-request React app. mirrord is attached to the Node server. The login call goes out through the agent to the deployed `auth-srvc`. |
| `apps/ci-lab/auth-srvc/**` | The same Playwright test. The browser opens the login app already in the cluster. Only the login request carrying `x-mirrord-session` is stolen to the pull-request auth jar. |

The first pull request that adds this directory changes all three paths, so the check tries all three scenarios. It stays red until the baseline above is synced. The demo pull request should touch one service, so one scenario runs and the log is the thing on screen.

## Show it live, same scripts

From a laptop that can `kubectl` to the cluster, with `profile-srvc` and Postgres already up:

```bash
./apps/ci-lab/run-a.sh
```

Login app, with the browser visible:

```bash
HEADED=1 ./apps/ci-lab/run-b-login.sh
```

Auth, browser on the staging portal:

```bash
HEADED=1 ./apps/ci-lab/run-b-auth.sh
```

`HEADED=1` is for the call. The pull-request check leaves Playwright headless.
