/** Minimal A2A-style message types for agent-to-agent delegation. */
export function textMessage(role, text) {
    return { role, parts: [{ type: "text", text }] };
}
export function messageText(message) {
    return message.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n")
        .trim();
}
export function appendTrace(context, step) {
    return {
        ...context,
        trace: [...(context?.trace ?? []), step],
    };
}
export function baggageHeader(session) {
    if (!session?.trim())
        return {};
    return { baggage: `mirrord-session=${session.trim()}` };
}
