import { randomUUID } from "node:crypto";
import { produceChatMessage, type ChatMessage } from "@/lib/chat-kafka";

const SENDERS = ["customer", "agent", "bot"] as const;

// Publishes directly to the support-chat Kafka topic; the chat service
// consumes from it and fans the message out to SSE subscribers. Validation
// mirrors the chat service's POST /messages endpoint so both entry points
// accept the same payloads.
export async function POST(req: Request) {
  const body = await req.json();
  const { conversationId, sender, text, customerName } = body ?? {};
  if (!conversationId || typeof conversationId !== "string") {
    return Response.json({ error: "conversationId is required" }, { status: 400 });
  }
  if (!SENDERS.includes(sender)) {
    return Response.json({ error: "sender must be one of customer, agent, bot" }, { status: 400 });
  }
  if (!text || typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "text is required" }, { status: 400 });
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
    const baggage = req.headers.get("baggage") ?? undefined;
    await produceChatMessage(msg, baggage);
    return Response.json({ id: msg.id }, { status: 202 });
  } catch (err) {
    console.error("Error producing chat message:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
