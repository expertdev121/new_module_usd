"use client";

/**
 * /admin/accounting — Settings > Accounting (admins only).
 * Tabs: General, Chart of accounts, Funds (= campaigns), Payment sources.
 * Phase 1 of the QuickBooks build; deposits/export/connection screens come later.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DepositsTab, UndepositedTab } from "./_components/deposits-tabs";
import { ExportTab } from "./_components/export-tab";
import { localToday } from "./_components/local-date";
import { QuickBooksTab } from "./_components/quickbooks-tab";

interface Settings {
  system: string;
  basis: "cash" | "accrual";
  startDate: string | null;
  unmappedAccountId: number | null;
  entryType: "deposit" | "journal_entry";
  autoSyncEnabled: boolean;
  configured?: boolean;
}
interface Account { id: number; number: string | null; name: string; type: string | null; active: boolean }
interface Klass { id: number; name: string; active: boolean }
interface Fund {
  campaignId: number;
  name: string;
  status: string;
  incomeAccountId: number | null;
  dimensionId: number | null;
  arAccountId: number | null;
  giftsLast90Days: number;
}
interface SourceRow { source: string; depositAccountId: number | null; feeAccountId: number | null }

const SOURCE_LABELS: Record<string, string> = {
  card: "Card (Stripe / online)",
  check: "Check",
  cash: "Cash",
  ach: "ACH",
  paypal: "PayPal",
  bank_transfer: "Bank transfer / wire",
  other: "Other / unknown",
};
const SOURCES_WITH_FEES = new Set(["card", "paypal"]);

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 disabled:opacity-50";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data as T;
}

/** Minimal CSV parser: quoted fields, escaped quotes, CRLF. Header row required. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const isInactive = (v: string | undefined) => !!v && ["false", "no", "0", "inactive", "n"].includes(v.toLowerCase());

export default function AccountingSettingsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [classes, setClasses] = useState<Klass[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [openDepositId, setOpenDepositId] = useState<number | null>(null);
  const [depositsRefresh, setDepositsRefresh] = useState(0);

  const loadAll = useCallback(async () => {
    try {
      const [s, l, f, so] = await Promise.all([
        api<{ settings: Settings }>("/api/admin/accounting/settings"),
        api<{ accounts: Account[]; classes: Klass[] }>("/api/admin/accounting/ledger"),
        api<{ funds: Fund[] }>("/api/admin/accounting/funds"),
        api<{ sources: SourceRow[] }>("/api/admin/accounting/sources"),
      ]);
      setSettings(s.settings);
      setAccounts(l.accounts);
      setClasses(l.classes);
      setFunds(f.funds);
      setSources(so.sources);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load accounting settings");
    }
  }, []);

  // Back from Intuit: /admin/accounting?tab=quickbooks&qbo=connected|denied|error
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const result = sp.get("qbo");
    if (sp.get("tab") === "quickbooks") setTab("quickbooks");
    if (result === "connected") toast.success("QuickBooks connected");
    else if (result === "denied") toast.error("QuickBooks access was not approved");
    else if (result === "error") toast.error("Could not connect to QuickBooks. Please try again.");
    if (result || sp.get("tab")) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/auth/login"); return; }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") { router.push("/contacts"); return; }
    void loadAll();
  }, [status, session, router, loadAll]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-red-600"><AlertTriangle className="h-4 w-4" />{loadError}</CardContent></Card>
      </div>
    );
  }
  if (!settings) {
    return <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Accounting</h1>
        <p className="text-sm text-muted-foreground">
          Choose how donations are coded when they are sent to your accounting system. DonorHQ only sends; it never changes your books.
        </p>
      </div>
      <Tabs value={tab ?? (settings.configured ? "undeposited" : "general")} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="undeposited">Undeposited funds</TabsTrigger>
          <TabsTrigger value="deposits">Deposits</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
          <TabsTrigger value="quickbooks">QuickBooks</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="chart">Chart of accounts</TabsTrigger>
          <TabsTrigger value="funds">Funds</TabsTrigger>
          <TabsTrigger value="sources">Payment sources</TabsTrigger>
        </TabsList>
        <TabsContent value="undeposited">
          <UndepositedTab
            onCreated={(id) => {
              setDepositsRefresh((n) => n + 1);
              setOpenDepositId(id);
              setTab("deposits");
            }}
            onNeedsStartDate={() => setTab("general")}
          />
        </TabsContent>
        <TabsContent value="deposits">
          <DepositsTab openId={openDepositId} setOpenId={setOpenDepositId} refreshKey={depositsRefresh} />
        </TabsContent>
        <TabsContent value="export">
          <ExportTab onExported={() => setDepositsRefresh((n) => n + 1)} />
        </TabsContent>
        <TabsContent value="quickbooks">
          <QuickBooksTab onListsChanged={() => void loadAll()} onPosted={() => setDepositsRefresh((n) => n + 1)} />
        </TabsContent>
        <TabsContent value="general"><GeneralTab settings={settings} accounts={accounts} onSaved={setSettings} /></TabsContent>
        <TabsContent value="chart"><ChartTab accounts={accounts} classes={classes} reload={loadAll} /></TabsContent>
        <TabsContent value="funds"><FundsTab funds={funds} setFunds={setFunds} accounts={accounts} classes={classes} accrual={settings.basis === "accrual"} /></TabsContent>
        <TabsContent value="sources"><SourcesTab sources={sources} setSources={setSources} accounts={accounts} /></TabsContent>
      </Tabs>
    </div>
  );
}

function AccountSelect({ value, accounts, onChange, disabled, placeholder = "Not mapped" }: {
  value: number | null;
  accounts: Account[];
  onChange: (v: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const options = accounts.filter((a) => a.active || a.id === value);
  return (
    <select className={selectClass} disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{placeholder}</option>
      {options.map((a) => (
        <option key={a.id} value={a.id}>{a.number ? `${a.number} · ` : ""}{a.name}{a.active ? "" : " (inactive)"}</option>
      ))}
    </select>
  );
}

function GeneralTab({ settings, accounts, onSaved }: { settings: Settings; accounts: Account[]; onSaved: (s: Settings) => void }) {
  // First time here: suggest today as the go-live date (shown, and saved only when you click Save).
  const [form, setForm] = useState<Settings>(!settings.configured && !settings.startDate ? { ...settings, startDate: localToday() } : settings);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      const { configured: _c, ...body } = form;
      void _c;
      await api("/api/admin/accounting/settings", { method: "PUT", body: JSON.stringify(body) });
      onSaved({ ...form, configured: true });
      toast.success("Accounting settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-5 p-6 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Accounting system</Label>
          <select className={selectClass} value={form.system} onChange={(e) => set("system", e.target.value)}>
            <option value="quickbooks_online">QuickBooks Online</option>
            <option value="generic_csv">Generic CSV</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Basis</Label>
          <select className={selectClass} value={form.basis} onChange={(e) => set("basis", e.target.value as Settings["basis"])}>
            <option value="cash">Cash</option>
            <option value="accrual">Accrual</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acct-start">Start date (go-live)</Label>
          <Input id="acct-start" type="date" value={form.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} />
          <p className="text-xs text-muted-foreground">Required before any deposit can be created. Gifts dated before this are never sent to accounting.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Entry type (QuickBooks)</Label>
          <select className={selectClass} value={form.entryType} onChange={(e) => set("entryType", e.target.value as Settings["entryType"])}>
            <option value="deposit">Deposit (best for bank-feed matching)</option>
            <option value="journal_entry">Journal entry</option>
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Catch-all income account</Label>
          <AccountSelect value={form.unmappedAccountId} accounts={accounts} onChange={(v) => set("unmappedAccountId", v)} placeholder="None selected" />
          <p className="text-xs text-muted-foreground">Gifts to a campaign with no mapping post here and are always flagged.</p>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4 sm:col-span-2">
          <div>
            <p className="text-sm font-medium">Sync automatically every night</p>
            <p className="text-xs text-muted-foreground">Takes effect once the QuickBooks connection is set up.</p>
          </div>
          <Switch checked={form.autoSyncEnabled} onCheckedChange={(v) => set("autoSyncEnabled", v)} />
        </div>
        <div className="sm:col-span-2">
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save settings</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartTab({ accounts, classes, reload }: { accounts: Account[]; classes: Klass[]; reload: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<"account" | "class" | null>(null);
  const accountFile = useRef<HTMLInputElement>(null);
  const classFile = useRef<HTMLInputElement>(null);

  async function upload(kind: "account" | "class", file: File) {
    setBusy(kind);
    try {
      const parsed = parseCsv(await file.text());
      const rows = parsed
        .filter((r) => r.name)
        .map((r) => ({ name: r.name, number: r.number || null, type: r.type || null, active: !isInactive(r.active) }));
      if (rows.length === 0) throw new Error("No rows found. The CSV needs a header row with: name, number, type, active");
      const res = await api<{ created: number; updated: number }>("/api/admin/accounting/ledger", {
        method: "POST",
        body: JSON.stringify({ kind, rows }),
      });
      toast.success(`${res.created} added, ${res.updated} updated`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
      if (accountFile.current) accountFile.current.value = "";
      if (classFile.current) classFile.current.value = "";
    }
  }

  async function toggle(kind: "account" | "class", id: number, active: boolean) {
    try {
      await api("/api/admin/accounting/ledger", { method: "PATCH", body: JSON.stringify({ kind, id, active }) });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update");
    }
  }

  const needle = q.trim().toLowerCase();
  const shownAccounts = useMemo(() => accounts.filter((a) => !needle || a.name.toLowerCase().includes(needle) || (a.number ?? "").toLowerCase().includes(needle)), [accounts, needle]);
  const shownClasses = useMemo(() => classes.filter((c) => !needle || c.name.toLowerCase().includes(needle)), [classes, needle]);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-6">
          <p className="text-sm text-muted-foreground">
            Upload your chart of accounts and class list from QuickBooks as CSV. Columns: <code>name</code>, <code>number</code>, <code>type</code>, <code>active</code>. Uploading again updates matching rows and never deletes.
          </p>
          <div className="flex flex-wrap gap-3">
            <input ref={accountFile} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload("account", e.target.files[0])} />
            <input ref={classFile} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload("class", e.target.files[0])} />
            <Button variant="outline" disabled={busy !== null} onClick={() => accountFile.current?.click()}>
              {busy === "account" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Upload accounts CSV
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => classFile.current?.click()}>
              {busy === "class" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Upload classes CSV
            </Button>
          </div>
          <Input placeholder="Search accounts and classes…" value={q} onChange={(e) => setQ(e.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-4 py-3 text-sm font-medium">Accounts ({accounts.length})</div>
          {shownAccounts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{accounts.length === 0 ? "No accounts yet. Upload a CSV above." : "No matches."}</p>
          ) : (
            <ul className="divide-y">
              {shownAccounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className={a.active ? "" : "text-muted-foreground line-through"}>{a.number ? `${a.number} · ` : ""}{a.name}{a.type ? <span className="ml-2 text-xs text-muted-foreground">{a.type}</span> : null}</span>
                  <Switch checked={a.active} onCheckedChange={(v) => toggle("account", a.id, v)} aria-label={`Active: ${a.name}`} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-4 py-3 text-sm font-medium">Classes ({classes.length})</div>
          {shownClasses.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{classes.length === 0 ? "No classes yet. Classes are optional." : "No matches."}</p>
          ) : (
            <ul className="divide-y">
              {shownClasses.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className={c.active ? "" : "text-muted-foreground line-through"}>{c.name}</span>
                  <Switch checked={c.active} onCheckedChange={(v) => toggle("class", c.id, v)} aria-label={`Active: ${c.name}`} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FundsTab({ funds, setFunds, accounts, classes, accrual }: {
  funds: Fund[];
  setFunds: (f: Fund[]) => void;
  accounts: Account[];
  classes: Klass[];
  accrual: boolean;
}) {
  const [filter, setFilter] = useState<"all" | "unmapped" | "recent">("all");
  const [savingId, setSavingId] = useState<number | null>(null);

  const unmappedRecent = funds.filter((f) => f.incomeAccountId === null && f.giftsLast90Days > 0).length;
  const shown = funds.filter((f) => filter === "all" || (filter === "unmapped" ? f.incomeAccountId === null : f.giftsLast90Days > 0));

  async function update(fund: Fund, patch: Partial<Pick<Fund, "incomeAccountId" | "dimensionId" | "arAccountId">>) {
    const next = { ...fund, ...patch };
    const previous = funds;
    setFunds(funds.map((f) => (f.campaignId === fund.campaignId ? next : f)));
    setSavingId(fund.campaignId);
    try {
      await api("/api/admin/accounting/funds", {
        method: "PUT",
        body: JSON.stringify({ campaignId: next.campaignId, incomeAccountId: next.incomeAccountId, dimensionId: next.dimensionId, arAccountId: next.arAccountId }),
      });
    } catch (e) {
      setFunds(previous);
      toast.error(e instanceof Error ? e.message : "Could not save mapping");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {unmappedRecent > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {unmappedRecent} {unmappedRecent === 1 ? "fund" : "funds"} with recent gifts {unmappedRecent === 1 ? "is" : "are"} not mapped.
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {([["all", "All"], ["unmapped", "Unmapped"], ["recent", "Used in last 90 days"]] as const).map(([k, label]) => (
          <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>{label}</Button>
        ))}
      </div>
      <Card>
        <CardContent className="p-0">
          {accounts.length === 0 && (
            <p className="border-b p-4 text-sm text-muted-foreground">Upload your chart of accounts first (Chart of accounts tab) to choose accounts here.</p>
          )}
          {shown.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{funds.length === 0 ? "No campaigns yet. New campaigns appear here as unmapped automatically." : "Nothing matches this filter."}</p>
          ) : (
            <div className="divide-y">
              <div className={`hidden gap-3 px-4 py-2 text-xs font-medium text-muted-foreground md:grid ${accrual ? "md:grid-cols-[1.2fr_1fr_1fr_1fr]" : "md:grid-cols-[1.2fr_1fr_1fr]"}`}>
                <span>Fund (campaign)</span><span>Income account</span><span>Class</span>{accrual && <span>Receivable account</span>}
              </div>
              {shown.map((f) => (
                <div key={f.campaignId} className={`grid items-center gap-3 px-4 py-3 text-sm ${accrual ? "md:grid-cols-[1.2fr_1fr_1fr_1fr]" : "md:grid-cols-[1.2fr_1fr_1fr]"}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{f.name}</span>
                    {f.giftsLast90Days > 0 && <Badge variant="secondary">{f.giftsLast90Days} gifts / 90d</Badge>}
                    {savingId === f.campaignId && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  </div>
                  <AccountSelect value={f.incomeAccountId} accounts={accounts} onChange={(v) => update(f, { incomeAccountId: v })} />
                  <select className={selectClass} value={f.dimensionId ?? ""} onChange={(e) => update(f, { dimensionId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">No class</option>
                    {classes.filter((c) => c.active || c.id === f.dimensionId).map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (inactive)"}</option>)}
                  </select>
                  {accrual && <AccountSelect value={f.arAccountId} accounts={accounts} onChange={(v) => update(f, { arAccountId: v })} />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SourcesTab({ sources, setSources, accounts }: { sources: SourceRow[]; setSources: (s: SourceRow[]) => void; accounts: Account[] }) {
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function update(row: SourceRow, patch: Partial<Pick<SourceRow, "depositAccountId" | "feeAccountId">>) {
    const next = { ...row, ...patch };
    const previous = sources;
    setSources(sources.map((s) => (s.source === row.source ? next : s)));
    setSavingKey(row.source);
    try {
      await api("/api/admin/accounting/sources", {
        method: "PUT",
        body: JSON.stringify({ source: next.source, depositAccountId: next.depositAccountId, feeAccountId: next.feeAccountId }),
      });
    } catch (e) {
      setSources(previous);
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Card>
      <CardContent className="p-0">
        <p className="border-b p-4 text-sm text-muted-foreground">
          Choose the bank account each kind of payment is deposited into. Card and PayPal payouts can also have a fee account so processing fees are booked separately.
        </p>
        <div className="divide-y">
          {sources.map((s) => (
            <div key={s.source} className="grid items-center gap-3 px-4 py-3 text-sm md:grid-cols-[1.2fr_1fr_1fr]">
              <div className="flex items-center gap-2">
                <span className="font-medium">{SOURCE_LABELS[s.source] ?? s.source}</span>
                {savingKey === s.source && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              <AccountSelect value={s.depositAccountId} accounts={accounts} onChange={(v) => update(s, { depositAccountId: v })} placeholder="Deposit account" />
              {SOURCES_WITH_FEES.has(s.source) ? (
                <AccountSelect value={s.feeAccountId} accounts={accounts} onChange={(v) => update(s, { feeAccountId: v })} placeholder="Fee account" />
              ) : (
                <span className="text-xs text-muted-foreground">No fees</span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
