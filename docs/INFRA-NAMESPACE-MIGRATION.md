# Migration: Shared infra namespace for Redis, Kafka, Postgres

**Goal:** Move Redis, Kafka, and Postgres from app-specific namespaces (ip-visit-counter, shop) into a dedicated **`infra`** namespace and have all apps reference this shared infrastructure.

---

## Current state

| Component | Location | Consumers |
|-----------|----------|-----------|
| **Redis** | `manifests/ip-visit/base/infra/redis` → namespace `ip-visit-counter` | ip-visit counter |
| **Kafka** | `manifests/ip-visit/base/infra/kafka` → `ip-visit-counter` | ip-visit counter, consumer-kafka |
| **Kafka** | `manifests/shop/base/infra/kafka` → `shop` | shop (order, delivery, etc.) |
| **Postgres** | `manifests/shop/base/infra/postgres` → `shop` | shop (inventory, order, payment, delivery) |

- **`manifests/infrastructure`** today only defines **namespaces** (ip-visit-counter, shop, visualization) and is deployed by the Argo CD Application **shared-infra** (destination namespace in that app is `default`; only cluster-scoped namespaces are in that kustomization).
- Apps use short DNS names: `redis-main:6379`, `kafka:9092`, `postgres:5432` (same-namespace resolution).

---

## Target state

| Component | Location | Namespace | Consumers |
|-----------|----------|-----------|-----------|
| **Redis** | `manifests/infrastructure/redis/` | `infra` | ip-visit (counter) |
| **Kafka** | `manifests/infrastructure/kafka/` | `infra` | ip-visit + shop |
| **Postgres** | `manifests/infrastructure/postgres/` | `infra` | shop |

- **`manifests/infrastructure`** defines the **`infra`** namespace and all shared infra resources (redis, kafka, postgres), with `namespace: infra` so everything lands in `infra`.
- **shared-infra** Argo Application keeps pointing at `manifests/infrastructure`; we change its **destination namespace** to **`infra`** (for the non-namespace resources).
- **ip-visit** and **shop** manifests no longer include any `base/infra/*`; their deployments reference infra via FQDN:
  - `redis-main.infra.svc.cluster.local:6379`
  - `kafka.infra.svc.cluster.local:9092`
  - `postgres.infra.svc.cluster.local:5432`

---

## Migration steps (checklist)

### Phase 1: Add shared infra resources under `manifests/infrastructure`

1. **Add `infra` namespace**  
   In `manifests/infrastructure/namespaces.yaml`, add:
   ```yaml
   ---
   apiVersion: v1
   kind: Namespace
   metadata:
     name: infra
   ```

2. **Create `manifests/infrastructure/redis/`**  
   - Copy from `manifests/ip-visit/base/infra/redis/` (deployment.yaml, svc.yaml, kustomization.yaml).
   - No changes to resource names; service stays `redis-main`. Kustomization will apply `namespace: infra` at the top level.

3. **Create `manifests/infrastructure/kafka/`**  
   - Use one copy (e.g. from `manifests/ip-visit/base/infra/kafka/` or shop) of statefulset + svc + kustomization.
   - In the Kafka StatefulSet, set:
     - `KAFKA_ADVERTISED_LISTENERS`: `PLAINTEXT://kafka.infra.svc.cluster.local:9092`
     - `KAFKA_CONTROLLER_QUORUM_VOTERS`: `1@kafka-0.kafka.infra.svc.cluster.local:9093`
   - Pick one `CLUSTER_ID` (e.g. keep one of the existing values for simplicity).

4. **Create `manifests/infrastructure/postgres/`**  
   - Copy from `manifests/shop/base/infra/postgres/` (configmap, deployment, secret, svc, kustomization).
   - No hostname changes inside Postgres; only the namespace changes.

5. **Update `manifests/infrastructure/kustomization.yaml`**  
   - Set `namespace: infra` so all resources go to the infra namespace.
   - Add resources:
     ```yaml
     namespace: infra
     resources:
       - namespaces.yaml
       - redis
       - kafka
       - postgres
     ```
   - Note: `namespaces.yaml` defines cluster-scoped Namespace objects; they are not namespaced, so the `namespace: infra` only applies to redis/kafka/postgres.

6. **Update Argo CD shared-infra Application**  
   In `overlays/gke/shared-infra-application.yaml`, set:
   ```yaml
   spec:
     destination:
       namespace: infra
       server: https://kubernetes.default.svc
   ```
   So that the kustomize output (redis, kafka, postgres) is applied to the `infra` namespace. (Namespace resources in namespaces.yaml are cluster-scoped and ignore destination namespace.)

---

### Phase 2: Point apps at shared infra (FQDN)

7. **ip-visit – remove local infra, use FQDN**  
   - In `manifests/ip-visit/kustomization.yaml`: remove `./base/infra/kafka` and `./base/infra/redis` from `resources`.
   - In `manifests/ip-visit/base/app/counter/deployment.yaml`:
     - `REDISADDRESS`: `redis-main.infra.svc.cluster.local:6379`
     - `KAFKAADDRESS`: `kafka.infra.svc.cluster.local:9092`
   - In `manifests/ip-visit/base/app/consumer-kafka/deployment.yaml`:
     - `KAFKAADDRESS`: `kafka.infra.svc.cluster.local:9092`

8. **shop – remove local infra, use FQDN**  
   - In `manifests/shop/kustomization.yaml`: remove `./base/infra/postgres` and `./base/infra/kafka` from `resources`.
   - In `manifests/shop/base/app/inventory-service/deployment.yaml`:  
     Postgres URL → `postgresql://postgres:postgres@postgres.infra.svc.cluster.local:5432/inventory`
   - In `manifests/shop/base/app/order-service/deployment.yaml`:  
     Postgres URL → `postgresql://postgres:postgres@postgres.infra.svc.cluster.local:5432/orders`  
     Kafka → `KAFKA_ADDRESS`: `kafka.infra.svc.cluster.local:9092`
   - In `manifests/shop/base/app/delivery-service/deployment.yaml`:  
     Postgres URL → `postgresql://postgres:postgres@postgres.infra.svc.cluster.local:5432/deliveries`  
     Kafka → `KAFKA_ADDRESS`: `kafka.infra.svc.cluster.local:9092`
   - In `manifests/shop/base/app/payment-service/deployment.yaml`: if it uses Postgres, update similarly.

9. **shop-mirrord**  
   In `manifests/shop-mirrord/kafka-client-config.yaml`, set the broker to:
   `kafka.infra.svc.cluster.local:9092` (replace `kafka.shop.svc.cluster.local:9092`).

---

### Phase 3: Remove old per-app infra (optional cleanup)

10. **Delete obsolete manifest directories** (after migration is verified on a cluster):
    - `manifests/ip-visit/base/infra/` (redis + kafka)
    - `manifests/shop/base/infra/` (kafka + postgres)

---

## Deployment order and Argo CD

- **shared-infra** should be deployed (or synced) **before** ip-visit and shop, so that the `infra` namespace and Redis/Kafka/Postgres exist when app pods start.
- Options:
  - **Manual / documented:** Ensure `kubectl apply -k overlays/gke` (or Argo sync of the bootstrap app) runs first, then sync shared-infra before or with the app apps.
  - **Sync waves (optional):** In the root GKE kustomization, you can’t easily order Argo Applications; ordering is usually done via an App-of-Apps with sync waves or by having shared-infra as a dependency. For simplicity, document that shared-infra is synced first, or use Argo’s “Sync waves” on the shared-infra Application (e.g. wave `-1`) so it syncs before apps that depend on it (if your Argo set-up supports it).

---

## Rollback

- Revert manifest changes (restore infra under ip-visit and shop, revert FQDNs to short names).
- Revert `overlays/gke/shared-infra-application.yaml` destination namespace if needed.
- Optionally delete the `infra` namespace and PVCs in `infra` if you recreated infra in app namespaces.

---

## Data / runtime considerations

- **Kafka:** One shared cluster. Existing topics from ip-visit and shop will not exist on the new cluster; any persistent data in the old per-namespace Kafka PVCs is separate. For a demo/playground this is usually acceptable (apps recreate topics or handle empty state).
- **Redis:** ip-visit counter state will start empty on the new Redis instance.
- **Postgres:** New instance in `infra` will run init scripts (inventory, orders, deliveries). Any data in the current shop Postgres is in the old `shop` namespace PVCs; not migrated automatically.

If you need to preserve data, you would plan a one-off migration (e.g. dump/restore Postgres, or accept Redis/Kafka as ephemeral for this cutover).

---

## Summary

| Action | Where |
|--------|--------|
| Add `infra` namespace | `manifests/infrastructure/namespaces.yaml` |
| Add redis, kafka, postgres | New dirs under `manifests/infrastructure/`, kustomization points to them + `namespace: infra` |
| shared-infra destination | `overlays/gke/shared-infra-application.yaml` → `namespace: infra` |
| ip-visit | Remove base/infra refs; counter + consumer-kafka use `*.infra.svc.cluster.local` |
| shop | Remove base/infra refs; all DB/Kafka URLs use `*.infra.svc.cluster.local` |
| shop-mirrord | Kafka broker → `kafka.infra.svc.cluster.local:9092` |
| Cleanup (optional) | Remove `manifests/ip-visit/base/infra/`, `manifests/shop/base/infra/` |

After this, all shared infrastructure lives in the **infra** namespace and is reused by ip-visit and shop.
