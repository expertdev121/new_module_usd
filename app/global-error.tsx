"use client";

/**
 * Root error boundary (App Router). Catches errors thrown in the ROOT layout
 * itself, which app/error.tsx cannot. Must render its own <html>/<body>.
 * Same stale-bundle chunk-error auto-recovery as app/error.tsx, dependency-free.
 */

import { useEffect } from "react";

function isChunkLoadError(error?: (Error & { digest?: string }) | null): boolean {
  const text = `${error?.name || ""} ${error?.message || ""} ${error?.digest || ""}`;
  return /ChunkLoadError|Loading chunk [\d]+ failed|Loading CSS chunk|dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(
    text,
  );
}

const RELOAD_KEY = "dhq_chunk_reload_ts";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    if (chunk) {
      try {
        const last = Number(sessionStorage.getItem(RELOAD_KEY) || "0");
        if (Date.now() - last > 10_000) {
          sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
          window.location.reload();
          return;
        }
      } catch {
        /* fall through */
      }
    }
    // eslint-disable-next-line no-console
    console.error("Global error boundary caught:", error);
  }, [chunk, error]);

  return (
    <html>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#f5f7fa",
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
              ? "A new version was just released. If this screen doesn't refresh on its own, click Reload."
              : "The app hit an unexpected error. Please reload the page."}
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
        </div>
      </body>
    </html>
  );
}
