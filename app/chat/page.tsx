"use client";

import React, { useState, useRef, useEffect } from "react";

const WEBHOOK_URL = "https://givesuite.app.n8n.cloud/webhook/5f1c0c82-0ff9-40c7-9e2e-b1a96ffe24cd/chat";
const SESSION_ID = "ghl_" + Math.random().toString(36).slice(2, 10);

const QUICK_REPLIES = [
  "How do I add a contact?",
  "How do I create a workflow?",
  "How do I send a campaign?",
  "How do I manage pipelines?",
];

type Message = {
  role: "user" | "bot";
  text: string;
  time: string;
};

function getTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderMarkdown(text: string): string {
  return text
    .replace(/^---+$/gm, "")
    // Headings with colored left border accent
    .replace(/^### (.+)$/gm, "<div style='font-weight:700;font-size:0.8rem;color:#7c3aed;margin:10px 0 4px;padding-left:8px;border-left:3px solid #7c3aed'>$1</div>")
    .replace(/^## (.+)$/gm, "<div style='font-weight:700;font-size:0.85rem;color:#4f46e5;margin:10px 0 4px;padding-left:8px;border-left:3px solid #4f46e5'>$1</div>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong style='color:#111827'>$1</strong>")
    // Bullet lists with better spacing
    .replace(/^- (.+)$/gm, "<div style='display:flex;gap:6px;margin:2px 0;align-items:flex-start'><span style='color:#7c3aed;margin-top:2px;flex-shrink:0'>•</span><span>$1</span></div>")
    // Numbered lists
    .replace(/^\d+\. (.+)$/gm, (match, p1, offset, str) => {
      const num = match.match(/^(\d+)\./)?.[1] ?? "1";
      return `<div style='display:flex;gap:6px;margin:2px 0;align-items:flex-start'><span style='color:#7c3aed;font-weight:600;flex-shrink:0;min-width:16px'>${num}.</span><span>${p1}</span></div>`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n/g, "<div style='height:6px'></div>")
    .replace(/\n/g, " ");
}


export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([{
    role: "bot",
    text: "👋 Hi! I'm Brandy, your GiveSuite assistant. I can help you with contacts, workflows, campaigns, and more. What would you like to do today?",
    time: getTime(),
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showChips, setShowChips] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setShowChips(false);
    setMessages((prev) => [...prev, { role: "user", text: msg, time: getTime() }]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sendMessage", sessionId: SESSION_ID, chatInput: msg }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply =
        (Array.isArray(data) ? data[0]?.output || data[0]?.text : data.output || data.text || data.message) ||
        "Sorry, I didn't understand that.";
      setMessages((prev) => [...prev, { role: "bot", text: reply, time: getTime() }]);
    } catch {
      setMessages((prev) => [...prev, { role: "bot", text: "⚠️ Could not reach the assistant. Please try again.", time: getTime() }]);
    }
    setLoading(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes chipPop {
          from { opacity: 0; transform: scale(0.88); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes dot-bounce {
          0%,60%,100% { transform: translateY(0); }
          30% { transform: translateY(-5px); }
        }
        .msg-in { animation: slideUp 0.22s ease forwards; }
        .chip { animation: chipPop 0.18s ease forwards; }
        .chip:hover { background: #7c3aed !important; color: white !important; border-color: #7c3aed !important; }
        .send-btn:not(:disabled):hover { transform: scale(1.07); }
        .typing-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#d1d5db; animation: dot-bounce 1.2s infinite; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 4px; }
      `}</style>

      <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column", background: "#f3f4f6", fontFamily: "'Inter', sans-serif" }}>

        {/* ── Header ── */}
        <div style={{ flexShrink: 0, background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.2)", borderBottom: "1px solid rgba(124,58,237,0.3)" }}>
          {/* Avatar */}
          <div style={{ width: 72, height: 46, borderRadius: 10, flexShrink: 0, overflow: "hidden", border: "2px solid rgba(124,58,237,0.7)", boxShadow: "0 2px 8px rgba(0,0,0,0.35)" }}>
            <img src="https://assets.cdn.filesafe.space/0lb5xbd0qHmaEqPUPc2N/media/69a96c28618c8d9465f183ae.png" alt="Brandy" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center" }} />
          </div>
          {/* Name */}
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "white", lineHeight: 1.3 }}>Brandy</p>
            <p style={{ margin: 0, fontSize: 11, color: "#4ade80", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
              GiveSuite Assistant · Online
            </p>
          </div>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg, #7c3aed, #16a34a)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 11, color: "white" }}>G</div>
            <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.55)", letterSpacing: 0.3 }}>GiveSuite</span>
          </div>
        </div>

        {/* ── Messages ── */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "12px 12px 6px",
          display: "flex", flexDirection: "column", gap: 10,
          backgroundImage: "radial-gradient(circle, #c4b5fd 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          backgroundColor: "#f5f3ff",
        }}>
          <div style={{ flex: 1 }} />

          {[...messages].map((msg, i) => (
            <div key={i} className="msg-in"
              style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
              {msg.role === "bot" && (
                <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, overflow: "hidden", border: "1.5px solid rgba(124,58,237,0.5)", boxShadow: "0 1px 4px rgba(0,0,0,0.18)" }}>
                  <img src="https://assets.cdn.filesafe.space/0lb5xbd0qHmaEqPUPc2N/media/69a96c28618c8d9465f183ae.png" alt="Brandy" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center" }} />
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", maxWidth: "80%", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                <div
                  style={{
                    padding: "9px 14px", fontSize: 13.5, lineHeight: 1.55, wordBreak: "break-word",
                    ...(msg.role === "user"
                      ? { background: "linear-gradient(135deg, #7c3aed, #4f46e5)", color: "white", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 4 }
                      : { background: "white", color: "#1f2937", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 4, borderBottomRightRadius: 18, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }),
                  }}
                  {...(msg.role === "bot"
                    ? { dangerouslySetInnerHTML: { __html: renderMarkdown(msg.text) } }
                    : { children: msg.text })}
                />
                <span style={{ fontSize: 10, color: "#9ca3af", marginTop: 3, padding: "0 4px" }}>{msg.time}</span>
              </div>
            </div>
          ))}

          {loading && (
            <div className="msg-in" style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, overflow: "hidden", border: "1.5px solid rgba(124,58,237,0.5)" }}>
                <img src="https://assets.cdn.filesafe.space/0lb5xbd0qHmaEqPUPc2N/media/69a96c28618c8d9465f183ae.png" alt="Brandy" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center" }} />
              </div>
              <div style={{ background: "white", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 4, borderBottomRightRadius: 18, padding: "10px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 2 }}>Brandy is typing...</span>
              </div>
            </div>
          )}

          {showChips && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, paddingLeft: 36 }}>
              {QUICK_REPLIES.map((chip, i) => (
                <button key={chip} className="chip" onClick={() => sendMessage(chip)}
                  style={{
                    animationDelay: `${i * 0.07}s`,
                    padding: "7px 14px", borderRadius: 20,
                    border: "none", background: "rgba(124,58,237,0.1)",
                    color: "#7c3aed", fontSize: 12, fontWeight: 600,
                    cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
                  }}
                >{chip}</button>
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Input ── */}
        <div style={{ background: "white", borderTop: "1px solid #e5e7eb", padding: "10px 12px 4px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, background: "#f3f4f6", borderRadius: 16, padding: "6px 6px 6px 14px" }}>
            <textarea
              ref={textareaRef}
              style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: 13.5, resize: "none", minHeight: 36, maxHeight: 96, lineHeight: 1.5, color: "#111827", fontFamily: "inherit" }}
              placeholder="Ask Brandy anything..."
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 96) + "px";
              }}
              onKeyDown={handleKey}
            />
            <button
              className="send-btn"
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              style={{
                width: 36, height: 36, borderRadius: 11, border: "none", cursor: "pointer", flexShrink: 0,
                background: loading || !input.trim() ? "#e5e7eb" : "linear-gradient(135deg, #7c3aed, #4f46e5)",
                display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s",
              }}
            >
              <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: loading || !input.trim() ? "#9ca3af" : "white" }}>
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
          <p style={{ fontSize: 10.5, color: "#b0b8c4", textAlign: "center", marginTop: 5, marginBottom: 0 }}>
            <kbd style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 4, padding: "1px 5px", fontSize: 10 }}>Enter</kbd> to send &nbsp;·&nbsp;
            <kbd style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 4, padding: "1px 5px", fontSize: 10 }}>Shift+Enter</kbd> new line
          </p>
          {/* Powered by */}
          <p style={{ fontSize: 10, color: "#c4b5fd", textAlign: "center", marginTop: 4, marginBottom: 2, letterSpacing: 0.3 }}>
            ⚡ Powered by <span style={{ fontWeight: 700, color: "#7c3aed" }}>GiveSuite</span>
          </p>
        </div>

      </div>
    </>
  );
}