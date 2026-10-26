"use client";

/**
 * Export tab of /admin/accounting: closed deposits -> QuickBooks Online journal-entry CSV.
 * Exporting locks the deposits (status "exported"); the file is kept and can be downloaded again.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data as T;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (v: string | number) => usd.format(typeof v === "number" ? v : Number.parseFloat(v));

interface ClosedDeposit { id: number; sourceLabel: string; reference: string | null; depositDate: string; gross: string; giftCount: number }
interface PreviewRow { journalNo: string; journalDate: string; accountName: string; debit: string; credit: string; description: string; className: string }
interface Preview { depositCount: number; rows: PreviewRow[]; problems: string[]; warnings: string[]; totalDebit: string; totalCredit: string }
interface ExportFile { id: number; filename: string; depositCount: number; createdAt: string }

function download(fileId: number, filename: string) {
  const a = document.createElement("a");
  a.href = `/api/admin/accounting/exports/${fileId}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ExportTab({ onExported }: { onExported: () => void }) {
  const [closed, setClosed] = useState<ClosedDeposit[] | null>(null);
  const [history, setHistory] = useState<ExportFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, h] = await Promise.all([
        api<{ deposits: ClosedDeposit[] }>("/api/admin/accounting/deposits?status=closed"),
        api<{ exports: ExportFile[] }>("/api/admin/accounting/exports"),
      ]);
      setClosed(d.deposits);
      setHistory(h.exports);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load deposits");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(
    () => (closed ?? []).filter((d) => (!from || d.depositDate >= from) && (!to || d.depositDate <= to)),
    [closed, from, to],
  );
  const allSelected = shown.length > 0 && shown.every((d) => selected.has(d.id));
  const totalSelected = shown.filter((d) => selected.has(d.id)).reduce((s, d) => s + Math.round(Number.parseFloat(d.gross) * 100), 0);
  const selectedIds = useMemo(() => shown.filter((d) => selected.has(d.id)).map((d) => d.id), [shown, selected]);

  // Any change to the selection invalidates the preview.
  useEffect(() => {
    setPreview(null);
    setConfirming(false);
  }, [selectedIds.join(",")]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function runPreview() {
    setPreviewing(true);
    try {
      setPreview(await api<Preview>("/api/admin/accounting/exports/preview", { method: "POST", body: JSON.stringify({ depositIds: selectedIds }) }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the preview");
    } finally {
      setPreviewing(false);
    }
  }

  async function runExport() {
    setExporting(true);
    try {
      const res = await api<{ fileId: number; filename: string; depositCount: number }>("/api/admin/accounting/exports", {
        method: "POST",
        body: JSON.stringify({ depositIds: selectedIds }),
      });
      download(res.fileId, res.filename);
      toast.success(`Exported ${res.depositCount} ${res.depositCount === 1 ? "deposit" : "deposits"}`);
      setSelected(new Set());
      setPreview(null);
      setConfirming(false);
      await load();
      onExported();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The export failed");
      setConfirming(false);
      await load();
    } finally {
      setExporting(false);
    }
  }

  const blocked = (preview?.problems.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Export closed deposits as a QuickBooks Online journal-entry file: one journal entry per deposit, coded by fund and class.
        In QuickBooks, go to Settings, then Import data, then Journal entries. Account names must match your QuickBooks account names exactly.
      </p>

      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="exp-from">Deposits from</Label><Input id="exp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="exp-to">To</Label><Input id="exp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="p-4 text-sm text-red-600">{error}</p>
          ) : !closed ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
          ) : shown.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{closed.length === 0 ? "No closed deposits to export. Close a deposit first." : "No closed deposits in this date range."}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all deposits" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(shown.map((d) => d.id)))} /></th>
                  <th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2 text-right">Gifts</th><th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => toggle(d.id)}>
                    <td className="px-3 py-2"><input type="checkbox" aria-label={`Select deposit ${d.id}`} checked={selected.has(d.id)} onChange={() => toggle(d.id)} onClick={(e) => e.stopPropagation()} /></td>
                    <td className="whitespace-nowrap px-3 py-2">{d.depositDate}</td>
                    <td className="px-3 py-2">{d.sourceLabel}</td>
                    <td className="px-3 py-2">{d.reference ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.giftCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(d.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">{selectedIds.length} selected · <span className="font-medium tabular-nums">{money(totalSelected / 100)}</span></span>
        <Button variant="outline" disabled={selectedIds.length === 0 || previewing} onClick={runPreview}>
          {previewing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Preview file
        </Button>
        <Button disabled={!preview || blocked || exporting || confirming} onClick={() => setConfirming(true)}>
          <Download className="mr-2 h-4 w-4" />Export {selectedIds.length || ""} {selectedIds.length === 1 ? "deposit" : "deposits"}
        </Button>
      </div>

      {confirming && preview && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          This downloads the file and marks {preview.depositCount} {preview.depositCount === 1 ? "deposit" : "deposits"} as exported. Exported deposits can't be changed or exported again.
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={exporting} onClick={runExport}>{exporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Export and lock</Button>
            <Button size="sm" variant="outline" disabled={exporting} onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {preview && (
        <Card>
          <CardContent className="space-y-3 p-0">
            {preview.problems.length > 0 && (
              <ul className="space-y-1 border-b p-3 text-sm text-red-600">{preview.problems.map((p) => <li key={p}>• {p}</li>)}</ul>
            )}
            {preview.warnings.length > 0 && (
              <ul className="space-y-1 border-b p-3 text-xs text-amber-700 dark:text-amber-300">
                {preview.warnings.map((w) => <li key={w} className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</li>)}
              </ul>
            )}
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background text-left text-muted-foreground">
                  <tr className="border-b"><th className="px-3 py-2">Journal no</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Account</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2">Class</th><th className="px-3 py-2">Description</th></tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-3 py-1.5">{r.journalNo}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{r.journalDate}</td>
                      <td className="px-3 py-1.5">{r.accountName}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.debit}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.credit}</td>
                      <td className="px-3 py-1.5">{r.className || "—"}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-3 pb-3 text-xs text-muted-foreground">{preview.rows.length} lines · debits {money(preview.totalDebit)} · credits {money(preview.totalCredit)}</p>
          </CardContent>
        </Card>
      )}

      <section>
        <h3 className="mb-2 text-sm font-medium">Export history</h3>
        <Card>
          <CardContent className="p-0">
            {history.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No exports yet.</p>
            ) : (
              <ul className="divide-y">
                {history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span>{h.filename}<span className="ml-2 text-xs text-muted-foreground">{h.depositCount} {h.depositCount === 1 ? "deposit" : "deposits"} · {h.createdAt.slice(0, 16).replace("T", " ")} UTC</span></span>
                    <Button size="sm" variant="outline" onClick={() => download(h.id, h.filename)}><Download className="mr-1.5 h-3.5 w-3.5" />Download</Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
