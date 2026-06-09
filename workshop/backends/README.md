# Local backends (the thing you steal & edit)

Pick whichever language you already have installed — **mirrord steals at the network layer, so it
doesn't matter that the in-cluster pod runs Node and your laptop runs something else.** Each file
is a tiny `inventory-service` that implements the same contract the storefront UI calls.

## Contract

- `GET /products` → JSON **array** of `{ id, name, description, price_cents, stock, is_new, image_urls? }`
- `GET /health` → `200 ok` (so kube probes the core filter doesn't steal still pass)
- Every response sets **`X-Served-By: <hostname>`** → the storefront banner flips to *your laptop*
- Listens on **:8080**. mirrord maps remote **:80 → local :8080** (`mirrord.json` `port_mapping`),
  so you never need `sudo` to bind 80.

Each file has a **`👇 EDIT ME`** line — change how the product name is rendered, save, refresh your
browser, and watch it change in the cloud-served storefront.

## Run

| Language | Prereq | Command (from this dir) |
|---|---|---|
| **Node** (talks to the real cluster DB) | `node`, then `npm install` in `node/` | `cd node && mirrord exec -f ../mirrord.json -- node server.js` |
| Python | `python3` | `cd python && mirrord exec -f ../mirrord.json -- python3 server.py` |
| Go | `go` | `cd go && mirrord exec -f ../mirrord.json -- go run main.go` |
| Java | JDK 11+ | `cd java && mirrord exec -f ../mirrord.json -- java Server.java` |
| Ruby | `ruby` | `cd ruby && mirrord exec -f ../mirrord.json -- ruby server.rb` |
| .NET | SDK 8 | `cd dotnet && mirrord exec -f ../mirrord.json -- dotnet run` |
| PHP | `php` | `cd php && mirrord exec -f ../mirrord.json -- php -S 0.0.0.0:8080 router.php` |

> **Node is special:** it has no canned data — it runs the real `SELECT … FROM products` against
> Postgres. mirrord injects the pod's `DATABASE_URL` and routes the connection *through the cluster*,
> so it reads the real product table with zero local DB. The other languages serve canned data
> identical to the seed, so the page looks the same until you edit it.

## The config

- **`mirrord.json`** — steals **your** namespace's `inventory-service` backend, filtered to
  `^/products` so health probes stay on the pod. Targets `deployment/inventory-service` in your
  kubeconfig's default namespace (`ws-aNN`). The in-cluster `frontend` pod proxies `/products` to
  this backend, so once you steal it, the frontend's call lands on your laptop.

## Verify without mirrord

Each backend runs standalone for a quick smoke test:

```sh
cd python && python3 server.py &        # or any language
curl -i localhost:8080/products         # expect 200, JSON array, X-Served-By header
curl -s localhost:8080/health           # expect: ok
```
