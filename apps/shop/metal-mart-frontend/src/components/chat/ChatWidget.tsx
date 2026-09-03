"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { appendMessage, type ChatMessage } from "@/lib/chat";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const STORAGE_KEY = "metal-mart-chat-id";

function getConversationId(): string {
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

export default function ChatWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [unread, setUnread] = useState(0);
  const conversationIdRef = useRef<string | null>(null);
  const openRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  openRef.current = open;

  // The SSE stream is opened lazily on first panel open and kept for the
  // page's lifetime so closing the panel doesn't drop incoming replies.
  const startedRef = useRef(false);
  const startStream = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const id = getConversationId();
    conversationIdRef.current = id;
    const source = new EventSource(`${basePath}/api/chat/conversations/${id}/events`);
    source.addEventListener("snapshot", (e) => {
      setMessages(JSON.parse((e as MessageEvent).data) as ChatMessage[]);
    });
    source.addEventListener("message", (e) => {
      const msg = JSON.parse((e as MessageEvent).data) as ChatMessage;
      setMessages((prev) => appendMessage(prev, msg));
      if (!openRef.current && msg.sender !== "customer") {
        setUnread((n) => n + 1);
      }
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  // The support page has its own chat surface — no customer widget there.
  if (pathname?.startsWith("/support")) return null;

  function toggleOpen() {
    if (!open) {
      startStream();
      setUnread(0);
    }
    setOpen(!open);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    const conversationId = conversationIdRef.current;
    if (!trimmed || !conversationId) return;
    setText("");
    await fetch(`${basePath}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, sender: "customer", text: trimmed }),
    });
  }

  return (
    <>
      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 flex h-[28rem] w-[22rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-chat-panel"
          role="dialog"
          aria-label="Support chat"
        >
          <div className="flex items-center justify-between bg-[#3A342C] px-4 py-3 text-white">
            <div>
              <p className="text-sm font-semibold">Larkwell Support</p>
              <p className="text-xs text-white/80">We usually reply in a few minutes</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/80 hover:bg-white/15 hover:text-white"
              aria-label="Close chat"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <p className="pt-6 text-center text-sm text-slate-400">
                Hi there! 👋 How can we help?
              </p>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.sender === "customer" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                    msg.sender === "customer"
                      ? "rounded-br-sm bg-[#3A342C] text-white"
                      : "rounded-bl-sm bg-slate-100 text-slate-800"
                  }`}
                >
                  {msg.sender !== "customer" && (
                    <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {msg.sender === "bot" ? "MetalBot" : "Support"}
                    </p>
                  )}
                  {msg.text}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message…"
              className="min-w-0 flex-1 rounded-full border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3A342C]"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="btn-primary rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={toggleOpen}
        className="btn-primary fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full"
        aria-label={open ? "Close support chat" : "Open support chat"}
      >
        {unread > 0 && !open && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#2F4A3C] text-xs font-bold text-[#1a1a2e]">
            {unread}
          </span>
        )}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {open ? (
            <path d="M6 6l12 12M18 6L6 18" />
          ) : (
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          )}
        </svg>
      </button>
    </>
  );
}
