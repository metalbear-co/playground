import express from "express";
import cors from "cors";

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

type ServiceStatus = {
  id: string;
  name: string;
  description: string;
  lastUpdated: string;
};

type ClusterSnapshot = {
  clusterName: string;
  updatedAt: string;
  services: ServiceStatus[];
};

let snapshot: ClusterSnapshot = {
  clusterName: process.env.CLUSTER_NAME || "playground",
  updatedAt: new Date().toISOString(),
  services: [],
};

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/snapshot", (_req, res) => {
  res.json(snapshot);
});

app.post("/snapshot", (req, res) => {
  const body = req.body as Partial<ClusterSnapshot>;
  snapshot = {
    clusterName: body.clusterName ?? snapshot.clusterName,
    updatedAt: new Date().toISOString(),
    services: body.services ?? snapshot.services,
  };
  res.json(snapshot);
});

app.listen(port, () => {
  console.log(`Visualization backend listening on port ${port}`);
});
