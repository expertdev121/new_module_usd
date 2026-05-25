"use client";

/**
 * /admin/connections
 *
 * "Connected GHL Accounts" — one card per ghl_oauth_tokens row scoped to the
 * current admin's locationId. Shows status, company, scopes, timestamps,
 * and a Disconnect button (soft-revokes, never deletes).
 */
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Plug,
  ExternalLink,
  Loader2,
  RefreshCw,
  Download,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import { toast } from "sonner";

interface BackfillJob {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  kind: string;
  triggeredBy: string;
  page: number;
  pageSize: number;
  processedCount: number;
  upsertedCount: number;
  failedCount: number;
  totalEstimate: number | null;
  lastError: string | null;
  attemptCount: number;
  nextRunAt: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface Connection {
  id: string;
  resourceId: string;
  resourceType: "Location" | "Company";
  locationId: string | null;
  locationName: string | null;
  companyId: string;
  companyName: string | null;
  scope: string | null;
  status: "active" | "revoked" | "needs_reinstall";
  revokedAt: string | null;
  revokedReason: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

function formatDateTime(date: string | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

function StatusBadge({ status }: { status: Connection["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        Active
      </span>
    );
  }
  if (status === "needs_reinstall") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        <AlertTriangle className="h-3 w-3" />
        Needs reinstall
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
      <XCircle className="h-3 w-3" />
      Revoked
    </span>
  );
}

export default function ConnectionsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<Connection | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [backfillJobs, setBackfillJobs] = useState<BackfillJob[]>([]);
  const [backfillConnection, setBackfillConnection] = useState<{
    canSync: boolean;
    reason: string;
    message: string;
  } | null>(null);
  const [isTriggeringBackfill, setIsTriggeringBackfill] = useState(false);

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
    void loadConnections();
    void loadBackfillStatus();
  }, [router, session, status]);

  // Poll backfill status every 4s while ANY job is queued or running.
  useEffect(() => {
    const anyActive = backfillJobs.some(
      (j) => j.status === "queued" || j.status === "running",
    );
    if (!anyActive) return;
    const id = setInterval(() => void loadBackfillStatus(), 4000);
    return () => clearInterval(id);
  }, [backfillJobs]);

  async function loadConnections() {
    try {
      setLoadError(null);
      const res = await fetch("/api/admin/connections", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { connections: Connection[] };
      setConnections(data.connections);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load connections");
    }
  }

  async function loadBackfillStatus() {
    try {
      const res = await fetch("/api/admin/backfill/status", { cache: "no-store" });
      if (!res.ok) return; // silent — non-critical UI panel
      const data = (await res.json()) as {
        jobs: BackfillJob[];
        connection?: { canSync: boolean; reason: string; message: string };
      };
      setBackfillJobs(data.jobs);
      if (data.connection) setBackfillConnection(data.connection);
    } catch {
      /* silent */
    }
  }

  async function triggerBackfill() {
    setIsTriggeringBackfill(true);
    try {
      const res = await fetch("/api/admin/backfill/trigger?immediate=1", {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      if (body.created) {
        toast.success("Backfill started — pulling historical contacts from GHL");
      } else {
        toast.info("Backfill already in progress");
      }
      await loadBackfillStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start backfill");
    } finally {
      setIsTriggeringBackfill(false);
    }
  }

  async function confirmDisconnect() {
    if (!disconnectTarget) return;
    setIsDisconnecting(true);
    try {
      const res = await fetch(
        `/api/admin/connections/${disconnectTarget.id}/disconnect`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      toast.success("Connection disconnected");
      setDisconnectTarget(null);
      await loadConnections();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setIsDisconnecting(false);
    }
  }

  if (status === "loading" || !session) {
    return <div className="py-8 text-center text-muted-foreground">Loading...</div>;
  }

  const installUrl =
    process.env.NEXT_PUBLIC_GHL_INSTALL_URL || "/api/oauth/install";

  // Render a single connection card. Local to the component so it can
  // close over `setDisconnectTarget` + `installUrl`.
  const renderConnectionCard = (conn: Connection) => (
    <Card key={conn.id}>
      <CardContent className="px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold">
                {conn.resourceType === "Company"
                  ? conn.companyName
                    ? `Agency · ${conn.companyName}`
                    : `Agency · ${conn.companyId}`
                  : conn.locationName || conn.locationId || conn.resourceId}
              </h2>
              <StatusBadge status={conn.status} />
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {conn.resourceType === "Company" ? "Agency" : "Sub-account"}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {conn.resourceType === "Company"
                ? "Agency-level install — covers all installed sub-accounts; per-location tokens minted on demand"
                : conn.companyName || conn.companyId}
            </p>
          </div>

          {conn.status === "active" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDisconnectTarget(conn)}
            >
              Disconnect
            </Button>
          ) : (
            <Button variant="outline" size="sm" asChild>
              <a href={installUrl}>Reconnect</a>
            </Button>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-xs font-medium text-muted-foreground">
              {conn.resourceType === "Company" ? "Company ID" : "Location ID"}
            </dt>
            <dd className="truncate font-mono text-xs">{conn.resourceId}</dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-xs font-medium text-muted-foreground">Connected</dt>
            <dd className="tabular-nums">{formatDateTime(conn.createdAt)}</dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-xs font-medium text-muted-foreground">Last refresh</dt>
            <dd className="tabular-nums">{formatDateTime(conn.updatedAt)}</dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-xs font-medium text-muted-foreground">Token expires</dt>
            <dd className="tabular-nums">{formatDateTime(conn.expiresAt)}</dd>
          </div>
          {conn.status === "revoked" && (
            <div className="col-span-full flex justify-between gap-3 sm:block">
              <dt className="text-xs font-medium text-muted-foreground">
                Revoked {formatDateTime(conn.revokedAt)}
              </dt>
              <dd className="text-xs">
                {conn.revokedReason === "user_uninstalled"
                  ? "Customer uninstalled from GHL"
                  : conn.revokedReason === "admin_disconnected"
                    ? "Disconnected by admin"
                    : conn.revokedReason === "refresh_failed"
                      ? "Token refresh rejected by GHL — needs reinstall"
                      : conn.revokedReason || "—"}
              </dd>
            </div>
          )}
        </dl>

        {conn.scope && (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Scopes
            </summary>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {conn.scope.split(/\s+/).filter(Boolean).map((s) => (
                <span key={s} className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {s}
                </span>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-3xl font-semibold tracking-tight">Connected GHL Accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          GoHighLevel sub-accounts that have installed the Donor HQ app.
        </p>
      </header>

      {loadError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {/* Backfill panel — visible whenever connections exist. */}
      {connections && connections.length > 0 && (
        <BackfillPanel
          jobs={backfillJobs}
          connection={backfillConnection}
          onTrigger={triggerBackfill}
          isTriggering={isTriggeringBackfill}
        />
      )}

      {connections === null && !loadError ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading connections...
        </div>
      ) : connections && connections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center px-6 py-10 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
              <Plug className="h-6 w-6" />
            </div>
            <p className="text-base font-medium">No connections yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Install the Donor HQ app from your GoHighLevel sub-account to connect.
            </p>
            <Button asChild className="mt-5">
              <a href={installUrl}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Install on a sub-account
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : connections &&
        connections.every((c) => c.resourceType === "Company") ? (
        // Only Company-scoped rows visible — the admin's sub-account is
        // covered by an agency-level install. Show a different success
        // state so they know the connection is live without thinking they
        // need to install again.
        <>
          <Card className="mb-4 border-emerald-200 bg-emerald-50/40">
            <CardContent className="flex items-center gap-4 px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-emerald-900">
                  Connection is up and syncing
                </p>
                <p className="mt-0.5 text-sm text-emerald-800/80">
                  Your sub-account is connected through an agency-level install
                  shown below. No action needed — webhooks are flowing.
                </p>
              </div>
            </CardContent>
          </Card>
          <div className="space-y-3">
            {connections!.map((conn) => renderConnectionCard(conn))}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          {connections!.map((conn) => renderConnectionCard(conn))}
        </div>
      )}

      <DeleteConfirmationDialog
        isOpen={Boolean(disconnectTarget)}
        onClose={() => setDisconnectTarget(null)}
        onConfirm={confirmDisconnect}
        contactName={
          disconnectTarget?.locationName || disconnectTarget?.locationId || ""
        }
        isDeleting={isDisconnecting}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Backfill panel — shows progress of historical-contact imports for this
// location. Auto-enqueued on install; can be re-triggered manually.
// ─────────────────────────────────────────────────────────────────────────────
function BackfillPanel({
  jobs,
  connection,
  onTrigger,
  isTriggering,
}: {
  jobs: BackfillJob[];
  connection: { canSync: boolean; reason: string; message: string } | null;
  onTrigger: () => void;
  isTriggering: boolean;
}) {
  // If the location has no working GHL connection, swap the entire panel
  // for a "contact developers" card. Don't show Sync Now (would create a
  // doomed job) and don't show stale job state (would confuse the admin).
  if (connection && !connection.canSync) {
    return (
      <Card className="mb-4 border-amber-200 bg-amber-50/40">
        <CardContent className="px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-amber-900">
                GHL sync is not available for this account
              </h2>
              <p className="mt-1 text-sm text-amber-900/85">
                {connection.message}
              </p>
              <p className="mt-2 text-sm text-amber-900/85">
                Please contact the <strong>GiveSuite developer team</strong> to
                set up syncing between this GoHighLevel sub-account and Donor HQ.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const active = jobs.find(
    (j) => j.status === "queued" || j.status === "running",
  );
  const lastCompleted = jobs.find((j) => j.status === "completed");
  const lastFailed = jobs.find((j) => j.status === "failed");

  // Progress percentage — only meaningful when GHL gave us a total estimate.
  const percent =
    active && active.totalEstimate && active.totalEstimate > 0
      ? Math.min(
          100,
          Math.round((active.processedCount / active.totalEstimate) * 100),
        )
      : null;

  return (
    <Card className="mb-4">
      <CardContent className="px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">Historical Contact Sync</h2>
              {active && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {active.status === "running" ? "Running" : "Queued"}
                </span>
              )}
              {!active && lastCompleted && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Up to date
                </span>
              )}
              {!active && lastFailed && !lastCompleted && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                  <XCircle className="h-3 w-3" />
                  Failed
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {active
                ? "Pulling historical contacts from GoHighLevel. Live webhook syncs are not affected."
                : lastCompleted
                  ? `Last synced ${formatDateTime(lastCompleted.completedAt)} — ${lastCompleted.upsertedCount.toLocaleString()} contact${lastCompleted.upsertedCount === 1 ? "" : "s"} processed.`
                  : "Pull all contacts from GoHighLevel into Donor HQ. Safe to run anytime — duplicates are auto-merged."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onTrigger}
            disabled={isTriggering || Boolean(active)}
          >
            {isTriggering ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting…
              </>
            ) : active ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                In progress
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                {lastCompleted ? "Re-sync now" : "Sync now"}
              </>
            )}
          </Button>
        </div>

        {active && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {active.processedCount.toLocaleString()} processed
                {active.totalEstimate
                  ? ` of ~${active.totalEstimate.toLocaleString()}`
                  : ""}
                {active.upsertedCount > 0 && (
                  <> · {active.upsertedCount.toLocaleString()} saved</>
                )}
                {active.failedCount > 0 && (
                  <span className="text-amber-700">
                    {" "}
                    · {active.failedCount} failed
                  </span>
                )}
              </span>
              <span className="tabular-nums">
                {percent !== null ? `${percent}%` : `page ${active.page}`}
              </span>
            </div>
            <Progress value={percent ?? undefined} />
            {active.lastError && (
              <p className="text-xs text-amber-700">
                Last warning: {active.lastError.slice(0, 200)}
              </p>
            )}
          </div>
        )}

        {!active && lastFailed && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription className="text-xs">
              Last attempt failed: {lastFailed.lastError || "unknown error"}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
