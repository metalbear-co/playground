## Visualization Backend

Lightweight Node.js service that exposes cluster state to the React Flow visualization.

When running inside the cluster it keeps the snapshot in sync by polling Deployments such as `ip-visit-counter` and `mirrord-operator`. Outside of the cluster you can still `POST /snapshot` to mock data.

### Environment

- `PORT` (default `8080`)
- `CLUSTER_NAME` (default `playground`)
- `WATCH_NAMESPACE` (default `default`) – namespace used for most deployments
- `WATCH_INTERVAL_MS` (default `10000`)

### Available scripts

```bash
npm run dev    # ts-node-dev watcher
npm run build  # compile to dist/
npm start      # run compiled output
```

### API

- `GET /healthz` – returns `{ "status": "ok" }`.
- `GET /snapshot` – returns the current cluster snapshot:

```json
{
  "clusterName": "playground",
  "updatedAt": "2024-07-01T12:00:00.000Z",
  "services": [
    {
      "id": "ip-visit-counter",
      "name": "ip-visit-counter",
      "description": "Counts visits",
      "lastUpdated": "2024-07-01T12:00:00.000Z",
      "status": "available",
      "availableReplicas": 1
    }
  ]
}
```

- `POST /snapshot` – replace snapshot with payload `{ clusterName?: string, services?: ServiceStatus[] }`.

Future work: hook this up to an in-cluster watcher that publishes actual mirrord session events.
