"use client";

/**
 * /admin/crowded — overview hub.
 *
 * Shows:
 *   - Connection status card (with Connect / Reconnect / Disconnect actions)
 *   - Forms list (with Create + Edit + Embed + Copy URL actions)
 *
 * Polls the connection endpoint on mount; lists fetched once per page load.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Plug,
  Plus,
  Pencil,
  Code2,
  ExternalLink,
  Loader2,
  Trash2,
} from "lucide-react";

interface ConnectionSafe {
  id: string;
  chapterId: string;
  chapterName: string | null;
  orgId: string | null;
  status: "active" | "needs_reconnect" | "revoked";
  hasWebhookSecret: boolean;
  lastValidatedAt: string | null;
  createdAt: string;
}

interface FormRow {
  id: number;
  name: string;
  type: string;
  amountCents: number | null;
  recurringEnabled: boolean;
  primaryColor: string | null;
  isActive: boolean;
  createdAt: string;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export default function CrowdedHubPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [conn, setConn] = useState<ConnectionSafe | null | undefined>(undefined);
  const [forms, setForms] = useState<FormRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/login");
      return;
    }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      router.push("/contacts");
      return;
    }
    void load();
  }, [router, session, status]);

  async function load() {
    try {
      const [cRes, fRes] = await Promise.all([
        fetch("/api/admin/crowded/connection", { cache: "no-store" }),
        fetch("/api/admin/crowded/forms", { cache: "no-store" }),
      ]);
      if (cRes.ok) {
        const b = await cRes.json();
        setConn(b.connection ?? null);
      } else {
        setConn(null);
      }
      if (fRes.ok) {
        const b = await fRes.json();
        setForms(b.forms ?? []);
      } else {
        setForms([]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    }
  }

  async function handleDisconnect() {
    if (
      !confirm(
        "Disconnect Crowded? Webhooks will stop and forms will stop accepting donations. You can reconnect anytime.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/crowded/connection", {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
      toast.success("Crowded disconnected");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(formId: number) {
    if (
      !confirm(
        "Deactivate this form? Existing embed codes will stop accepting donations. The form record stays in the DB.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/crowded/forms/${formId}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
      toast.success("Form deactivated");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading" || conn === undefined || !session) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Crowded…
      </div>
    );
  }

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-3xl font-semibold tracking-tight">Crowded</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Build native donation forms that pay into your Crowded account.
          Embed anywhere with a copy-paste snippet.
        </p>
      </header>

      {/* Connection status card */}
      {!conn || conn.status !== "active" ? (
        <Card className="mb-5 border-amber-200 bg-amber-50/40">
          <CardContent className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                {conn?.status === "needs_reconnect" ? (
                  <AlertTriangle className="h-5 w-5" />
                ) : (
                  <Plug className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-amber-900">
                  {!conn
                    ? "Connect your Crowded account"
                    : conn.status === "needs_reconnect"
                      ? "Crowded needs to be reconnected"
                      : "Crowded is disconnected"}
                </h2>
                <p className="mt-0.5 text-sm text-amber-900/85">
                  Paste your Partner API key from Crowded → Settings → API,
                  pick the chapter you want donations to settle into, and
                  you're done. Webhook registration happens automatically.
                </p>
              </div>
            </div>
            <Button asChild className="bg-amber-700 hover:bg-amber-800">
              <Link href="/admin/crowded/connect">
                <Plug className="mr-2 h-4 w-4" />
                {conn ? "Reconnect" : "Connect Crowded"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-5 border-emerald-200 bg-emerald-50/40">
          <CardContent className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                <div>
                  <h2 className="text-base font-semibold text-emerald-900">
                    Connected to {conn.chapterName ?? conn.chapterId}
                  </h2>
                  <p className="mt-0.5 text-xs text-emerald-800/80">
                    Validated {fmtDate(conn.lastValidatedAt)} ·{" "}
                    {conn.hasWebhookSecret ? "webhook active" : (
                      <span className="text-amber-700">
                        webhook missing — reconnect to fix
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-4 w-4" />
                )}
                Disconnect
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Forms list */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Forms</h2>
          {conn && conn.status === "active" && (
            <Button asChild>
              <Link href="/admin/crowded/forms/new">
                <Plus className="mr-2 h-4 w-4" />
                Create form
              </Link>
            </Button>
          )}
        </div>

        {forms === null ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading forms…
          </div>
        ) : forms.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No forms yet.{" "}
              {conn && conn.status === "active" ? (
                <Link href="/admin/crowded/forms/new" className="font-medium text-foreground underline">
                  Create your first one
                </Link>
              ) : (
                "Connect Crowded above first."
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {forms.map((f) => (
              <Card key={f.id}>
                <CardContent className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-semibold">
                          {f.name}
                        </h3>
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                          style={{
                            background: (f.primaryColor || "#00A99D") + "1a",
                            color: f.primaryColor || "#0F2A2E",
                          }}
                        >
                          {f.type}
                        </span>
                        {f.recurringEnabled && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-700">
                            recurring
                          </span>
                        )}
                        {!f.isActive && (
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                            inactive
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {f.amountCents
                          ? `$${f.amountCents / 100} fixed`
                          : "Open amount"}{" "}
                        · created {fmtDate(f.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={`/donate/${f.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Preview
                        </a>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/admin/crowded/forms/${f.id}`}>
                          <Code2 className="mr-2 h-4 w-4" />
                          Embed
                        </Link>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/admin/crowded/forms/${f.id}`}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </Link>
                      </Button>
                      {f.isActive && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(f.id)}
                          disabled={busy}
                          className="border-rose-300 text-rose-700 hover:bg-rose-50"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Deactivate
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
