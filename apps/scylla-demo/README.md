# ScyllaDB DB branch demo

Shows a ScyllaDB database branched with mirrord. ScyllaDB has no first-class mirrord engine, so
this uses a `generic` branch: a throwaway one-node Scylla pod, filled by a `cqlsh` copy Job.

Everything runs in the `scylla-demo` namespace. No Argo CD Application points at this demo, so
it only exists after you deploy it, and other demos do not depend on it.

| Path | What it is |
|---|---|
| `manifests/scylla-demo/scylla-demo.yaml` | Source Scylla, seed Job, and target workload |
| `apps/scylla-demo/scylla-branch.json` | The mirrord config |
| `apps/scylla-demo/demo.mjs` | Small client that runs under mirrord |
| `apps/scylla-demo/local-test.sh` | Tests the Scylla flags and copy script on local Docker |

## Deploy and seed

From the repo root:

```bash
kubectl apply -f manifests/scylla-demo/
```

To wait until the seed data is in:

```bash
kubectl -n scylla-demo wait job/scylla-seed --for=condition=complete --timeout=300s
```

The source keeps its data on the pod, so a pod restart empties it. Run `kubectl apply` again to
seed it again. The seed Job deletes itself 5 minutes after it finishes.

The data is keyspace `metalmart`, with 4 rows in `products` and 2 rows in `orders_by_customer`.

## Run the demo

```bash
cd apps/scylla-demo
npm install

# The branch boots, the Job copies schema and rows, and the app reads the copy.
mirrord exec -f scylla-branch.json -- node demo.mjs list

# Add a row, then delete everything. Both change the branch only.
mirrord exec -f scylla-branch.json -- node demo.mjs add
mirrord exec -f scylla-branch.json -- node demo.mjs wipe

# The source still has its 4 products.
kubectl -n scylla-demo exec scylla-source-0 -- cqlsh -e "SELECT sku FROM metalmart.products"

# The branch is visible while it lives.
mirrord db-branches -n scylla-demo status
```

The branch stays for 15 minutes after the last session. A run inside that window reuses it and
skips the copy. To get a fresh copy, run `mirrord db-branches -n scylla-demo stop --all`.

## How the config works

- `connection.params` names the env vars on the target that hold the source's address. mirrord
  rewrites only `host` and `port` for the local app. `keyspace` and `dc` keep their values.
- `profile: scylla` selects the operator profile in
  `overlays/gke/mirrord-operator-application.yaml`, which allows the image and sets memory.
- `--dc` gives the branch the app's datacenter name, because drivers that pin a local datacenter
  find no nodes otherwise.
- `--reserve-memory` is required. Scylla reserves about 1.5GiB by default, which leaves no room
  for `--memory 1G` under a 2Gi limit.
- `--io-setup 0` skips the disk benchmark at boot.
- The copy script sets replication to RF=1, because a branch has one node.

## Test without a cluster

```bash
./apps/scylla-demo/local-test.sh
```

This boots two Scylla containers, seeds one, runs the real copy script, and runs `demo.mjs`
against the copy. It does not exercise the operator.

## Using this on a real Scylla

- Set `image` and `copy.image` to the source's Scylla version.
- Add `"user": "SCYLLA_USER"` and `"password": "SCYLLA_PASSWORD"` to `connection.params`. The copy
  Job uses them to read the source. The branch has no auth, so the app's credentials still work.
- Map `host`, `port`, `keyspace`, and `dc` to the app's real env var names.
- `cqlsh COPY` suits small keyspaces only. Counter tables and very large tables need a dedicated
  copy image.
- A source that requires TLS needs `--ssl` on the `src` calls in the copy script.

## Clean up

```bash
kubectl delete namespace scylla-demo
```
