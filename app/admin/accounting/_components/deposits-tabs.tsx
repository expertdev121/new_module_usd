"use client";

/**
 * Undeposited funds + Deposits tabs of /admin/accounting.
 * Staff tick gifts (checks, cash, ACH...) into one deposit matching the bank slip, then close it
 * to build its entry. Closing locks the gifts; reopening is allowed until the deposit is exported.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { localToday } from "./local-date";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40";

const MANUAL_SOURCES: Array<[string, string]> = [
  ["check", "Checks"],
  ["cash", "Cash"],
  ["ach", "ACH"],
  ["card", "Card payouts (Stripe or other processor)"],
  ["paypal", "PayPal payouts"],
  ["bank_transfer", "Bank transfer / wire"],
  ["other", "Other / unknown method"],
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data as T;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (v: string | number) => usd.format(typeof v === "number" ? v : Number.parseFloat(v));
const today = localToday;

interface Gift {
  id: number;
  date: string;
  amount: string;
  method: string | null;
  checkNumber: string | null;
  campaignName: string | null;
  donor: string;
}

// ---------------- Undeposited funds ----------------
export function UndepositedTab({ onCreated, onNeedsStartDate }: { onCreated: (depositId: number) => void; onNeedsStartDate: () => void }) {
  const [source, setSource] = useState("check");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<{ gifts: Gift[]; truncated: boolean; startDate: string | null; nonUsdSkipped: number; needsStartDate: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [depositDate, setDepositDate] = useState(today());
  const [bankRef, setBankRef] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setData(null);
    setError(null);
    try {
      const qs = new URLSearchParams({ source });
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const res = await api<{ gifts: Gift[]; truncated: boolean; startDate: string | null; nonUsdSkipped: number; needsStartDate: boolean }>(`/api/admin/accounting/undeposited?${qs}`);
      setData(res);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load gifts");
    }
  }, [source, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const gifts = data?.gifts ?? [];
  const totalCents = useMemo(() => gifts.filter((g) => selected.has(g.id)).reduce((s, g) => s + Math.round(Number.parseFloat(g.amount) * 100), 0), [gifts, selected]);
  const allSelected = gifts.length > 0 && selected.size === gifts.length;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function create() {
    setCreating(true);
    try {
      const res = await api<{ id: number }>("/api/admin/accounting/deposits", {
        method: "POST",
        body: JSON.stringify({ source, depositDate, bankReference: bankRef || null, giftIds: Array.from(selected) }),
      });
      toast.success("Deposit created");
      setBankRef("");
      await load();
      onCreated(res.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the deposit");
    } finally {
      setCreating(false);
    }
  }

  if (data?.needsStartDate) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 text-amber-600" />Set your go-live date first</p>
          <p className="text-sm text-muted-foreground">
            Only gifts dated on or after the start date can be deposited and sent to accounting, so older donations never reach your books by accident. Choose the date you want accounting to begin.
          </p>
          <Button onClick={onNeedsStartDate}>Go to General settings</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Payment type</Label>
            <select className={`${selectClass} w-full`} value={source} onChange={(e) => setSource(e.target.value)}>
              {MANUAL_SOURCES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="und-from">From</Label>
            <Input id="und-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="und-to">To</Label>
            <Input id="und-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {data?.startDate && (
        <p className="text-xs text-muted-foreground">Only gifts dated {data.startDate} or later are shown (the accounting start date).</p>
      )}
      {data && data.nonUsdSkipped > 0 && (
        <p className="text-xs text-muted-foreground">{data.nonUsdSkipped} non-USD {data.nonUsdSkipped === 1 ? "gift is" : "gifts are"} not shown. Deposits are USD only for now.</p>
      )}
      {data?.truncated && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />Showing the newest 300 gifts. Narrow the dates to see the rest.
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="p-4 text-sm text-red-600">{error}</p>
          ) : !data ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
          ) : gifts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nothing to deposit for this payment type.</p>
          ) : (
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all gifts" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(gifts.map((g) => g.id)))} /></th>
                    <th className="px-3 py-2">Date</th><th className="px-3 py-2">Donor</th><th className="px-3 py-2">Fund (campaign)</th><th className="px-3 py-2">Check #</th><th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {gifts.map((g) => (
                    <tr key={g.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => toggle(g.id)}>
                      <td className="px-3 py-2"><input type="checkbox" aria-label={`Select gift from ${g.donor}`} checked={selected.has(g.id)} onChange={() => toggle(g.id)} onClick={(e) => e.stopPropagation()} /></td>
                      <td className="whitespace-nowrap px-3 py-2">{g.date}</td>
                      <td className="px-3 py-2">{g.donor}</td>
                      <td className="px-3 py-2">{g.campaignName ?? <span className="text-muted-foreground">No campaign</span>}</td>
                      <td className="px-3 py-2">{g.checkNumber ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(g.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid items-end gap-4 p-4 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <div>
            <p className="text-xs text-muted-foreground">Selected</p>
            <p className="text-lg font-semibold tabular-nums">{money(totalCents / 100)} <span className="text-sm font-normal text-muted-foreground">({selected.size} {selected.size === 1 ? "gift" : "gifts"})</span></p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dep-date">Deposit date</Label>
            <Input id="dep-date" type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dep-ref">Bank reference (optional)</Label>
            <Input id="dep-ref" placeholder="Slip number" value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
          </div>
          <Button disabled={selected.size === 0 || !depositDate || creating} onClick={create}>
            {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create deposit
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------- Deposits ----------------
interface DepositRow { id: number; sourceLabel: string; reference: string | null; depositDate: string; gross: string; fees: string; status: string; giftCount: number; changedGifts: number }

const STATUS_STYLE: Record<string, string> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  closed: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  exported: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  voided: "bg-gray-100 text-gray-600 line-through dark:bg-gray-800 dark:text-gray-400",
};

export function DepositsTab({ openId, setOpenId, refreshKey }: { openId: number | null; setOpenId: (id: number | null) => void; refreshKey: number }) {
  const [status, setStatus] = useState("");
  const [list, setList] = useState<DepositRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ deposits: DepositRow[] }>(`/api/admin/accounting/deposits${status ? `?status=${status}` : ""}`);
      setList(res.deposits);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load deposits");
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Label htmlFor="dep-status">Status</Label>
        <select id="dep-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option><option value="open">Open</option><option value="closed">Closed</option><option value="exported">Exported</option><option value="voided">Voided</option>
        </select>
      </div>
      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="p-4 text-sm text-red-600">{error}</p>
          ) : !list ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
          ) : list.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No deposits yet. Create one from Undeposited funds.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b"><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2 text-right">Gifts</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2">Status</th></tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => setOpenId(d.id)}>
                    <td className="whitespace-nowrap px-3 py-2">{d.depositDate}</td>
                    <td className="px-3 py-2">{d.sourceLabel}</td>
                    <td className="px-3 py-2">{d.reference ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.giftCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(d.gross)}
                      {Number(d.fees) > 0 && <div className="text-xs text-muted-foreground">fee {money(d.fees)}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={STATUS_STYLE[d.status] ?? ""} variant="secondary">{d.status}</Badge>
                      {d.changedGifts > 0 && <Badge className="ml-1 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" variant="secondary">{d.changedGifts} {d.changedGifts === 1 ? "gift" : "gifts"} changed</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      {openId !== null && <DepositDialog id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

interface Detail {
  id: number;
  sourceLabel: string;
  reference: string | null;
  depositDate: string;
  gross: string;
  net: string;
  fees: string;
  feeSource: boolean;
  status: string;
  gifts: Array<{ id: number; date: string; amount: string; checkNumber: string | null; campaignName: string | null; donor: string }>;
  lines: Array<{ account: string | null; dimension: string | null; debit: string; credit: string; memo: string | null; unmapped: boolean }>;
  blockers: string[];
  unmapped: string[];
  drift: Array<{ giftId: number; donor: string; changes: string[] }>;
}

function DepositDialog({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => Promise<void> }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"close" | "void" | null>(null);
  const [removing, setRemoving] = useState<Set<number>>(new Set());
  const [feeInput, setFeeInput] = useState("");
  const [bankInput, setBankInput] = useState("");

  const load = useCallback(async () => {
    try {
      const dep = (await api<{ deposit: Detail }>(`/api/admin/accounting/deposits/${id}`)).deposit;
      setD(dep);
      setBankInput("");
      setFeeInput(Number(dep.fees) > 0 ? dep.fees : "");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the deposit");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const res = await api<{ deposit: Detail }>(`/api/admin/accounting/deposits/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setD(res.deposit);
      setBankInput(""); // the bank amount is confirmed fresh each time, never carried over
      setFeeInput(Number(res.deposit.fees) > 0 ? res.deposit.fees : "");
      setConfirm(null);
      setRemoving(new Set());
      toast.success(done);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  const open = d?.status === "open";
  const hasUnmapped = (d?.unmapped.length ?? 0) > 0;
  // Card/PayPal: the bank amount is typed in and checked against gifts minus fee before closing.
  const needsBank = open && d?.feeSource === true;
  const bankAmount = bankInput.trim();
  const closeBody = (approveUnmapped?: boolean) => ({ action: "close", ...(approveUnmapped ? { approveUnmapped } : {}), ...(needsBank ? { bankAmount } : {}) });
  const feeChanged = d ? (feeInput.trim() || "0") !== (Number(d.fees) > 0 ? d.fees : "0") : false;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d ? `${d.sourceLabel} deposit · ${d.depositDate}` : "Deposit"}</DialogTitle>
          <DialogDescription>
            {d ? <>{d.reference ? `Reference ${d.reference} · ` : ""}{d.gifts.length} {d.gifts.length === 1 ? "gift" : "gifts"} · {money(d.gross)}{Number(d.fees) > 0 ? ` − ${money(d.fees)} fee = ${money(d.net)} to bank` : ""} · <span className="font-medium">{d.status}</span></> : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {!d && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>}

        {d && (
          <div className="space-y-5">
            {d.drift.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" />{d.drift.length} {d.drift.length === 1 ? "gift was" : "gifts were"} changed after this deposit was {d.status === "exported" ? "sent to accounting" : "closed"}</p>
                <ul className="mt-1 list-disc pl-6 text-xs">{d.drift.map((g) => <li key={g.giftId}>{g.donor}: {g.changes.join(", ")}</li>)}</ul>
                <p className="mt-1.5 text-xs">
                  {d.status === "exported"
                    ? "Accounting still has the earlier values. Enter an adjusting entry there; DonorHQ does not change entries that were already sent."
                    : "It cannot be sent as it is. Reopen the deposit and close it again so the entry matches, or void it."}
                </p>
              </div>
            )}

            <section>
              <h3 className="mb-2 text-sm font-medium">{open ? "Entry preview" : "Entry"}</h3>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr><th className="px-3 py-2">Account</th><th className="px-3 py-2">Class</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th></tr>
                  </thead>
                  <tbody>
                    {d.lines.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-muted-foreground">No lines yet.</td></tr>}
                    {d.lines.map((l, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">
                          {l.account ?? <span className="text-red-600">No account</span>}
                          {l.memo && <div className="text-xs text-muted-foreground">{l.memo}</div>}
                        </td>
                        <td className="px-3 py-2">{l.dimension ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(l.debit) > 0 ? money(l.debit) : ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(l.credit) > 0 ? money(l.credit) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {open && d.blockers.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-red-600">{d.blockers.map((b) => <li key={b}>• {b}</li>)}</ul>
              )}
              {hasUnmapped && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" />Unmapped funds post to the catch-all account: {d.unmapped.join(", ")}</p>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">Gifts</h3>
              <div className="max-h-56 overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <tbody>
                    {d.gifts.map((g) => (
                      <tr key={g.id} className="border-b last:border-0">
                        {open && <td className="w-10 px-3 py-2"><input type="checkbox" aria-label={`Remove gift from ${g.donor}`} checked={removing.has(g.id)} onChange={() => setRemoving((p) => { const n = new Set(p); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })} /></td>}
                        <td className="whitespace-nowrap px-3 py-2">{g.date}</td>
                        <td className="px-3 py-2">{g.donor}{g.checkNumber ? <span className="ml-2 text-xs text-muted-foreground">#{g.checkNumber}</span> : null}</td>
                        <td className="px-3 py-2 text-muted-foreground">{g.campaignName ?? "No campaign"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(g.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {open && removing.size > 0 && (
                <Button className="mt-2" size="sm" variant="outline" disabled={busy || removing.size === d.gifts.length} onClick={() => act({ action: "remove_gifts", giftIds: Array.from(removing) }, "Removed from the deposit")}>
                  Remove {removing.size} selected (return to Undeposited funds)
                </Button>
              )}
              {open && removing.size === d.gifts.length && <p className="mt-1 text-xs text-muted-foreground">To remove every gift, void the deposit instead.</p>}
            </section>

            {needsBank && (
              <section className="space-y-3 rounded-lg border p-3">
                <div>
                  <h3 className="text-sm font-medium">Payout from the processor</h3>
                  <p className="text-xs text-muted-foreground">Enter the processing fee from the payout report, then the amount that reached your bank. They must match the gifts above.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
                  <div className="space-y-1.5">
                    <Label htmlFor="dep-fee">Processing fee</Label>
                    <Input id="dep-fee" inputMode="decimal" placeholder="0.00" value={feeInput} onChange={(e) => setFeeInput(e.target.value)} />
                  </div>
                  <div className="flex items-end">
                    <Button variant="outline" disabled={busy || !feeChanged} onClick={() => act({ action: "set_fees", fees: feeInput.trim() || "0" }, "Fee saved")}>Save fee</Button>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="dep-bank">Amount that reached the bank</Label>
                    <Input id="dep-bank" inputMode="decimal" placeholder="0.00" value={bankInput} onChange={(e) => setBankInput(e.target.value)} />
                  </div>
                </div>
                {feeChanged && <p className="text-xs text-amber-700 dark:text-amber-300">Save the fee to update the entry preview.</p>}
              </section>
            )}

            {confirm === "close" && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                {d.unmapped.length} {d.unmapped.length === 1 ? "fund is" : "funds are"} not mapped ({d.unmapped.join(", ")}). Closing will post {d.unmapped.length === 1 ? "it" : "them"} to the catch-all account.
                <div className="mt-2 flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => act(closeBody(true), "Deposit closed")}>Close anyway</Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
                </div>
              </div>
            )}
            {confirm === "void" && (
              <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                Voiding releases all {d.gifts.length} gifts back to Undeposited funds. The deposit stays in the list as voided.
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => act({ action: "void" }, "Deposit voided")}>Void deposit</Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {open && (
                <Button disabled={busy || d.blockers.length > 0 || feeChanged || (needsBank && !bankAmount)} onClick={() => (hasUnmapped ? setConfirm("close") : act(closeBody(), "Deposit closed"))}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Close deposit
                </Button>
              )}
              {d.status === "closed" && <Button variant="outline" disabled={busy} onClick={() => act({ action: "reopen" }, "Deposit reopened")}>Reopen</Button>}
              {(open || d.status === "closed") && <Button variant="outline" disabled={busy} onClick={() => setConfirm("void")}>Void</Button>}
              {d.status === "exported" && <p className="text-xs text-muted-foreground">Exported deposits can't be changed here.</p>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
