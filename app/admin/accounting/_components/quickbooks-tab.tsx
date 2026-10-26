"use client";

/**
 * QuickBooks tab of /admin/accounting: connect / reconnect / disconnect, refresh the chart of
 * accounts, "Sync now", and the sync log with a Retry button for failed deposits.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Plug, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data as T;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const when = (s: string | null) => (s ? `${s.slice(0, 16).replace("T", " ")} UTC` : "—");

interface Status {
  configured: boolean;
  serverEnvironment: "sandbox" | "production";
  connection: { status: "active" | "needs_reconnect"; companyName: string | null; environment: string; connectedAt: string; lastError: string | null; wrongEnvironment: boolean } | null;
  pendingDeposits: number;
  attention: string[];
  lastRun: { status: string; finishedAt: string | null; posted: number; failed: number; error: string | null } | null;
}
interface RunResult { depositId: number; status: string; externalId: string | null; error: string | null; source: string; depositDate: string; gross: string; retryable: boolean }
interface Run { id: number; trigger: string; status: string; startedAt: string; posted: number; failed: number; skipped: number; error: string | null; results: RunResult[] }

const RUN_STYLE: Record<string, string> = {
  success: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
};

export function QuickBooksTab({ onListsChanged, onPosted }: { onListsChanged: () => void; onPosted: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "connect" | "refresh" | "sync" | "disconnect" | number>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [openRun, setOpenRun] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api<Status>("/api/admin/accounting/connection"), api<{ runs: Run[] }>("/api/admin/accounting/sync")]);
      setStatus(s);
      setRuns(r.runs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load QuickBooks status");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    setBusy("connect");
    try {
      const { url } = await api<{ url: string }>("/api/admin/accounting/connection/start", { method: "POST" });
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the connection");
      setBusy(null);
    }
  }

  async function refreshLists() {
    setBusy("refresh");
    try {
      const r = await api<{ accounts: { created: number; updated: number; linked: number; deactivated: number }; classes: { created: number; linked: number } }>("/api/admin/accounting/connection/refresh-lists", { method: "POST" });
      toast.success(`Accounts: ${r.accounts.linked} linked, ${r.accounts.created} added, ${r.accounts.updated} updated, ${r.accounts.deactivated} marked inactive`);
      onListsChanged();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refresh from QuickBooks");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function syncNow(depositId?: number) {
    setBusy(depositId ?? "sync");
    try {
      const r = await api<{ status: string; posted: number; failed: number; error: string | null }>("/api/admin/accounting/sync", {
        method: "POST",
        body: JSON.stringify(depositId ? { depositId } : {}),
      });
      if (r.failed === 0 && !r.error) toast.success(r.posted === 0 ? "Nothing to post" : `Posted ${r.posted} ${r.posted === 1 ? "deposit" : "deposits"} to QuickBooks`);
      else toast.error(r.error ?? `${r.failed} ${r.failed === 1 ? "deposit" : "deposits"} could not be posted. See the sync log.`);
      onPosted();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The sync did not run");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    try {
      await api("/api/admin/accounting/connection", { method: "DELETE" });
      toast.success("Disconnected from QuickBooks. Your mappings and history are kept.");
      setConfirmDisconnect(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not disconnect");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!status) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;

  const c = status.connection;
  const needsReconnect = c?.status === "needs_reconnect" || c?.wrongEnvironment;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-6">
          {!c ? (
            <>
              <div className="flex items-center gap-2"><Plug className="h-5 w-5" /><h2 className="text-lg font-semibold">Connect QuickBooks Online</h2></div>
              <p className="text-sm text-muted-foreground">
                Connect once and DonorHQ posts your closed deposits to QuickBooks, already coded by fund and class. It only sends deposits (and reads your chart of accounts). It never reads your transactions or changes your existing entries.
              </p>
              {!status.configured && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4 shrink-0" />QuickBooks isn't set up on this server yet. An administrator needs to add the QuickBooks app keys first.
                </div>
              )}
              <Button onClick={connect} disabled={!status.configured || busy === "connect"}>
                {busy === "connect" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Connect to QuickBooks
              </Button>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold">{c.companyName ?? "QuickBooks company"}</h2>
                {needsReconnect ? <Badge className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" variant="secondary">Needs reconnecting</Badge> : <Badge className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200" variant="secondary"><CheckCircle2 className="mr-1 h-3 w-3" />Connected</Badge>}
                {c.environment === "sandbox" && <Badge variant="secondary">Sandbox (test company)</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">Connected {when(c.connectedAt)}</p>
              {needsReconnect && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{c.wrongEnvironment ? `This connection is to QuickBooks ${c.environment}, but the server is set to ${status.serverEnvironment}.` : c.lastError ?? "QuickBooks needs to be reconnected."} Nothing will post until you reconnect.</span>
                  <Button size="sm" onClick={connect} disabled={busy === "connect"}>Reconnect</Button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => syncNow()} disabled={needsReconnect || busy !== null}>
                  {busy === "sync" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sync now
                </Button>
                <span className="text-sm text-muted-foreground">{status.pendingDeposits} closed {status.pendingDeposits === 1 ? "deposit" : "deposits"} waiting to post</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={refreshLists} disabled={needsReconnect || busy !== null}>
                  {busy === "refresh" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Refresh from QuickBooks
                </Button>
                {!confirmDisconnect ? (
                  <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect(true)} disabled={busy !== null}>Disconnect</Button>
                ) : (
                  <span className="flex items-center gap-2 text-sm">
                    Stop syncing? Your mappings and history stay.
                    <Button size="sm" variant="destructive" onClick={disconnect} disabled={busy === "disconnect"}>Disconnect</Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmDisconnect(false)}>Cancel</Button>
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {c && status.attention.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="mb-1 flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Needs attention</p>
          <ul className="list-disc space-y-0.5 pl-6">{status.attention.map((a) => <li key={a}>{a}</li>)}</ul>
          <p className="mt-2 text-xs">Mapping problems: fix them on the Funds and Payment sources tabs; deposits that use those accounts won't post until then. Changed gifts: open the deposit on the Deposits tab.</p>
        </div>
      )}

      {c && (
        <section>
          <h3 className="mb-2 text-sm font-medium">Sync log</h3>
          <Card>
            <CardContent className="p-0">
              {runs.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No syncs yet. Close a deposit, then click Sync now. The nightly sync (when turned on in General) also appears here.</p>
              ) : (
                <ul className="divide-y">
                  {runs.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/40" onClick={() => setOpenRun(openRun === r.id ? null : r.id)}>
                        <span className="w-40 shrink-0">{when(r.startedAt)}</span>
                        <Badge className={RUN_STYLE[r.status] ?? ""} variant="secondary">{r.status}</Badge>
                        <span className="text-muted-foreground">{r.trigger}</span>
                        <span className="ml-auto tabular-nums">{r.posted} posted{r.failed > 0 ? ` · ${r.failed} failed` : ""}</span>
                      </button>
                      {openRun === r.id && (
                        <div className="space-y-2 border-t bg-muted/20 px-4 py-3">
                          {r.error && <p className="text-sm text-red-600">{r.error}</p>}
                          {r.results.length === 0 && !r.error && <p className="text-sm text-muted-foreground">Nothing was waiting to post.</p>}
                          {r.results.map((x) => (
                            <div key={x.depositId} className="flex flex-wrap items-start justify-between gap-3 text-sm">
                              <div>
                                <span className="font-medium">Deposit #{x.depositId}</span>
                                <span className="ml-2 text-xs text-muted-foreground">{x.depositDate} · {x.source} · {usd.format(Number.parseFloat(x.gross))}</span>
                                {x.status === "posted" && <span className="ml-2 text-xs text-green-700 dark:text-green-300">posted · QuickBooks #{x.externalId}</span>}
                                {x.error && <p className="mt-0.5 text-red-600">{x.error}</p>}
                              </div>
                              {x.retryable && (
                                <Button size="sm" variant="outline" disabled={busy !== null || needsReconnect} onClick={() => syncNow(x.depositId)}>
                                  {busy === x.depositId && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Retry
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
