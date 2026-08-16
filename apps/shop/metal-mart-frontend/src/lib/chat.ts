export type ChatSender = "customer" | "agent" | "bot";

export type ChatMessage = {
  id: string;
  conversationId: string;
  sender: ChatSender;
  text: string;
  timestamp: string;
  customerName?: string;
};

export type ConversationSummary = {
  conversationId: string;
  customerName?: string;
  lastMessage: string;
  lastTimestamp: string;
  messageCount: number;
};

/** Appends a message unless one with the same id is already present. */
export function appendMessage(messages: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  if (messages.some((m) => m.id === msg.id)) return messages;
  return [...messages, msg];
}
