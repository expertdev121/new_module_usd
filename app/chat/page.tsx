"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";

const WEBHOOK_URL = "https://givesuite.app.n8n.cloud/webhook/5f1c0c82-0ff9-40c7-9e2e-b1a96ffe24cd/chat";
const ESCALATION_WEBHOOK_URL = "https://services.leadconnectorhq.com/hooks/Q9ZvF3ohYiVfIHJFHED6/webhook-trigger/886c6dae-865b-4aeb-99d9-688083c2c643";
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const INACTIVITY_WARNING_MS = 4 * 60 * 1000;

const generateSessionId = () => "ghl_" + Math.random().toString(36).slice(2, 10);

const QUICK_REPLIES = [
  "How do I add a contact?",
  "How do I create a workflow?",
  "How do I send a campaign?",
  "How do I manage pipelines?",
];

const INITIAL_MESSAGE = {
  role: "bot" as const,
  text: "👋 Hi! I'm Brandy, your GiveSuite assistant. I can help you with contacts, workflows, campaigns, and more. What would you like to do today?",
  time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
};

type Message = { role: "user" | "bot"; text: string; time: string };

function getTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function summarizeConversation(messages: Message[]): string {
  return messages.filter((m) => m.role === "user").map((m) => m.text).slice(-5).join(" | ") || "User requested human support.";
}

function renderMarkdown(text: string): string {
  return text
    .replace(/^---+$/gm, "")
    .replace(/^### (.+)$/gm, "<div style='font-weight:700;font-size:0.78rem;color:#6d28d9;margin:12px 0 4px;letter-spacing:0.03em;text-transform:uppercase'>$1</div>")
    .replace(/^## (.+)$/gm, "<div style='font-weight:700;font-size:0.88rem;color:#4f46e5;margin:12px 0 5px'>$1</div>")
    .replace(/\*\*(.+?)\*\*/g, "<strong style='color:#111827;font-weight:600'>$1</strong>")
    .replace(/^- (.+)$/gm, "<div style='display:flex;gap:8px;margin:3px 0;align-items:flex-start'><span style='color:#8b5cf6;margin-top:3px;flex-shrink:0;font-size:10px'>●</span><span>$1</span></div>")
    .replace(/^\d+\. (.+)$/gm, (match, p1) => {
      const num = match.match(/^(\d+)\./)?.[1] ?? "1";
      return `<div style='display:flex;gap:8px;margin:3px 0;align-items:flex-start'><span style='color:#8b5cf6;font-weight:700;flex-shrink:0;min-width:18px;font-size:12px'>${num}.</span><span>${p1}</span></div>`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n/g, "<div style='height:8px'></div>")
    .replace(/\n/g, " ");
}

export default function ChatPage() {
  const [sessionId, setSessionId] = useState(generateSessionId);
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showChips, setShowChips] = useState(true);
  const [escalationMode, setEscalationMode] = useState(false);
  const [escalationName, setEscalationName] = useState("");
  const [escalationEmail, setEscalationEmail] = useState("");
  const [escalationSubmitting, setEscalationSubmitting] = useState(false);
  const [escalationDone, setEscalationDone] = useState(false);
  const [chatEnded, setChatEnded] = useState(false);
  const [showInactivityWarning, setShowInactivityWarning] = useState(false);
  const [inactivityCountdown, setInactivityCountdown] = useState(60);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatEndedRef = useRef(false);
  useEffect(() => { chatEndedRef.current = chatEnded; }, [chatEnded]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, escalationMode, chatEnded, showInactivityWarning]);

  const clearAllTimers = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
  }, []);

  const closeChatDueToInactivity = useCallback(() => {
    clearAllTimers();
    setShowInactivityWarning(false);
    setChatEnded(true);
    setMessages((prev) => [...prev, { role: "bot", text: "⏱️ This chat was automatically closed due to inactivity. Start a new conversation anytime!", time: getTime() }]);
  }, [clearAllTimers]);

  const startInactivityTimer = useCallback(() => {
    clearAllTimers();
    setShowInactivityWarning(false);
    warningTimerRef.current = setTimeout(() => {
      if (!chatEndedRef.current) {
        setShowInactivityWarning(true);
        setInactivityCountdown(60);
        countdownIntervalRef.current = setInterval(() => {
          setInactivityCountdown((c) => { if (c <= 1) { clearInterval(countdownIntervalRef.current!); return 0; } return c - 1; });
        }, 1000);
      }
    }, INACTIVITY_WARNING_MS);
    inactivityTimerRef.current = setTimeout(() => { if (!chatEndedRef.current) closeChatDueToInactivity(); }, INACTIVITY_TIMEOUT_MS);
  }, [clearAllTimers, closeChatDueToInactivity]);

  useEffect(() => { startInactivityTimer(); return clearAllTimers; }, []);

  const resetInactivity = useCallback(() => {
    if (!chatEndedRef.current) { setShowInactivityWarning(false); startInactivityTimer(); }
  }, [startInactivityTimer]);

  const restartChat = () => {
    clearAllTimers();
    setMessages([{ ...INITIAL_MESSAGE, time: getTime() }]);
    setInput(""); setShowChips(true);
    setEscalationMode(false); setEscalationName(""); setEscalationEmail("");
    setEscalationSubmitting(false); setEscalationDone(false);
    setChatEnded(false); setShowInactivityWarning(false); setShowRestartConfirm(false);
    setSessionId(generateSessionId());
    setTimeout(startInactivityTimer, 0);
  };

  const endChat = () => {
    clearAllTimers(); setChatEnded(true); setEscalationMode(false);
    setMessages((prev) => [...prev, { role: "bot", text: "✅ This chat has been ended. Thank you for contacting Givesuite support! Start a new conversation anytime.", time: getTime() }]);
  };

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading || chatEnded) return;
    resetInactivity();
    setShowChips(false);
    setMessages((prev) => [...prev, { role: "user", text: msg, time: getTime() }]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);
    try {
      const res = await fetch(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sendMessage", sessionId, chatInput: msg }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rawReply: string = (Array.isArray(data) ? data[0]?.output || data[0]?.text : data.output || data.text || data.message) || "Sorry, I didn't understand that.";
      const needsEscalation = rawReply.includes("[ESCALATION_NEEDED]");
      const cleanReply = rawReply.replace("[ESCALATION_NEEDED]", "").trim();
      setMessages((prev) => [...prev, { role: "bot", text: cleanReply, time: getTime() }]);
      if (needsEscalation) setEscalationMode(true);
    } catch {
      setMessages((prev) => [...prev, { role: "bot", text: "⚠️ Could not reach the assistant. Please try again.", time: getTime() }]);
    }
    setLoading(false);
  };

  const submitEscalation = async () => {
    if (!escalationName.trim() || !escalationEmail.trim()) return;
    setEscalationSubmitting(true);
    try {
      await fetch(ESCALATION_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full_name: escalationName.trim(), email: escalationEmail.trim(), query: summarizeConversation(messages) }) });
    } catch { /* silent */ }
    setEscalationSubmitting(false); setEscalationMode(false); setEscalationDone(true);
    setMessages((prev) => [...prev, { role: "bot", text: "Thank you! Your request has been forwarded to our support team. A Givesuite representative will review your issue and reach out to you within 24–48 hours using the email you provided.\n\nIn the meantime, is there anything else I can help you with?", time: getTime() }]);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        @keyframes msgSlide {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes chipIn {
          from { opacity: 0; transform: translateY(6px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; } 50% { opacity: 0.4; }
        }
        @keyframes typingDot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes fadeOverlay { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modalPop {
          from { opacity: 0; transform: scale(0.94) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes warningSlide {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .chat-root {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; flex-direction: column;
          font-family: 'Inter', -apple-system, sans-serif;
          background: #f8f7ff;
        }

        /* ── HEADER ── */
        .chat-header {
          flex-shrink: 0;
          background: #ffffff;
          padding: 0 20px;
          height: 68px;
          display: flex; align-items: center; gap: 14px;
          border-bottom: 1px solid #ede9fe;
          box-shadow: 0 1px 12px rgba(109,40,217,0.07);
          position: relative; z-index: 10;
        }
        .header-avatar-wrap {
          position: relative; flex-shrink: 0;
        }
        .header-avatar {
          width: 44px; height: 44px; border-radius: 14px;
          object-fit: cover; object-position: center;
          border: 2px solid #ede9fe;
          box-shadow: 0 2px 8px rgba(109,40,217,0.15);
        }
        .header-status-dot {
          position: absolute; bottom: 1px; right: 1px;
          width: 11px; height: 11px; border-radius: 50%;
          background: #22c55e;
          border: 2px solid white;
          box-shadow: 0 0 0 2px rgba(34,197,94,0.25);
        }
        .header-info { flex: 1; }
        .header-name { font-size: 15px; font-weight: 700; color: #111827; line-height: 1.3; }
        .header-sub { font-size: 11.5px; color: #6b7280; margin-top: 1px; display: flex; align-items: center; gap: 5px; }
        .header-sub-dot { width: 5px; height: 5px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; }
        .header-badge {
          display: flex; align-items: center; gap: 6px;
          padding: 5px 12px; border-radius: 20px;
          background: linear-gradient(135deg, #f5f3ff, #ede9fe);
          border: 1px solid #ddd6fe;
        }
        .header-badge-icon {
          width: 20px; height: 20px; border-radius: 8px;
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 900; color: white;
        }
        .header-badge-text { font-size: 11px; font-weight: 600; color: #6d28d9; letter-spacing: 0.2px; }
        .restart-btn {
          width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
          background: #f5f3ff; border: 1px solid #ede9fe;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.15s; color: #7c3aed;
        }
        .restart-btn:hover { background: #ede9fe; border-color: #ddd6fe; transform: rotate(-20deg); }

        /* ── MESSAGES AREA ── */
        .chat-messages {
          flex: 1; overflow-y: auto;
          padding: 20px 16px 12px;
          display: flex; flex-direction: column; gap: 4px;
          background: #f8f7ff;
        }
        .chat-messages::-webkit-scrollbar { width: 4px; }
        .chat-messages::-webkit-scrollbar-track { background: transparent; }
        .chat-messages::-webkit-scrollbar-thumb { background: #ddd6fe; border-radius: 4px; }

        /* Date separator */
        .date-sep {
          display: flex; align-items: center; gap: 10px;
          margin: 8px 0 12px;
        }
        .date-sep-line { flex: 1; height: 1px; background: #ede9fe; }
        .date-sep-text { font-size: 10.5px; color: #a78bfa; font-weight: 500; white-space: nowrap; }

        /* Message rows */
        .msg-row {
          display: flex; align-items: flex-end; gap: 8px;
          animation: msgSlide 0.2s ease forwards;
        }
        .msg-row.user { flex-direction: row-reverse; }
        .msg-row.bot { flex-direction: row; }

        .msg-avatar {
          width: 32px; height: 32px; border-radius: 11px; flex-shrink: 0;
          overflow: hidden; border: 1.5px solid #ede9fe;
          box-shadow: 0 2px 6px rgba(109,40,217,0.1);
          margin-bottom: 2px;
        }
        .msg-avatar img { width: 100%; height: 100%; object-fit: cover; object-position: center; }

        .msg-col {
          display: flex; flex-direction: column; max-width: 78%;
        }
        .msg-col.user { align-items: flex-end; }
        .msg-col.bot  { align-items: flex-start; }

        .msg-bubble {
          padding: 11px 15px; font-size: 13.5px; line-height: 1.6;
          word-break: break-word;
        }
        .msg-bubble.bot {
          background: #ffffff; color: #1f2937;
          border-radius: 16px 16px 16px 4px;
          box-shadow: 0 1px 6px rgba(0,0,0,0.06), 0 0 0 1px rgba(109,40,217,0.06);
        }
        .msg-bubble.user {
          background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%);
          color: white; border-radius: 16px 16px 4px 16px;
          box-shadow: 0 4px 12px rgba(124,58,237,0.3);
        }
        .msg-time {
          font-size: 10px; color: #c4b5fd; margin-top: 4px; padding: 0 4px;
          font-weight: 500;
        }
        .msg-time.user { color: #a78bfa; }

        /* Typing indicator */
        .typing-bubble {
          display: flex; align-items: center; gap: 5px;
          padding: 13px 16px;
          background: white; border-radius: 16px 16px 16px 4px;
          box-shadow: 0 1px 6px rgba(0,0,0,0.06), 0 0 0 1px rgba(109,40,217,0.06);
        }
        .typing-dot {
          width: 7px; height: 7px; border-radius: 50%; background: #c4b5fd;
          animation: typingDot 1.3s infinite;
        }
        .typing-dot:nth-child(2) { animation-delay: 0.15s; }
        .typing-dot:nth-child(3) { animation-delay: 0.3s; }

        /* Quick reply chips */
        .chips-wrap {
          display: flex; flex-wrap: wrap; gap: 8px;
          padding-left: 40px; margin-top: 8px;
          animation: chipIn 0.25s ease forwards;
        }
        .chip-btn {
          padding: 7px 14px; border-radius: 20px;
          border: 1.5px solid #ddd6fe;
          background: white; color: #7c3aed;
          font-size: 12px; font-weight: 500;
          cursor: pointer; transition: all 0.15s;
          font-family: inherit; white-space: nowrap;
        }
        .chip-btn:hover {
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          color: white; border-color: transparent;
          box-shadow: 0 3px 10px rgba(124,58,237,0.3);
          transform: translateY(-1px);
        }

        /* ── ESCALATION FORM ── */
        .esc-card {
          background: white; border-radius: 16px; padding: 18px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.06), 0 0 0 1px rgba(109,40,217,0.08);
          max-width: 82%; display: flex; flex-direction: column; gap: 10px;
        }
        .esc-title { font-size: 13px; font-weight: 600; color: #374151; }
        .esc-input {
          width: 100%; padding: 10px 14px; border-radius: 10px;
          border: 1.5px solid #e5e7eb; font-size: 13px;
          font-family: inherit; outline: none; color: #111827;
          transition: border-color 0.15s, box-shadow 0.15s;
          background: #fafafa;
        }
        .esc-input:focus { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,0.12); background: white; }
        .esc-submit {
          width: 100%; padding: 11px; border-radius: 10px; border: none;
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          color: white; font-size: 13.5px; font-weight: 600;
          cursor: pointer; font-family: inherit;
          box-shadow: 0 3px 10px rgba(124,58,237,0.3);
          transition: all 0.15s;
        }
        .esc-submit:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 5px 16px rgba(124,58,237,0.4); }
        .esc-submit:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }

        /* ── POST ESCALATION ── */
        .post-esc-card {
          background: white; border-radius: 16px; padding: 16px 18px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.06), 0 0 0 1px rgba(109,40,217,0.08);
          min-width: 260px; max-width: 88%;
        }
        .post-esc-label { font-size: 12px; color: #9ca3af; margin-bottom: 12px; }
        .post-esc-btns { display: flex; gap: 10px; }
        .post-btn {
          flex: 1; padding: 11px 16px; border-radius: 10px;
          font-size: 13px; font-weight: 600; cursor: pointer;
          font-family: inherit; transition: all 0.15s; border: none;
          display: flex; align-items: center; justify-content: center; gap: 6px;
          white-space: nowrap;
        }
        .post-btn:hover { transform: translateY(-1px); }
        .post-btn.end { background: #f3f4f6; color: #6b7280; border: 1.5px solid #e5e7eb; }
        .post-btn.end:hover { background: #fee2e2; color: #dc2626; border-color: #fca5a5; box-shadow: 0 3px 8px rgba(220,38,38,0.12); }
        .post-btn.new { background: linear-gradient(135deg, #7c3aed, #4f46e5); color: white; box-shadow: 0 3px 10px rgba(124,58,237,0.3); }
        .post-btn.new:hover { box-shadow: 0 5px 16px rgba(124,58,237,0.4); }

        /* ── CHAT ENDED ── */
        .ended-cta {
          display: flex; justify-content: center; padding: 12px 0 4px;
          animation: msgSlide 0.25s ease forwards;
        }
        .ended-restart-btn {
          padding: 11px 28px; border-radius: 12px; border: none;
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          color: white; font-size: 13.5px; font-weight: 600;
          cursor: pointer; font-family: inherit;
          box-shadow: 0 4px 14px rgba(124,58,237,0.35);
          transition: all 0.15s;
          display: flex; align-items: center; gap: 8px;
        }
        .ended-restart-btn:hover { transform: translateY(-2px); box-shadow: 0 7px 20px rgba(124,58,237,0.45); }

        /* ── INACTIVITY WARNING ── */
        .inactivity-wrap {
          display: flex; justify-content: center; margin: 6px 0;
          animation: warningSlide 0.2s ease forwards;
        }
        .inactivity-card {
          background: #fffbeb; border: 1.5px solid #fde68a;
          border-radius: 14px; padding: 12px 18px;
          text-align: center; max-width: 88%;
          box-shadow: 0 2px 8px rgba(251,191,36,0.15);
        }
        .inactivity-text { font-size: 12.5px; color: #92400e; font-weight: 600; margin-bottom: 9px; }
        .inactivity-timer { font-variant-numeric: tabular-nums; color: #d97706; }
        .inactivity-btn {
          padding: 7px 20px; border-radius: 8px; border: none;
          background: #f59e0b; color: white; font-size: 12.5px; font-weight: 600;
          cursor: pointer; font-family: inherit; transition: all 0.15s;
          box-shadow: 0 2px 6px rgba(245,158,11,0.3);
        }
        .inactivity-btn:hover { background: #d97706; transform: translateY(-1px); }

        /* ── INPUT AREA ── */
        .chat-input-wrap {
          flex-shrink: 0; background: white;
          border-top: 1px solid #ede9fe;
          padding: 12px 16px 10px;
        }
        .input-box {
          display: flex; align-items: flex-end; gap: 10px;
          background: #f8f7ff; border-radius: 16px;
          border: 1.5px solid #ede9fe;
          padding: 8px 8px 8px 16px;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .input-box:focus-within {
          border-color: #a78bfa;
          box-shadow: 0 0 0 3px rgba(167,139,250,0.12);
          background: white;
        }
        .chat-textarea {
          flex: 1; border: none; background: transparent; outline: none;
          font-size: 13.5px; resize: none; min-height: 36px; max-height: 100px;
          line-height: 1.55; color: #111827; font-family: inherit;
          padding-top: 5px;
        }
        .chat-textarea::placeholder { color: #c4b5fd; }
        .send-btn {
          width: 38px; height: 38px; border-radius: 12px; border: none;
          cursor: pointer; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s;
        }
        .send-btn.active {
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          box-shadow: 0 3px 10px rgba(124,58,237,0.35);
        }
        .send-btn.active:hover { transform: scale(1.08); box-shadow: 0 5px 14px rgba(124,58,237,0.45); }
        .send-btn.inactive { background: #f3f4f6; cursor: not-allowed; }

        .input-footer {
          display: flex; align-items: center; justify-content: space-between;
          margin-top: 8px; padding: 0 4px;
        }
        .input-hints { font-size: 10.5px; color: #d8b4fe; }
        .input-hints kbd {
          background: #f5f3ff; border: 1px solid #ede9fe;
          border-radius: 4px; padding: 1px 5px; font-size: 10px;
          font-family: inherit; color: #8b5cf6;
        }
        .powered-by { font-size: 10px; color: #c4b5fd; font-weight: 500; letter-spacing: 0.3px; }
        .powered-by span { color: #7c3aed; font-weight: 700; }

        .ended-footer { text-align: center; padding: 8px 0 2px; font-size: 12.5px; color: #c4b5fd; }

        /* ── MODAL ── */
        .modal-overlay {
          position: absolute; inset: 0;
          background: rgba(17,24,39,0.5);
          backdrop-filter: blur(3px);
          display: flex; align-items: center; justify-content: center;
          z-index: 10000; padding: 24px;
          animation: fadeOverlay 0.2s ease;
        }
        .modal-card {
          background: white; border-radius: 20px; padding: 28px 24px;
          width: 100%; max-width: 310px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.18), 0 0 0 1px rgba(109,40,217,0.06);
          animation: modalPop 0.22s ease;
        }
        .modal-icon {
          width: 52px; height: 52px; border-radius: 16px;
          background: linear-gradient(135deg, #f5f3ff, #ede9fe);
          border: 1px solid #ddd6fe;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 16px;
        }
        .modal-title { font-size: 16px; font-weight: 700; color: #111827; text-align: center; margin-bottom: 6px; }
        .modal-body { font-size: 13px; color: #6b7280; text-align: center; line-height: 1.55; margin-bottom: 22px; }
        .modal-btns { display: flex; gap: 10px; }
        .modal-btn {
          flex: 1; padding: 11px; border-radius: 11px;
          font-size: 13.5px; font-weight: 600; cursor: pointer;
          font-family: inherit; transition: all 0.15s;
        }
        .modal-btn.cancel { background: #f9fafb; border: 1.5px solid #e5e7eb; color: #6b7280; }
        .modal-btn.cancel:hover { background: #f3f4f6; }
        .modal-btn.confirm { background: linear-gradient(135deg, #7c3aed, #4f46e5); border: none; color: white; box-shadow: 0 3px 10px rgba(124,58,237,0.3); }
        .modal-btn.confirm:hover { transform: translateY(-1px); box-shadow: 0 5px 16px rgba(124,58,237,0.4); }
      `}</style>

      <div
        className="chat-root"
        onMouseMove={resetInactivity}
        onKeyDown={resetInactivity}
        onClick={resetInactivity}
      >
        {/* ── HEADER ── */}
        <div className="chat-header">
          <div className="header-avatar-wrap">
            <img className="header-avatar" src="https://assets.cdn.filesafe.space/0lb5xbd0qHmaEqPUPc2N/media/69a96c28618c8d9465f183ae.png" alt="Brandy" />
            <div className="header-status-dot" />
          </div>
          <div className="header-info">
            <div className="header-name">Brandy</div>
            <div className="header-sub">
              <span className="header-sub-dot" />
              Online · GiveSuite Support
            </div>
          </div>
          <div className="header-badge">
            <div className="header-badge-icon">G</div>
            <span className="header-badge-text">GiveSuite</span>
          </div>
          <button
            className="restart-btn"
            title="Restart conversation"
            onClick={(e) => { e.stopPropagation(); setShowRestartConfirm(true); }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        </div>

        {/* ── MESSAGES ── */}
        <div className="chat-messages">
          <div style={{ flex: 1 }} />

          {/* Today separator */}
          <div className="date-sep">
            <div className="date-sep-line" />
            <span className="date-sep-text">Today</span>
            <div className="date-sep-line" />
          </div>

          {messages.map((msg, i) => (
            <div key={i} className={`msg-row ${msg.role}`} style={{ marginBottom: 6 }}>
              {msg.role === "bot" && (
                <div className="msg-avatar">
                  <img src="https://assets.cdn.filesafe.space/0lb5xbd0qHmaEqPUPc2N/media/69a96c28618c8d9465f183ae.png" alt="Brandy" />
                </div>
              )}
              <div className={`msg-col ${msg.role}`}>
                <div
                  className={`msg-bubble ${msg.role}`}
                  {...(msg.role === "bot"
                    ? { dangerouslySetInnerHTML: { __html: renderMarkdown(msg.text) } }
                    : { children: msg.text })}
                />
                <span className={`msg-time ${msg.role}`}>{msg.time}</span>
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div className="msg-row bot" style={{ marginBottom: 6 }}>
              <div className="msg-avatar">
                <img src="https://assets.cdn.filesafe.space/0lb5xbd0qHmaEqPUPc2N/media/69a96c28618c8d9465f183ae.png" alt="Brandy" />
              </div>
              <div className="msg-col bot">
                <div className="typing-bubble">
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                </div>
              </div>
            </div>
          )}

          {/* Escalation Form */}
          {escalationMode && !escalationDone && (
            <div className="msg-row bot" style={{ marginBottom: 6, alignItems: "flex-start" }}>
              <div className="msg-avatar">
                <img src="https://assets.cdn.filesafe.space/0lb5xbd0qHmaEqPUPc2N/media/69a96c28618c8d9465f183ae.png" alt="Brandy" />
              </div>
              <div className="esc-card">
                <p className="esc-title">Please provide your details so our team can follow up:</p>
                <input className="esc-input" type="text" placeholder="Full Name" value={escalationName} onChange={(e) => setEscalationName(e.target.value)} />
                <input className="esc-input" type="email" placeholder="Email Address" value={escalationEmail} onChange={(e) => setEscalationEmail(e.target.value)} />
                <button className="esc-submit" onClick={submitEscalation} disabled={escalationSubmitting || !escalationName.trim() || !escalationEmail.trim()}>
                  {escalationSubmitting ? "Sending…" : "Submit to Support →"}
                </button>
              </div>
            </div>
          )}

          {/* Post-escalation actions */}
          {escalationDone && !chatEnded && (
            <div className="msg-row bot" style={{ marginBottom: 6, alignItems: "flex-start" }}>
              <div className="msg-avatar">
                <img src="https://assets.cdn.filesafe.space/0lb5xbd0qHmaEqPUPc2N/media/69a96c28618c8d9465f183ae.png" alt="Brandy" />
              </div>
              <div className="post-esc-card">
                <p className="post-esc-label">What would you like to do next?</p>
                <div className="post-esc-btns">
                  <button className="post-btn end" onClick={endChat}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    End Chat
                  </button>
                  <button className="post-btn new" onClick={restartChat}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                    New Chat
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Chat ended restart CTA */}
          {chatEnded && (
            <div className="ended-cta">
              <button className="ended-restart-btn" onClick={restartChat}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                Start New Conversation
              </button>
            </div>
          )}

          {/* Inactivity warning */}
          {showInactivityWarning && !chatEnded && (
            <div className="inactivity-wrap">
              <div className="inactivity-card">
                <p className="inactivity-text">
                  ⏱ Still there? Chat closes in <span className="inactivity-timer">{inactivityCountdown}s</span>
                </p>
                <button className="inactivity-btn" onClick={(e) => { e.stopPropagation(); resetInactivity(); }}>
                  I'm still here
                </button>
              </div>
            </div>
          )}

          {/* Quick reply chips */}
          {showChips && (
            <div className="chips-wrap">
              {QUICK_REPLIES.map((chip, i) => (
                <button key={chip} className="chip-btn" style={{ animationDelay: `${i * 0.06}s` }} onClick={() => sendMessage(chip)}>
                  {chip}
                </button>
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── INPUT AREA ── */}
        <div className="chat-input-wrap">
          {chatEnded ? (
            <p className="ended-footer">This conversation has ended.</p>
          ) : (
            <div className="input-box">
              <textarea
                ref={textareaRef}
                className="chat-textarea"
                placeholder="Ask Brandy anything…"
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px";
                  resetInactivity();
                }}
                onKeyDown={handleKey}
              />
              <button
                className={`send-btn ${!loading && input.trim() ? "active" : "inactive"}`}
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill={!loading && input.trim() ? "white" : "#d1d5db"}>
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          )}
          <div className="input-footer">
            {!chatEnded && (
              <span className="input-hints">
                <kbd>Enter</kbd> send &nbsp;·&nbsp; <kbd>Shift+Enter</kbd> new line
              </span>
            )}
            <span className="powered-by">⚡ Powered by <span>GiveSuite</span></span>
          </div>
        </div>

        {/* ── RESTART MODAL ── */}
        {showRestartConfirm && (
          <div className="modal-overlay" onClick={() => setShowRestartConfirm(false)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-icon">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </div>
              <p className="modal-title">Restart Conversation?</p>
              <p className="modal-body">This will clear your current chat and start fresh. This action cannot be undone.</p>
              <div className="modal-btns">
                <button className="modal-btn cancel" onClick={() => setShowRestartConfirm(false)}>Cancel</button>
                <button className="modal-btn confirm" onClick={restartChat}>Restart</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}