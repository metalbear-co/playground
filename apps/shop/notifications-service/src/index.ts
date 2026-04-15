import express from "express";
import amqp from "amqplib";

const app = express();
const port = parseInt(process.env.PORT || "80", 10);

const rabbitUrl = process.env.RABBITMQ_URL?.trim() || "";
const queueName = process.env.RABBITMQ_QUEUE?.trim() || "order-notifications";

app.use(express.json());

app.use((req, _res, next) => {
  if (req.path !== "/health" && !req.path.startsWith("/visualization-shop")) {
    console.log(
      "[Notifications] %s %s headers: %s",
      req.method,
      req.path,
      JSON.stringify(req.headers, null, 2)
    );
  }
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", rabbit: Boolean(rabbitUrl), queue: queueName });
});

async function consumeLoop(): Promise<void> {
  console.log(
    "[Notifications] Connecting to RabbitMQ, queue:",
    queueName,
    "url set:",
    Boolean(rabbitUrl)
  );
  const conn = await amqp.connect(rabbitUrl);
  conn.on("error", (err) => console.error("[Notifications] AMQP connection error:", err));
  const ch = await conn.createChannel();
  await ch.assertQueue(queueName, { durable: true });
  ch.prefetch(1);
  await ch.consume(
    queueName,
    (msg) => {
      if (!msg) return;
      const raw = msg.content.toString("utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
      console.log(
        "[Notifications] Received message:",
        JSON.stringify(
          {
            fields: msg.fields,
            properties: msg.properties,
            body: parsed,
          },
          null,
          2
        )
      );
      ch.ack(msg);
    },
    { noAck: false }
  );
  console.log("[Notifications] Consumer started, waiting for messages…");
}

app.listen(port, "0.0.0.0", () => {
  console.log(`[Notifications] HTTP listening on port ${port}`);
});

if (rabbitUrl) {
  consumeLoop().catch((err) => {
    console.error("[Notifications] Fatal RabbitMQ consumer error:", err);
    process.exit(1);
  });
} else {
  console.warn(
    "[Notifications] RABBITMQ_URL not set — RabbitMQ consumer disabled (HTTP /health still up)"
  );
}
