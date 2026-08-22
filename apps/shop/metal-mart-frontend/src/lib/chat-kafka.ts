// Server-side only: Kafka producer for the support chat. The browser widget
// posts to /api/chat/messages, and that route publishes straight to the
// support-chat topic; the chat service consumes it and fans out over SSE.
import { Kafka, type Producer } from "kafkajs";

export type ChatMessage = {
  id: string;
  conversationId: string;
  sender: "customer" | "agent" | "bot";
  text: string;
  timestamp: string;
  customerName?: string;
};

const topic = process.env.KAFKA_TOPIC || "support-chat";

// Next.js may re-evaluate modules across dev hot reloads; stash the producer on
// globalThis so every request reuses one broker connection.
const globalForKafka = globalThis as unknown as {
  chatKafkaProducer?: Producer;
  chatKafkaConnect?: Promise<void>;
};

function getProducer(): Producer {
  if (!globalForKafka.chatKafkaProducer) {
    const kafka = new Kafka({
      clientId: "metal-mart-frontend",
      brokers: (process.env.KAFKA_ADDRESS || "localhost:9092").split(","),
    });
    globalForKafka.chatKafkaProducer = kafka.producer();
  }
  return globalForKafka.chatKafkaProducer;
}

export async function produceChatMessage(msg: ChatMessage, baggage?: string): Promise<void> {
  const producer = getProducer();
  // connect() is memoized so concurrent first requests share one handshake.
  if (!globalForKafka.chatKafkaConnect) {
    globalForKafka.chatKafkaConnect = producer.connect();
  }
  await globalForKafka.chatKafkaConnect;

  // The baggage header carries the mirrord session id so a queue-split session
  // routes this message to the right chat-service instance. OTel's kafkajs
  // auto-instrumentation may also inject it; setting it explicitly keeps the
  // routing working when instrumentation is disabled.
  const kafkaHeaders: Record<string, string> = {};
  if (baggage) kafkaHeaders["baggage"] = baggage;
  if (process.env.KAFKA_MSG_AUTHOR) kafkaHeaders["author"] = process.env.KAFKA_MSG_AUTHOR;
  if (process.env.KAFKA_MSG_SOURCE) kafkaHeaders["source"] = process.env.KAFKA_MSG_SOURCE;

  // Keyed by conversation id so all messages of a conversation stay on one
  // partition and arrive in order, matching the chat service's own producer.
  await producer.send({
    topic,
    messages: [{ key: msg.conversationId, value: JSON.stringify(msg), headers: kafkaHeaders }],
  });
}
