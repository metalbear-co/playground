## Shop Visualization Backend

Lightweight Node.js service that exposes cluster state to the React Flow visualization of the Metal Mart shop architecture.

When running inside the cluster it keeps the snapshot in sync by polling Deployments such as `order-service`, `inventory-service`, `delivery-service`, `payment-service`, `metal-mart-frontend`, and `mirrord-operator`. Outside of the cluster you can still `POST /snapshot` to mock data.

### Environment

- `PORT` (default `8080`)
- `CLUSTER_NAME` (default `playground`)
- `WATCH_NAMESPACE` (default `shop`) -- namespace used for most deployments
- `WATCH_INTERVAL_MS` (default `10000`)

### Available scripts

```bash
npm run dev    # ts-node-dev watcher
npm run build  # compile to dist/
npm start      # run compiled output
```

### API

- `GET /healthz` -- returns `{ "status": "ok" }`.
- `GET /snapshot` -- returns the current cluster snapshot:

```json
{
  "clusterName": "playground",
  "updatedAt": "2024-07-01T12:00:00.000Z",
  "services": [
    {
      "id": "order-service",
      "name": "order-service",
      "description": "Order orchestration",
      "lastUpdated": "2024-07-01T12:00:00.000Z",
      "status": "available",
      "availableReplicas": 1
    }
  ]
}
```

- `POST /snapshot` -- replace snapshot with payload `{ clusterName?: string, services?: ServiceStatus[] }`.
