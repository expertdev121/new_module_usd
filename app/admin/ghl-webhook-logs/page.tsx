"use client";

/**
 * /admin/ghl-webhook-logs — super-admin-only.
 *
 * Shows recent GHL webhook events with filters + a 24h summary panel.
 * Every webhook GHL fires lands here, including signature failures and
 * processing errors. Use this to confirm webhooks are actually arriving,
 * see which sub-accounts are most active, and diagnose why something
 * isn't syncing.
 */
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Loader2,
  Activity,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface WebhookEvent {
  id: string;
  webhookId: string;
  eventType: string;
  locationId: string | null;
  companyId: string | null;
  signatureValid: boolean;
  processingStatus: string;
  processingError: string | null;
  receivedAt: string;
  processedAt: string | null;
  durationMs: number | null;
}

interface ApiResponse {
  summary: {
    window: string;
    total: number;
    byStatus: Record<string, number>;
    byEventType: Record<string, number>;
    byLocation: Record<string, number>;
  };
  events: WebhookEvent[];
  filters: {
    eventType: string | null;
    status: string | null;
    locationId: string | null;
    limit: number;
  };
}

function formatDateTime(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(date));
}

function StatusPill({ status }: { status: string }) {
  const map: Record<
    string,
    { className: string; icon: React.ReactNode; label: string }
  > = {
    processed: {
      className: "bg-emerald-50 text-emerald-700",
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: "processed",
    },
    duplicate: {
      className: "bg-zinc-100 text-zinc-600",
      icon: <RefreshCw className="h-3 w-3" />,
      label: "duplicate",
    },
    failed: {
      className: "bg-red-50 text-red-700",
      icon: <XCircle className="h-3 w-3" />,
      label: "failed",
    },
    skipped_no_token: {
      className: "bg-amber-50 text-amber-800",
      icon: <AlertTriangle className="h-3 w-3" />,
      label: "skipped (no token)",
    },
    skipped_loop: {
      className: "bg-blue-50 text-blue-700",
      icon: <RefreshCw className="h-3 w-3" />,
      label: "skipped (loop)",
    },
    unknown_type: {
      className: "bg-purple-50 text-purple-700",
      icon: <AlertTriangle className="h-3 w-3" />,
      label: "unknown type",
    },
    received: {
      className: "bg-blue-50 text-blue-700",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      label: "received",
    },
  };
  const cfg = map[status] || {
    className: "bg-zinc-100 text-zinc-600",
    icon: null,
    label: status,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

export default function GhlWebhookLogsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filterEventType, setFilterEventType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterLocationId, setFilterLocationId] = useState("");

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/login");
      return;
    }
    if (session.user.role !== "super_admin") {
      router.push("/contacts");
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status]);

  async function load() {
    setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterEventType) params.set("eventType", filterEventType);
      if (filterStatus) params.set("status", filterStatus);
      if (filterLocationId) params.set("locationId", filterLocationId);
      params.set("limit", "200");
      const res = await fetch(`/api/admin/ghl-webhook-logs?${params}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      setData((await res.json()) as ApiResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setRefreshing(false);
    }
  }

  const summary = data?.summary;
  const sortedLocations = useMemo(() => {
    if (!summary) return [];
    return Object.entries(summary.byLocation).sort(([, a], [, b]) => b - a);
  }, [summary]);

  if (status === "loading" || !session) {
    return <div className="py-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            GHL Webhook Logs
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every webhook GoHighLevel has fired at us. Use this to confirm
            sync is working and diagnose failures.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={refreshing}>
          {refreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </header>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary cards — last 24h. */}
      {summary && (
        <div className="mb-5 grid gap-3 md:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <Activity className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Total ({summary.window})
                </p>
                <p className="mt-0.5 text-2xl font-semibold tabular-nums">
                  {summary.total}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">
                By status
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(summary.byStatus).map(([k, v]) => (
                  <span key={k} className="text-xs">
                    <StatusPill status={k} />{" "}
                    <span className="font-mono tabular-nums">{v}</span>
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">
                By event type
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(summary.byEventType).map(([k, v]) => (
                  <span
                    key={k}
                    className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono"
                  >
                    {k}: {v}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* By location panel (only if there are any). */}
      {summary && sortedLocations.length > 0 && (
        <Card className="mb-5">
          <CardContent className="p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              By sub-account (last 24h, top 20)
            </p>
            <div className="grid gap-1.5 md:grid-cols-2 lg:grid-cols-3">
              {sortedLocations.map(([loc, count]) => (
                <button
                  key={loc}
                  className="flex items-center justify-between gap-3 rounded border px-2 py-1.5 text-left text-xs hover:bg-muted/50"
                  onClick={() => {
                    setFilterLocationId(loc === "(none)" ? "" : loc);
                    setTimeout(load, 0);
                  }}
                  title={`Click to filter by ${loc}`}
                >
                  <span className="truncate font-mono">{loc}</span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {count}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Event type
              </label>
              <Input
                value={filterEventType}
                onChange={(e) => setFilterEventType(e.target.value)}
                placeholder="e.g. ContactCreate"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Status
              </label>
              <Input
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                placeholder="e.g. failed"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Location ID
              </label>
              <Input
                value={filterLocationId}
                onChange={(e) => setFilterLocationId(e.target.value)}
                placeholder="GHL locationId"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={load} className="w-full" disabled={refreshing}>
                Apply
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Events table */}
      <Card>
        <CardContent className="p-0">
          {!data ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : data.events.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No webhook events match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5">Received</th>
                    <th className="px-4 py-2.5">Event</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Location</th>
                    <th className="px-4 py-2.5">Sig</th>
                    <th className="px-4 py-2.5">Duration</th>
                    <th className="px-4 py-2.5">Error / detail</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e) => (
                    <tr key={e.id} className="border-b hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-xs text-muted-foreground">
                        {formatDateTime(e.receivedAt)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {e.eventType}
                      </td>
                      <td className="px-4 py-2">
                        <StatusPill status={e.processingStatus} />
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {e.locationId || (
                          <span className="text-muted-foreground">
                            (none)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {e.signatureValid ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-red-600" />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-xs text-muted-foreground">
                        {e.durationMs !== null ? `${e.durationMs}ms` : "—"}
                      </td>
                      <td className="max-w-md px-4 py-2 text-xs text-muted-foreground">
                        {e.processingError ? (
                          <span className="break-words">{e.processingError}</span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
