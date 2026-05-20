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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import { toast } from "sonner";

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
  }, [router, session, status]);

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
      ) : (
        <div className="space-y-3">
          {connections!.map((conn) => (
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
                        ? "Agency-level install — minted per-location tokens on demand"
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
                        <span
                          key={s}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          ))}
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
