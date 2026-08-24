"use client";

/**
 * Integrations — per-account public API keys + connection guide.
 *
 * An admin mints a key here (shown once), then hands the base URL + key to
 * any external platform to push donors and donations into DonorHQ. The page
 * doubles as the docs: endpoints, payloads, and copy-paste curl examples.
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Plug, Key, Copy, Check, Trash2, Plus, AlertTriangle, BookOpen, Loader2,
} from "lucide-react";

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

const ALL_SCOPES = [
  { id: "contacts:write", label: "Add contacts", hint: "Create / update donors" },
  { id: "donations:write", label: "Add donations", hint: "Record manual donations" },
] as const;

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

export default function IntegrationsPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(ALL_SCOPES.map((s) => s.id));
  const [newToken, setNewToken] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/api-keys", { cache: "no-store" });
      const b = await r.json();
      if (r.ok) setKeys(b.keys ?? []);
      else setError(b.error ?? "Failed to load keys");
    } catch {
      setError("Failed to load keys");
    } finally {
      setLoading(false);
    }
  }

  async function createKey() {
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || "Untitled key", scopes }),
      });
      const b = await r.json();
      if (!r.ok) {
        setError(b.error ?? "Failed to create key");
        return;
      }
      setNewToken(b.token);
      setName("");
      await load();
    } catch {
      setError("Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: string) {
    if (!confirm("Revoke this key? Any platform using it will stop working immediately.")) return;
    await fetch(`/api/admin/api-keys/${id}`, { method: "DELETE" });
    await load();
  }

  const base = origin || "https://your-donorhq-domain";
  const sampleKey = newToken ?? "dhq_live_your_api_key";

  const donorsPayload = `{
  "contact": {
    "firstName": "Jane",
    "lastName": "Donor",
    "email": "jane@example.com",
    "phone": "+1 555 010 2030"
  },
  "donations": [
    {
      "amount": "1,000.00",
      "currency": "USD",
      "date": "2026-08-01",
      "reference": "txn_ABC123",
      "campaign": "Summer 2026",
      "paymentMethod": "card",
      "designation": "General Fund"
    }
  ]
}`;

  const curl = `curl -X POST ${base}/api/v1/donors \\
  -H "Authorization: Bearer ${sampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '${donorsPayload.replace(/\n/g, "\n  ")}'`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-16">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400">
          <Plug className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Connect any external platform to DonorHQ. Create an API key, then
            push donors and donations straight into this account.
          </p>
        </div>
      </div>

      {/* One-time token reveal */}
      {newToken && (
        <Card className="border-green-300 bg-green-50/60 p-4 dark:border-green-900 dark:bg-green-950/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Copy your key now — it won't be shown again.</p>
              <p className="mb-2 text-xs text-muted-foreground">
                We store only a hash of it. If you lose it, revoke it and create a new one.
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-2 py-1.5 font-mono text-xs">
                  {newToken}
                </code>
                <CopyButton text={newToken} label="Copy key" />
                <Button variant="ghost" size="sm" onClick={() => setNewToken(null)}>Done</Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Create key */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Key className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Create an API key</h2>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Name
            </label>
            <Input
              placeholder="e.g. Wix site, Crowded, Zapier"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Scopes
            </label>
            <div className="flex gap-3">
              {ALL_SCOPES.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-sm" title={s.hint}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300"
                    checked={scopes.includes(s.id)}
                    onChange={(e) =>
                      setScopes((prev) =>
                        e.target.checked
                          ? [...prev, s.id]
                          : prev.filter((x) => x !== s.id),
                      )
                    }
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
          <Button onClick={createKey} disabled={creating || scopes.length === 0} className="gap-1.5">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create key
          </Button>
        </div>
      </Card>

      {/* Existing keys */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold">Your API keys</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keys yet. Create one above to get started.</p>
        ) : (
          <div className="divide-y">
            {keys.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{k.name}</span>
                    {k.revokedAt && <Badge variant="secondary">Revoked</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <code className="font-mono">{k.keyPrefix}…</code>
                    {k.scopes.map((s) => (
                      <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                    ))}
                    <span>
                      {k.lastUsedAt
                        ? `Last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                        : "Never used"}
                    </span>
                  </div>
                </div>
                {!k.revokedAt && (
                  <Button variant="ghost" size="sm" className="gap-1.5 text-red-600 hover:text-red-700" onClick={() => revokeKey(k.id)}>
                    <Trash2 className="h-3.5 w-3.5" /> Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Docs */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">How to connect</h2>
        </div>

        <div className="space-y-5 text-sm">
          <section>
            <h3 className="mb-1 font-semibold">1. Authenticate</h3>
            <p className="mb-2 text-muted-foreground">
              Send your key on every request. The key identifies your account —
              you never pass an account or location id.
            </p>
            <Code>Authorization: Bearer {sampleKey}</Code>
          </section>

          <section>
            <h3 className="mb-1 font-semibold">2. Push a donor with their donations</h3>
            <p className="mb-2 text-muted-foreground">
              <code className="rounded bg-muted px-1 py-0.5">POST {base}/api/v1/donors</code>{" "}
              — we find-or-create the contact (matched by email, then phone),
              then record each donation. Every donation needs a unique{" "}
              <code className="rounded bg-muted px-1 py-0.5">reference</code> so
              retries never double-count.
            </p>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Request body</span>
              <CopyButton text={donorsPayload} label="Copy payload" />
            </div>
            <Code>{donorsPayload}</Code>
          </section>

          <section>
            <h3 className="mb-1 font-semibold">3. Or use the focused endpoints</h3>
            <ul className="mb-2 list-inside list-disc space-y-1 text-muted-foreground">
              <li>
                <code className="rounded bg-muted px-1 py-0.5">POST /api/v1/contacts</code>{" "}
                — add / update a donor. Needs the <b>Add contacts</b> scope.
              </li>
              <li>
                <code className="rounded bg-muted px-1 py-0.5">POST /api/v1/donations</code>{" "}
                — record one gift; include a <code className="rounded bg-muted px-1 py-0.5">contact</code>{" "}
                object and if that donor doesn't exist we create them first.
                Needs the <b>Add donations</b> scope.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="mb-1 font-semibold">Try it with curl</h3>
            <div className="mb-2 flex justify-end">
              <CopyButton text={curl} label="Copy curl" />
            </div>
            <Code>{curl}</Code>
          </section>

          <section>
            <h3 className="mb-1 font-semibold">Fields</h3>
            <p className="text-muted-foreground">
              <b>Contact:</b> firstName, lastName (or a single name), email, phone, address, externalId.{" "}
              <b>Donation:</b> amount (required), reference (required, unique),
              currency (USD default), date (YYYY-MM-DD, defaults to today),
              campaign, paymentMethod, designation, note, status.
            </p>
          </section>
        </div>
      </Card>
    </div>
  );
}
