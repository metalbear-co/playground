import { randomUUID } from "node:crypto";
import express from "express";
import { Kafka } from "kafkajs";
import { range } from "./range_assigner.js";
import {
  addMessage,
  awaitingFirstResponse,
  broadcast,
  broadcastDeleted,
  deleteConversation,
  getConversation,
  listConversations,
  sendEvent,
  subscribeConversation,
  subscribeFirehose,
  unsubscribeConversation,
  unsubscribeFirehose,
  type ChatMessage,
  type Sender,
} from "./store.js";

const app = express();
const port = parseInt(process.env.PORT || "80", 10);

const topic = process.env.KAFKA_TOPIC || "support-chat";
const BOT_REPLY = "Thanks for reaching out — a support agent will be with you shortly.";
const SENDERS: Sender[] = ["customer", "agent", "bot"];
const HEARTBEAT_MS = 15000;

const kafka = new Kafka({
  clientId: "chat-service",
  brokers: (process.env.KAFKA_ADDRESS || "localhost:9092").split(","),
});
const producer = kafka.producer();

async function produceMessage(msg: ChatMessage, baggage?: string): Promise<void> {
  const kafkaHeaders: Record<string, string> = {};
  if (baggage) kafkaHeaders["baggage"] = baggage;
  if (process.env.KAFKA_MSG_AUTHOR) kafkaHeaders["author"] = process.env.KAFKA_MSG_AUTHOR;
  if (process.env.KAFKA_MSG_SOURCE) kafkaHeaders["source"] = process.env.KAFKA_MSG_SOURCE;

  await producer.send({
    topic,
    messages: [{ key: msg.conversationId, value: JSON.stringify(msg), headers: kafkaHeaders }],
  });
}

// Idempotent: createTopics is a no-op when the topic already exists. Keeps the
// service working even against brokers with topic auto-creation disabled.
async function ensureTopic() {
  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.createTopics({ topics: [{ topic }] });
  } finally {
    await admin.disconnect();
  }
}

async function startConsumer() {
  const consumer = kafka.consumer({
    groupId: process.env.KAFKA_CONSUMER_GROUP || "chat-service",
    partitionAssigners: [range],
    sessionTimeout: 30000,
    rebalanceTimeout: 60000,
    heartbeatInterval: 10000,
    maxWaitTimeInMs: 5000,
    retry: {
      retries: 10,
      initialRetryTime: 300,
    },
  });
  await consumer.connect();
  // The in-memory store is rebuilt from the topic, so a fresh consumer group
  // replays history; seen-id dedupe in the store makes replays harmless.
  await consumer.subscribe({ topic, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ topic: t, partition, message }) => {
      try {
        const msg = JSON.parse(message.value?.toString() || "{}") as ChatMessage;
        if (!msg.id || !msg.conversationId || !SENDERS.includes(msg.sender)) {
          console.warn(`[${t}] Skipping malformed message at offset ${message.offset}`);
          return;
        }
        console.log(`[${t}] ${msg.sender} message in ${msg.conversationId}`, {
          partition,
          offset: message.offset,
        });

        if (!addMessage(msg)) return; // already seen (replay)
        broadcast(msg);

        // Canned greeting on the first customer message. The baggage header is
        // copied from the consumed message so that during a mirrord queue-split
        // session the bot reply routes back to the same (local) instance.
        if (msg.sender === "customer" && awaitingFirstResponse(msg.conversationId)) {
          const baggage = message.headers?.["baggage"]?.toString();
          await produceMessage(
            {
              id: randomUUID(),
              conversationId: msg.conversationId,
              sender: "bot",
              text: BOT_REPLY,
              timestamp: new Date().toISOString(),
            },
            baggage
          );
        }
      } catch (err) {
        console.error("Error processing message:", err);
      }
    },
  });
}

app.use(express.json());

app.use((req, res, next) => {
  if (req.path !== "/health") {
    console.log(`${req.method} ${req.path}`);
  }
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/messages", async (req, res) => {
  const { conversationId, sender, text, customerName } = req.body ?? {};
  if (!conversationId || typeof conversationId !== "string") {
    return res.status(400).json({ error: "conversationId is required" });
  }
  if (!SENDERS.includes(sender)) {
    return res.status(400).json({ error: "sender must be one of customer, agent, bot" });
  }
  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  const msg: ChatMessage = {
    id: randomUUID(),
    conversationId,
    sender,
    text: text.trim(),
    timestamp: new Date().toISOString(),
    ...(customerName ? { customerName } : {}),
  };

  try {
    const baggage = req.headers["baggage"] as string | undefined;
    await produceMessage(msg, baggage);
    res.status(202).json({ id: msg.id });
  } catch (err) {
    console.error("Error producing message:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/conversations", (_req, res) => {
  res.json(listConversations());
});

app.get("/conversations/:id/messages", (req, res) => {
  const convo = getConversation(req.params.id);
  res.json(convo?.messages ?? []);
});

app.delete("/conversations/:id", (req, res) => {
  if (!deleteConversation(req.params.id)) {
    return res.status(404).json({ error: "conversation not found" });
  }
  broadcastDeleted(req.params.id);
  res.status(204).end();
});

function openSseStream(res: express.Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    // no-transform keeps compression middleware from buffering the stream
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
}

app.get("/conversations/:id/events", (req, res) => {
  const conversationId = req.params.id;
  openSseStream(res);
  sendEvent(res, "snapshot", getConversation(conversationId)?.messages ?? []);
  subscribeConversation(conversationId, res);
  const heartbeat = setInterval(() => res.write(":ka\n\n"), HEARTBEAT_MS);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribeConversation(conversationId, res);
  });
});

app.get("/events", (req, res) => {
  openSseStream(res);
  sendEvent(res, "snapshot", listConversations());
  subscribeFirehose(res);
  const heartbeat = setInterval(() => res.write(":ka\n\n"), HEARTBEAT_MS);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribeFirehose(res);
  });
});

async function main() {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Chat service listening on port ${port}`);
  });
  await ensureTopic();
  await producer.connect();
  await startConsumer();
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
