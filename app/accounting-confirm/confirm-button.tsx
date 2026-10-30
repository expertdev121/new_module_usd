"use client";

import { useState } from "react";

export function ConfirmButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  async function confirm() {
    setState("busy");
    try {
      const res = await fetch("/api/accounting-confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await res.json().catch(() => ({}));
      setMessage(data?.message || (res.ok ? "Confirmed." : "That did not work. Please try again."));
      setState(res.ok ? "ok" : "error");
    } catch {
      setMessage("That did not work. Please check your connection and try again.");
      setState("error");
    }
  }

  if (state === "ok") return <p style={{ color: "#166534", fontWeight: 600 }}>{message}</p>;
  return (
    <div>
      <button
        onClick={confirm}
        disabled={state === "busy"}
        style={{ background: "#16A34A", color: "#fff", border: 0, borderRadius: 8, padding: "10px 18px", fontSize: 15, fontWeight: 600, cursor: state === "busy" ? "default" : "pointer", opacity: state === "busy" ? 0.7 : 1 }}
      >
        {state === "busy" ? "Confirming…" : "Confirm this address"}
      </button>
      {state === "error" && <p style={{ color: "#b91c1c", marginTop: 12 }}>{message}</p>}
    </div>
  );
}
