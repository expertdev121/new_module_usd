"use client";

/**
 * Super-admin account switching UI + the shared client-side switch hook.
 *
 * The hook calls /api/admin/impersonate (validation + audit), then swaps the
 * JWT via useSession().update({ impersonate }) — the jwt() callback enforces
 * that only a real super admin's token actually changes — then hard-navigates
 * to /dashboard so every server component re-renders under the new tenant scope.
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Building2, Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Tenant = { locationId: string; orgName: string };

export function useAccountSwitch() {
  const { update } = useSession();
  const [busy, setBusy] = useState(false);

  const switchTo = useCallback(
    async (locationId: string, orgName: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/admin/impersonate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locationId }),
        });
        if (!res.ok) {
          setBusy(false);
          return false;
        }
        await update({ impersonate: locationId, orgName });
        // Hard reload so all tenant-scoped server data refetches.
        window.location.href = "/dashboard";
        return true;
      } catch {
        setBusy(false);
        return false;
      }
    },
    [update],
  );

  const returnToSuper = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: null }),
      });
      await update({ impersonate: null });
      window.location.href = "/dashboard";
    } catch {
      setBusy(false);
    }
  }, [update]);

  return { switchTo, returnToSuper, busy };
}

export function AccountSwitcherDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { switchTo, busy } = useAccountSwitch();
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    setTenants(null);
    setQ("");
    fetch("/api/admin/tenants", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { tenants: [] }))
      .then((b) => setTenants(b.tenants ?? []))
      .catch(() => setTenants([]));
  }, [open]);

  const s = q.trim().toLowerCase();
  const filtered = (tenants ?? []).filter(
    (t) => !s || t.orgName.toLowerCase().includes(s) || t.locationId.toLowerCase().includes(s),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Switch to a client account</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search accounts by name or ID…"
            className="pl-9"
          />
        </div>

        <div className="mt-2 max-h-80 overflow-y-auto rounded-md border">
          {tenants === null ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No accounts match “{q}”.
            </div>
          ) : (
            filtered.map((t) => (
              <button
                key={t.locationId}
                type="button"
                disabled={busy}
                onClick={() => void switchTo(t.locationId, t.orgName)}
                className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-muted disabled:opacity-50"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-emerald-100 text-emerald-700">
                  <Building2 className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{t.orgName}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {t.locationId}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        {busy && (
          <p className="mt-2 text-center text-xs text-muted-foreground">Switching…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
