"use client";

/**
 * /admin/offboard-clients — super admin only
 *
 * Lists every GHL location with a per-row action set:
 *   - Download CSV bundle (always available)
 *   - Soft Delete (active rows only)
 *   - Restore (soft-deleted rows only)
 *   - Hard Delete (irreversible — requires typing the location name)
 *
 * The page is split into TWO tables: Active vs Soft-deleted, so the
 * super admin can see at a glance which clients are currently locked
 * out vs running normally.
 */
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Download,
  Trash2,
  Undo2,
  AlertTriangle,
  Loader2,
  XCircle,
  CheckCircle2,
  UserMinus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface LocationRow {
  location_id: string;
  location_name: string | null;
  organization_name: string | null;
  company_name: string | null;
  company_id: string | null;
  resource_type: string;
  oauth_status: string;
  data_soft_deleted_at: string | null;
  connected_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  contact_count: number;
  pledge_count: number;
  payment_count: number;
  manual_donation_count: number;
  tag_count: number;
  admin_user_count: number;
}

function fmt(n: number) {
  return n.toLocaleString();
}
function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(s),
  );
}

export default function OffboardClientsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [rows, setRows] = useState<LocationRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<LocationRow | null>(null);
  const [hardDeleteConfirm, setHardDeleteConfirm] = useState("");

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
  }, [router, session, status]);

  async function load() {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/offboard/list", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { locations: LocationRow[] };
      setRows(data.locations);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    }
  }

  async function handleExport(loc: LocationRow) {
    setBusyId(loc.location_id);
    try {
      const res = await fetch(
        `/api/admin/offboard/${loc.location_id}/export`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const disp = res.headers.get("content-disposition") ?? "";
      const match = disp.match(/filename="([^"]+)"/);
      const filename =
        match?.[1] ?? `donorhq-export-${loc.location_id}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSoftDelete(loc: LocationRow) {
    if (
      !confirm(
        `Soft-delete ${displayName(loc)}?\n\n` +
          `This will:\n` +
          `  • Block all ${loc.admin_user_count} admin user(s) from logging in\n` +
          `  • Revoke the GHL OAuth token (stops webhooks)\n` +
          `  • Mark the location as offboarded\n\n` +
          `Data is preserved — you can Restore later.`,
      )
    ) {
      return;
    }
    setBusyId(loc.location_id);
    try {
      const res = await fetch(
        `/api/admin/offboard/${loc.location_id}/soft-delete`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      toast.success("Location soft-deleted");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Soft delete failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(loc: LocationRow) {
    if (!confirm(`Restore ${displayName(loc)} back to active?`)) return;
    setBusyId(loc.location_id);
    try {
      const res = await fetch(
        `/api/admin/offboard/${loc.location_id}/restore`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      toast.success("Location restored");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleHardDeleteSubmit() {
    if (!hardDeleteTarget) return;
    setBusyId(hardDeleteTarget.location_id);
    try {
      const res = await fetch(
        `/api/admin/offboard/${hardDeleteTarget.location_id}/hard-delete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmName: hardDeleteConfirm }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      toast.success(
        `Hard deleted: ${body.totalRowsDeleted?.toLocaleString() ?? "?"} rows removed`,
      );
      setHardDeleteTarget(null);
      setHardDeleteConfirm("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Hard delete failed");
    } finally {
      setBusyId(null);
    }
  }

  if (status === "loading" || !session) {
    return (
      <div className="py-8 text-center text-muted-foreground">Loading...</div>
    );
  }
  if (rows === null && !loadError) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading locations…
      </div>
    );
  }

  const active = (rows ?? []).filter((r) => !r.data_soft_deleted_at);
  const softDeleted = (rows ?? []).filter((r) => r.data_soft_deleted_at);

  return (
    <div>
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <UserMinus className="h-7 w-7" />
          Offboard Clients
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Super-admin tool. Download a client&rsquo;s data, then soft-delete (reversible)
          or hard-delete (permanent). GHL-side uninstall is handled separately.
        </p>
      </header>

      {loadError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <Section
        title="Active locations"
        description={`${active.length} location${active.length === 1 ? "" : "s"} currently active.`}
        rows={active}
        emptyMessage="No active locations."
        renderActions={(loc) => (
          <ActiveActions
            loc={loc}
            busy={busyId === loc.location_id}
            onExport={() => handleExport(loc)}
            onSoftDelete={() => handleSoftDelete(loc)}
            onHardDelete={() => {
              setHardDeleteTarget(loc);
              setHardDeleteConfirm("");
            }}
          />
        )}
      />

      <Section
        title="Soft-deleted locations"
        description={`${softDeleted.length} location${softDeleted.length === 1 ? "" : "s"} currently offboarded (reversible).`}
        rows={softDeleted}
        emptyMessage="No soft-deleted locations."
        renderActions={(loc) => (
          <SoftDeletedActions
            loc={loc}
            busy={busyId === loc.location_id}
            onExport={() => handleExport(loc)}
            onRestore={() => handleRestore(loc)}
            onHardDelete={() => {
              setHardDeleteTarget(loc);
              setHardDeleteConfirm("");
            }}
          />
        )}
      />

      {/* Hard-delete confirmation dialog (requires typing exact name) */}
      <Dialog
        open={Boolean(hardDeleteTarget)}
        onOpenChange={(o) => {
          if (!o) {
            setHardDeleteTarget(null);
            setHardDeleteConfirm("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-700">
              <AlertTriangle className="h-5 w-5" />
              Hard delete this location?
            </DialogTitle>
            <DialogDescription className="pt-2 text-sm">
              <span className="font-semibold">This is permanent.</span> Every row
              for this client will be deleted from the database: contacts,
              pledges, payments, donations, tags, categories, admin user
              accounts, OAuth tokens, and audit history. No undo.
            </DialogDescription>
          </DialogHeader>

          {hardDeleteTarget && (
            <div className="space-y-4">
              <div className="rounded-md border bg-rose-50 px-3 py-2 text-sm">
                <div className="font-medium text-rose-900">
                  {displayName(hardDeleteTarget)}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-rose-800">
                  <div>Contacts: {fmt(hardDeleteTarget.contact_count)}</div>
                  <div>Pledges: {fmt(hardDeleteTarget.pledge_count)}</div>
                  <div>Payments: {fmt(hardDeleteTarget.payment_count)}</div>
                  <div>
                    Donations: {fmt(hardDeleteTarget.manual_donation_count)}
                  </div>
                  <div>Tags: {fmt(hardDeleteTarget.tag_count)}</div>
                  <div>
                    Admin users: {fmt(hardDeleteTarget.admin_user_count)}
                  </div>
                </div>
              </div>

              <div className="text-sm">
                Type the exact location name to confirm:
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  {displayName(hardDeleteTarget)}
                </div>
              </div>
              <Input
                value={hardDeleteConfirm}
                onChange={(e) => setHardDeleteConfirm(e.target.value)}
                placeholder="Type the name here"
                autoFocus
              />
            </div>
          )}

          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              onClick={() => {
                setHardDeleteTarget(null);
                setHardDeleteConfirm("");
              }}
              disabled={busyId !== null}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                busyId !== null ||
                !hardDeleteTarget ||
                hardDeleteConfirm.trim().toLowerCase() !==
                  displayName(hardDeleteTarget).toLowerCase()
              }
              onClick={handleHardDeleteSubmit}
            >
              {busyId === hardDeleteTarget?.location_id ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Hard delete forever
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function displayName(loc: LocationRow): string {
  return (
    loc.organization_name ||
    loc.location_name ||
    loc.company_name ||
    loc.location_id
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Section({
  title,
  description,
  rows,
  emptyMessage,
  renderActions,
}: {
  title: string;
  description: string;
  rows: LocationRow[];
  emptyMessage: string;
  renderActions: (loc: LocationRow) => React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((loc) => (
            <Card key={loc.location_id}>
              <CardContent className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold">
                        {displayName(loc)}
                      </h3>
                      {loc.data_soft_deleted_at ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          <XCircle className="h-3 w-3" />
                          Soft-deleted {fmtDate(loc.data_soft_deleted_at)}
                        </span>
                      ) : loc.oauth_status === "active" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                          {loc.oauth_status}
                        </span>
                      )}
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {loc.resource_type === "Company"
                          ? "Agency"
                          : "Sub-account"}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {loc.location_id}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Contacts {fmt(loc.contact_count)}</span>
                      <span>Pledges {fmt(loc.pledge_count)}</span>
                      <span>Payments {fmt(loc.payment_count)}</span>
                      <span>Donations {fmt(loc.manual_donation_count)}</span>
                      <span>Tags {fmt(loc.tag_count)}</span>
                      <span>Admin users {fmt(loc.admin_user_count)}</span>
                      <span>Connected {fmtDate(loc.connected_at)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {renderActions(loc)}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function ActiveActions({
  loc,
  busy,
  onExport,
  onSoftDelete,
  onHardDelete,
}: {
  loc: LocationRow;
  busy: boolean;
  onExport: () => void;
  onSoftDelete: () => void;
  onHardDelete: () => void;
}) {
  void loc;
  return (
    <>
      <Button variant="outline" size="sm" onClick={onExport} disabled={busy}>
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        Download CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onSoftDelete}
        disabled={busy}
        className="border-amber-300 text-amber-700 hover:bg-amber-50"
      >
        <UserMinus className="mr-2 h-4 w-4" />
        Soft delete
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onHardDelete}
        disabled={busy}
        className="border-rose-300 text-rose-700 hover:bg-rose-50"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Hard delete
      </Button>
    </>
  );
}

function SoftDeletedActions({
  loc,
  busy,
  onExport,
  onRestore,
  onHardDelete,
}: {
  loc: LocationRow;
  busy: boolean;
  onExport: () => void;
  onRestore: () => void;
  onHardDelete: () => void;
}) {
  void loc;
  return (
    <>
      <Button variant="outline" size="sm" onClick={onExport} disabled={busy}>
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        Download CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onRestore}
        disabled={busy}
        className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
      >
        <Undo2 className="mr-2 h-4 w-4" />
        Restore
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onHardDelete}
        disabled={busy}
        className="border-rose-300 text-rose-700 hover:bg-rose-50"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Hard delete
      </Button>
    </>
  );
}
