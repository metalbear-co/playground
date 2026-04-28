# AGENTS - Mirrord Testing Contract

> [!WARNING]
> ATTENTION: AI-driven runtime testing in this repository MUST use `mirrord`.
> Agents MUST use repository helper scripts and MUST validate Kubernetes target access before starting test traffic.
> Agents MUST NEVER hard-code remote hostnames, credentials, or secret values in commands, scripts, or docs.

## Mandatory Rules

- Agents MUST run shop order-service testing through `scripts/mirrord-order-service.sh`.
- Agents MUST use `.mirrord/mirrord-order-service.json` for target and network mode.
- Agents MUST verify success by behavior, not by guessing infrastructure details.
- Agents MUST confirm `mirrord` and `kubectl` availability before executing tests.
- Agents MUST NEVER print secret environment variable values to terminal output.

## Service Overview

| Service | Runtime | Kubernetes Target | Namespace | Network Mode | Verification |
|---|---|---|---|---|---|
| `order-service` | TypeScript + Express | `deployment/order-service` | `shop` | `steal` | HTTP behavior: ordering endpoint returns `201` on `POST /orders` |

## Required Workflow

1. Run `scripts/mirrord-order-service.sh -- <local command...>`.
2. Use an HTTP order creation request and verify the response status is `201`.
3. If background mode is used, stop the session with `scripts/mirrord-order-service.sh --stop`.

## Artifacts

- Mirrord config: `.mirrord/mirrord-order-service.json`
- Helper script: `scripts/mirrord-order-service.sh`
- Existing order-service configs retained:
  - `.mirrord/mirrord-order.json`
  - `.mirrord/mirrord-ci-shop.json`
  - `.mirrord/db.json`

## Troubleshooting

- If `mirrord` is missing, install it via your approved local process before running tests.
- If `kubectl` has no context, authenticate to the correct cluster and retry.
- If target lookup fails, confirm `deployment/order-service` exists in namespace `shop`.
- If order verification fails, inspect local app logs and confirm request shape for `POST /orders`.
