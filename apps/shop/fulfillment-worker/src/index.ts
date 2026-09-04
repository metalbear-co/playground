import { fileURLToPath } from "node:url";
import express from "express";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.js";
import { getFulfillment } from "./store.js";

const port = parseInt(process.env.PORT || "80", 10);
const temporalAddress = process.env.TEMPORAL_ADDRESS || "localhost:7233";
const temporalNamespace = process.env.TEMPORAL_NAMESPACE || "default";
const taskQueue = process.env.TEMPORAL_TASK_QUEUE || "order-fulfillment";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    temporal: temporalAddress,
    namespace: temporalNamespace,
    taskQueue,
  });
});

app.get("/fulfillments/order/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid order ID" });
  const row = getFulfillment(id);
  if (!row) return res.status(404).json({ error: "Fulfillment not found" });
  res.json(row);
});

async function startWorker(): Promise<void> {
  // Operator Temporal proxy (mirrord split) rejects gzip; real frontend accepts none.
  const connection = await NativeConnection.connect({
    address: temporalAddress,
    grpcCompression: { codec: "none" },
  });
  const workflowsFile = process.env.NODE_ENV === "production" ? "./workflows.js" : "./workflows.ts";
  const worker = await Worker.create({
    connection,
    namespace: temporalNamespace,
    taskQueue,
    workflowsPath: fileURLToPath(new URL(workflowsFile, import.meta.url)),
    activities,
  });
  console.log(
    "[Fulfillment] worker polling %s on %s (namespace=%s)",
    taskQueue,
    temporalAddress,
    temporalNamespace
  );
  await worker.run();
}

async function main(): Promise<void> {
  app.listen(port, "0.0.0.0", () => {
    console.log("[Fulfillment] Listening on port %d", port);
  });
  await startWorker();
}

main().catch((err) => {
  console.error("Failed to start fulfillment-worker:", err);
  process.exit(1);
});
