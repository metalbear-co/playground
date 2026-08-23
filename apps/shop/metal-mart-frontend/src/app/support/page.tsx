"use client";

import { useEffect, useRef, useState } from "react";
import Header from "@/components/Header";
import {
  appendMessage,
  type ChatMessage,
  type ConversationSummary,
} from "@/lib/chat";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatTime(timestamp: string): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function SupportPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const selectedIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  selectedIdRef.current = selectedId;

  // The firehose stream carries every message in every conversation: it keeps
  // the list fresh and appends live messages for the open thread.
  useEffect(() => {
    const source = new EventSource(`${basePath}/api/chat/events`);
    source.addEventListener("snapshot", (e) => {
      setConversations(JSON.parse((e as MessageEvent).data) as ConversationSummary[]);
    });
    source.addEventListener("message", (e) => {
      const msg = JSON.parse((e as MessageEvent).data) as ChatMessage;
      setConversations((prev) => {
        const existing = prev.find((c) => c.conversationId === msg.conversationId);
        const updated: ConversationSummary = {
          conversationId: msg.conversationId,
          customerName: existing?.customerName ?? msg.customerName,
          lastMessage: msg.text,
          lastTimestamp: msg.timestamp,
          messageCount: (existing?.messageCount ?? 0) + 1,
        };
        return [updated, ...prev.filter((c) => c.conversationId !== msg.conversationId)];
      });
      if (msg.conversationId === selectedIdRef.current) {
        setMessages((prev) => appendMessage(prev, msg));
      }
    });
    source.addEventListener("deleted", (e) => {
      const { conversationId } = JSON.parse((e as MessageEvent).data) as {
        conversationId: string;
      };
      setConversations((prev) => prev.filter((c) => c.conversationId !== conversationId));
      if (conversationId === selectedIdRef.current) {
        setSelectedId(null);
        setMessages([]);
      }
    });
    return () => source.close();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setMessages([]);
    fetch(`${basePath}/api/chat/conversations/${selectedId}/messages`)
      .then((res) => res.json())
      .then((history: ChatMessage[]) => {
        if (selectedIdRef.current === selectedId) setMessages(history);
      })
      .catch((err) => console.error("Failed to load conversation:", err));
  }, [selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = reply.trim();
    if (!trimmed || !selectedId) return;
    setReply("");
    await fetch(`${basePath}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: selectedId, sender: "agent", text: trimmed }),
    });
  }

  async function deleteConversation(conversationId: string) {
    await fetch(`${basePath}/api/chat/conversations/${conversationId}`, {
      method: "DELETE",
    });
    // The firehose "deleted" event also removes it; this keeps the UI snappy.
    setConversations((prev) => prev.filter((c) => c.conversationId !== conversationId));
    if (selectedIdRef.current === conversationId) {
      setSelectedId(null);
      setMessages([]);
    }
  }

  const selected = conversations.find((c) => c.conversationId === selectedId);

  return (
    <div className="flex min-h-screen flex-col">
      <Header showSubtitle={false} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold">
          <span className="hand-drawn-underline">Support Inbox</span>
        </h1>

        <div className="grid gap-4 md:grid-cols-[minmax(240px,1fr)_2fr]">
          {/* Conversation list */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <p className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Conversations ({conversations.length})
            </p>
            {conversations.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                No chats yet — waiting for customers…
              </p>
            )}
            <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
              {conversations.map((c) => (
                <li key={c.conversationId} className="group relative">
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.conversationId)}
                    className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${
                      c.conversationId === selectedId ? "bg-[#e8e4fc]" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">
                        {c.customerName || `Visitor ${shortId(c.conversationId)}`}
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">
                        {formatTime(c.lastTimestamp)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate pr-6 text-xs text-slate-500">{c.lastMessage}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteConversation(c.conversationId)}
                    title="Delete conversation"
                    aria-label="Delete conversation"
                    className="absolute bottom-2 right-3 rounded p-1 text-slate-300 opacity-0 transition-opacity hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M8.75 1A2.75 2.75 0 0 0 6 3.75V4H3.5a.75.75 0 0 0 0 1.5h.443l.706 10.585A2.25 2.25 0 0 0 6.894 18.2h6.212a2.25 2.25 0 0 0 2.245-2.115L16.057 5.5h.443a.75.75 0 0 0 0-1.5H14v-.25A2.75 2.75 0 0 0 11.25 1h-2.5ZM12.5 4v-.25c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25V4h5ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Thread */}
          <div className="flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {!selectedId ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
                Select a conversation to view it
              </div>
            ) : (
              <>
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
                  <p className="text-sm font-semibold">
                    {selected?.customerName || `Visitor ${shortId(selectedId)}`}
                  </p>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.sender === "agent" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${
                          msg.sender === "agent"
                            ? "rounded-br-sm bg-[#6a4ff5] text-white"
                            : msg.sender === "bot"
                              ? "rounded-bl-sm bg-[#fef3c7] text-slate-700"
                              : "rounded-bl-sm bg-slate-100 text-slate-800"
                        }`}
                      >
                        {msg.sender !== "agent" && (
                          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {msg.sender === "bot" ? "MetalBot" : "Customer"}
                          </p>
                        )}
                        {msg.text}
                        <p
                          className={`mt-1 text-right text-[10px] ${
                            msg.sender === "agent" ? "text-white/70" : "text-slate-400"
                          }`}
                        >
                          {formatTime(msg.timestamp)}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
                <form onSubmit={sendReply} className="flex gap-2 border-t border-slate-200 p-3">
                  <input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Reply as support…"
                    className="min-w-0 flex-1 rounded-full border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#6a4ff5]"
                  />
                  <button
                    type="submit"
                    disabled={!reply.trim()}
                    className="btn-primary rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    Send
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
