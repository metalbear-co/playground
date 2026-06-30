/** Minimal A2A-style message types for agent-to-agent delegation. */

export type A2APart = {
  type: "text";
  text: string;
};

export type A2AMessage = {
  role: "user" | "agent";
  parts: A2APart[];
};

export type A2AContext = {
  session?: string;
  trace?: TraceStep[];
};

export type TraceStep = {
  agent: string;
  action: string;
  detail?: string;
};

export type AgentCard = {
  name: string;
  description: string;
  url: string;
  version: string;
  skills: Array<{ id: string; name: string; description: string }>;
};

export type A2ASendRequest = {
  message: A2AMessage;
  context?: A2AContext;
};

export type A2ASendResponse = {
  message: A2AMessage;
  context: A2AContext;
};

export function textMessage(role: A2AMessage["role"], text: string): A2AMessage {
  return { role, parts: [{ type: "text", text }] };
}

export function messageText(message: A2AMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

export function appendTrace(
  context: A2AContext | undefined,
  step: TraceStep
): A2AContext {
  return {
    ...context,
    trace: [...(context?.trace ?? []), step],
  };
}

export function baggageHeader(session: string | undefined): Record<string, string> {
  if (!session?.trim()) return {};
  return { baggage: `mirrord-session=${session.trim()}` };
}
