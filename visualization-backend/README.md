## Visualization Backend

Lightweight Node.js service that exposes cluster state to the React Flow visualization.

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
      "lastUpdated": "2024-07-01T12:00:00.000Z"
    }
  ]
}
```

- `POST /snapshot` – replace snapshot with payload `{ clusterName?: string, services?: ServiceStatus[] }`.

Future work: hook this up to an in-cluster watcher that publishes actual mirrord session events.
