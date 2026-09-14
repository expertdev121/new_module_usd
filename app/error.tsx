"use client";

/**
 * Route-level error boundary (App Router).
 *
 * Before this existed the app had NO error boundary, so ANY unhandled client
 * error — most commonly a stale-bundle "ChunkLoadError" after a fresh deploy —
 * rendered Next's raw white page: "Application error: a client-side exception
 * has occurred". This boundary:
 *   1. Auto-recovers from chunk/module load errors by forcing ONE hard reload
 *      (fetches the fresh build). Guarded by a timestamp so a genuine code
 *      error can never reload-loop.
 *   2. For any other error, shows a friendly, recoverable screen instead of a
 *      dead white page.
 *
 * Kept dependency-free (plain elements + inline styles) so the boundary still
 * renders even when the broken chunk is a shared UI module.
 */

import { useEffect } from "react";

function isChunkLoadError(error?: (Error & { digest?: string }) | null): boolean {
  const text = `${error?.name || ""} ${error?.message || ""} ${error?.digest || ""}`;
  return /ChunkLoadError|Loading chunk [\d]+ failed|Loading CSS chunk|dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(
    text,
  );
}

const RELOAD_KEY = "dhq_chunk_reload_ts";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    if (chunk) {
      // Auto-reload once to pull the new build — but never tighter than every
      // 10s, so a persistent error shows the manual UI instead of looping.
      try {
        const last = Number(sessionStorage.getItem(RELOAD_KEY) || "0");
        if (Date.now() - last > 10_000) {
          sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
          window.location.reload();
          return;
        }
      } catch {
        // sessionStorage blocked — fall through to the manual UI.
      }
    }
    // eslint-disable-next-line no-console
    console.error("Route error boundary caught:", error);
  }, [chunk, error]);

  return (
    <div
      style={{
        minHeight: "70vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 440, width: "100%", textAlign: "center" }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "#111827", margin: "0 0 8px" }}>
          {chunk ? "Updating to the latest version…" : "Something went wrong"}
        </h2>
        <p style={{ fontSize: 14, color: "#4b5563", margin: "0 0 20px", lineHeight: 1.6 }}>
          {chunk
            ? "A new version was just released. If this screen doesn't refresh on its own in a second, click Reload."
            : "This page hit an unexpected error. Try again, or reload the page."}
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => reset()}
            style={{
              padding: "9px 16px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              background: "#fff",
              color: "#111827",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "9px 16px",
              borderRadius: 8,
              border: "1px solid #16a34a",
              background: "#16a34a",
              color: "#fff",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
        <div style={{ marginTop: 16 }}>
          <a href="/dashboard" style={{ fontSize: 13, color: "#6b7280", textDecoration: "underline" }}>
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
