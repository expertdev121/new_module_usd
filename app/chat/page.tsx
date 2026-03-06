"use client";

import React, { useState, useRef, useEffect } from "react";

// Lightweight markdown renderer
function renderMarkdown(text: string): string {
  return text
    // Remove --- dividers entirely (render as nothing, not an hr element)
    .replace(/^---+$/gm, "")
    // Headings
    .replace(/^### (.+)$/gm, "<h3 style='font-weight:600;font-size:0.8rem;margin:6px 0 0'>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 style='font-weight:700;font-size:0.85rem;margin:6px 0 0'>$1</h2>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Bullet + numbered lists
    .replace(/^- (.+)$/gm, "<li style='margin-left:1.1rem;list-style-type:disc;line-height:1.35'>$1</li>")
    .replace(/^\d+\. (.+)$/gm, "<li style='margin-left:1.1rem;list-style-type:decimal;line-height:1.35'>$1</li>")
    // Collapse 3+ newlines → single break
    .replace(/\n{3,}/g, "\n\n")
    // Double newline → small gap
    .replace(/\n\n/g, "<br/>")
    // Single newline → space (join wrapped lines)
    .replace(/\n/g, " ");
}

const WEBHOOK_URL = "https://givesuite.app.n8n.cloud/webhook/5f1c0c82-0ff9-40c7-9e2e-b1a96ffe24cd/chat";
const SESSION_ID = "ghl_" + Math.random().toString(36).slice(2, 10);

type Message = {
  role: "user" | "bot";
  text: string;
  time: string;
};

function getTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "bot", text: "👋 Hi there! How can I help you today?", time: getTime() },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: "user", text, time: getTime() }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sendMessage",
          sessionId: SESSION_ID,
          chatInput: text,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const reply =
        (Array.isArray(data) ? data[0]?.output || data[0]?.text : data.output || data.text || data.message) ||
        "Sorry, I didn't understand that.";

      setMessages((prev) => [...prev, { role: "bot", text: reply, time: getTime() }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: "⚠️ Could not reach the assistant. Please try again.", time: getTime() },
      ]);
    }

    setLoading(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col bg-gray-50" style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
      {/* Header with bg image */}
      <div
        className="flex-shrink-0 w-full relative"
        style={{
          height: "200px",
          backgroundImage: "url('https://assets.cdn.filesafe.space/0lb5xbd0qHmaEqPUPc2N/media/69a96c28618c8d9465f183ae.png')",
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center center",
        }}
      >
        {/* Dark gradient overlay at bottom for text readability */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 60%)" }} />
        {/* Name + status */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2.5 px-4 py-2.5 text-white">
          <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center text-sm flex-shrink-0">🤖</div>
          <div>
            <p className="text-sm font-semibold leading-tight">GiveSuite Assistant</p>
            <p className="text-xs text-green-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              Online
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col-reverse gap-3">
        <div ref={bottomRef} />
        {loading && (
          <div className="self-start bg-white shadow-sm px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1 items-center">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        )}
        {[...messages].reverse().map((msg, i) => (
          <div key={i} className={`flex flex-col max-w-[85%] ${msg.role === "user" ? "self-end items-end" : "self-start items-start"}`}>
            <div
              className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-violet-600 text-white rounded-br-sm"
                  : "bg-white text-gray-800 shadow-sm rounded-bl-sm"
              }`}
              {...(msg.role === "bot"
                ? { dangerouslySetInnerHTML: { __html: renderMarkdown(msg.text) } }
                : { children: msg.text })}
            />
            <span className="text-xs text-gray-400 mt-1 px-1">{msg.time}</span>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-end gap-2 px-4 py-3 bg-white border-t border-gray-200 flex-shrink-0">
        <textarea
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm resize-none outline-none focus:border-violet-500 max-h-24 min-h-[42px] leading-relaxed"
          placeholder="Type a message..."
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="w-[42px] h-[42px] rounded-xl bg-violet-600 flex items-center justify-center text-white disabled:opacity-40 hover:bg-violet-700 transition-colors flex-shrink-0"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}