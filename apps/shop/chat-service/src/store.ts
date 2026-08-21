import type { Response } from "express";

export type Sender = "customer" | "agent" | "bot";

export type ChatMessage = {
  id: string;
  conversationId: string;
  sender: Sender;
  text: string;
  timestamp: string;
  customerName?: string;
};

export type Conversation = {
  conversationId: string;
  customerName?: string;
  messages: ChatMessage[];
};

export type ConversationSummary = {
  conversationId: string;
  customerName?: string;
  lastMessage: string;
  lastTimestamp: string;
  messageCount: number;
};

// The Kafka topic is the source of truth: only the consumer writes here, so a
// mirrord queue-split local instance builds the same (filtered) state.
const conversations = new Map<string, Conversation>();
// Message ids already applied, so topic replays (fromBeginning, rebalances)
// are idempotent.
const seenIds = new Set<string>();

const conversationSubscribers = new Map<string, Set<Response>>();
const firehoseSubscribers = new Set<Response>();

export function addMessage(msg: ChatMessage): boolean {
  if (seenIds.has(msg.id)) return false;
  seenIds.add(msg.id);
  let convo = conversations.get(msg.conversationId);
  if (!convo) {
    convo = { conversationId: msg.conversationId, messages: [] };
    conversations.set(msg.conversationId, convo);
  }
  if (msg.customerName && !convo.customerName) {
    convo.customerName = msg.customerName;
  }
  convo.messages.push(msg);
  return true;
}

export function getConversation(id: string): Conversation | undefined {
  return conversations.get(id);
}

/** True when no agent or bot has spoken yet — the bot greets only then. */
export function awaitingFirstResponse(conversationId: string): boolean {
  const convo = conversations.get(conversationId);
  if (!convo) return false;
  return convo.messages.every((m) => m.sender === "customer");
}

export function listConversations(): ConversationSummary[] {
  return [...conversations.values()]
    .map((c) => {
      const last = c.messages[c.messages.length - 1];
      return {
        conversationId: c.conversationId,
        customerName: c.customerName,
        lastMessage: last?.text ?? "",
        lastTimestamp: last?.timestamp ?? "",
        messageCount: c.messages.length,
      };
    })
    .sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp));
}

export function sendEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function subscribeConversation(conversationId: string, res: Response): void {
  let subs = conversationSubscribers.get(conversationId);
  if (!subs) {
    subs = new Set();
    conversationSubscribers.set(conversationId, subs);
  }
  subs.add(res);
}

export function unsubscribeConversation(conversationId: string, res: Response): void {
  conversationSubscribers.get(conversationId)?.delete(res);
}

export function subscribeFirehose(res: Response): void {
  firehoseSubscribers.add(res);
}

export function unsubscribeFirehose(res: Response): void {
  firehoseSubscribers.delete(res);
}

export function broadcast(msg: ChatMessage): void {
  for (const res of conversationSubscribers.get(msg.conversationId) ?? []) {
    sendEvent(res, "message", msg);
  }
  for (const res of firehoseSubscribers) {
    sendEvent(res, "message", msg);
  }
}
