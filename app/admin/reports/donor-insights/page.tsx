"use client";

/**
 * /admin/reports/donor-insights — one hub for all donor-centric reports
 * (Phase 3): contribution, LYBUNT, SYBUNT, new, lapsed, consecutive-year.
 * Report type is a tab; each reads the same rollup API.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Bookmark, ChevronLeft, ChevronRight, Download, Loader2, Search, Trash2 } from "lucide-react";

const PAGE_SIZE = 50;
const REPORT_KEY = "donor-insights";

interface SavedView {
  id: number;
  name: string;
  params: { type?: string; year?: number; minAmount?: string; lapsedMonths?: string; search?: string };
}

const REPORTS = [
  { key: "contribution", label: "Donor Contribution", blurb: "Every donor's lifetime + yearly giving. Set a minimum to focus on major donors." },
  { key: "lybunt", label: "LYBUNT", blurb: "Gave LAST year but NOT this year — top win-back targets." },
  { key: "sybunt", label: "SYBUNT", blurb: "Gave in some prior year but NOT this year." },
  { key: "new", label: "New Donors", blurb: "First-ever gift landed in the selected year." },
  { key: "lapsed", label: "Lapsed", blurb: "No gift in the last N months." },
  { key: "consecutive", label: "Loyal (Multi-year)", blurb: "Gave this year and across multiple years — thank-you list." },
];

interface DonorRow {
  contact_id: number;
  donor_name: string;
  email: string | null;
  phone: string | null;
  constituents_id: string | null;
  lifetime_total: string;
  gift_count: number;
  first_gift_date: string | null;
  last_gift_date: string | null;
  this_year_total: string;
  last_year_total: string;
  distinct_years: number;
}

const money = (v: string | number) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
    : "—";
};

export default function DonorInsightsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const nowYear = new Date().getUTCFullYear();

  const [type, setType] = useState("contribution");
  const [year, setYear] = useState(nowYear);
  const [minAmount, setMinAmount] = useState("");
  const [lapsedMonths, setLapsedMonths] = useState("12");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<DonorRow[] | null>(null);
  const [totalDonors, setTotalDonors] = useState(0);
  const [lifetimeSum, setLifetimeSum] = useState("0");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savingView, setSavingView] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const loadSavedViews = useCallback(async () => {
    const res = await fetch(`/api/reports/saved?reportKey=${REPORT_KEY}`, { cache: "no-store" });
    if (res.ok) setSavedViews((await res.json()).saved ?? []);
  }, []);

  async function saveView() {
    const name = window.prompt("Name this saved view:");
    if (!name?.trim()) return;
    setSavingView(true);
    try {
      const res = await fetch("/api/reports/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportKey: REPORT_KEY, name: name.trim(), params: { type, year, minAmount, lapsedMonths, search } }),
      });
      if (!res.ok) { toast.error(`Could not save (HTTP ${res.status})`); return; }
      toast.success(`Saved "${name.trim()}"`);
      await loadSavedViews();
    } finally { setSavingView(false); }
  }

  function applyView(v: SavedView) {
    const p = v.params ?? {};
    if (p.type) setType(p.type);
    if (p.year) setYear(Number(p.year));
    setMinAmount(p.minAmount ?? "");
    setLapsedMonths(p.lapsedMonths ?? "12");
    setSearch(p.search ?? "");
  }

  async function deleteView(id: number) {
    const res = await fetch(`/api/reports/saved?id=${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Could not delete"); return; }
    await loadSavedViews();
  }

  const buildUrl = useCallback(
    (extra: Record<string, string> = {}) => {
      const u = new URL("/api/reports/donor-insights", window.location.origin);
      u.searchParams.set("type", type);
      u.searchParams.set("year", String(year));
      if (minAmount && type === "contribution") u.searchParams.set("minAmount", minAmount);
      if (type === "lapsed") u.searchParams.set("lapsedMonths", lapsedMonths);
      if (search) u.searchParams.set("search", search);
      for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
      return u;
    },
    [type, year, minAmount, lapsedMonths, search],
  );

  const load = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      const u = buildUrl({ page: String(pageNum), limit: String(PAGE_SIZE) });
      const res = await fetch(u.toString(), { cache: "no-store" });
      if (!res.ok) { toast.error(`Failed to load (HTTP ${res.status})`); return; }
      const body = await res.json();
      setRows(body.donors ?? []);
      setTotalDonors(Number(body.totalDonors ?? 0));
      setLifetimeSum(String(body.lifetimeSum ?? "0"));
      setPage(pageNum);
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/auth/login"); return; }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      router.push("/contacts"); return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => void load(1), 300);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, year, minAmount, lapsedMonths, search, session, status]);

  useEffect(() => {
    if (session && (session.user.role === "admin" || session.user.role === "super_admin")) void loadSavedViews();
  }, [session, loadSavedViews]);

  async function exportCsv() {
    setExporting(true);
    try {
      const u = buildUrl({ export: "csv" });
      const res = await fetch(u.toString());
      if (!res.ok) { toast.error(`Export failed (HTTP ${res.status})`); return; }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${type}-${year}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally { setExporting(false); }
  }

  const totalPages = Math.max(1, Math.ceil(totalDonors / PAGE_SIZE));
  const active = REPORTS.find((r) => r.key === type)!;
  const years = Array.from({ length: 12 }, (_, i) => nowYear - i);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <Link href="/admin/reports" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Reports
        </Link>
        <div className="flex items-center justify-between mt-2 gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">Donor Insights</h1>
          <Button variant="outline" size="sm" onClick={() => void saveView()} disabled={savingView} className="gap-2">
            {savingView ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />} Save this view
          </Button>
        </div>
      </div>

      {savedViews.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase text-muted-foreground">Saved views:</span>
          {savedViews.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm bg-background">
              <button onClick={() => applyView(v)} className="hover:underline">{v.name}</button>
              <button onClick={() => void deleteView(v.id)} className="text-muted-foreground hover:text-red-600" title="Delete"><Trash2 className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}

      {/* Report-type tabs */}
      <div className="flex flex-wrap gap-2">
        {REPORTS.map((r) => (
          <button
            key={r.key}
            onClick={() => setType(r.key)}
            className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
              type === r.key ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted/50 border-border"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground -mt-3">{active.blurb}</p>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Year</div>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="border rounded-md px-3 py-2 text-sm bg-background">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {type === "contribution" && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">Min lifetime ($)</div>
              <Input value={minAmount} onChange={(e) => setMinAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className="w-32" />
            </div>
          )}
          {type === "lapsed" && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">No gift in (months)</div>
              <Input value={lapsedMonths} onChange={(e) => setLapsedMonths(e.target.value.replace(/[^0-9]/g, ""))} className="w-24" />
            </div>
          )}
          <div className="flex-1 min-w-[200px]">
            <div className="text-xs uppercase text-muted-foreground mb-1">Search</div>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name / email / phone / Partner ID" className="pl-9" />
            </div>
          </div>
          <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting || !rows} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export CSV
          </Button>
        </CardContent>
      </Card>

      <div className="text-sm text-muted-foreground">
        {rows ? `${totalDonors.toLocaleString()} donor${totalDonors === 1 ? "" : "s"} · ${money(lifetimeSum)} lifetime total` : "Loading…"}
      </div>

      <Card>
        <CardContent className="p-0">
          {!rows ? (
            <div className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No donors match this report.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Donor</th>
                    <th className="text-left px-4 py-2">Email</th>
                    <th className="text-left px-4 py-2">Phone</th>
                    <th className="text-right px-4 py-2">Lifetime</th>
                    <th className="text-right px-4 py-2">Gifts</th>
                    <th className="text-right px-4 py-2">{year}</th>
                    <th className="text-right px-4 py-2">{year - 1}</th>
                    <th className="text-left px-4 py-2">Last gift</th>
                    <th className="text-right px-4 py-2">Years</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.contact_id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/contacts/${d.contact_id}`} className="hover:underline">{d.donor_name || "(no name)"}</Link>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{d.email ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{d.phone ?? "—"}</td>
                      <td className="px-4 py-2 text-right font-medium">{money(d.lifetime_total)}</td>
                      <td className="px-4 py-2 text-right">{d.gift_count}</td>
                      <td className="px-4 py-2 text-right">{money(d.this_year_total)}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{money(d.last_year_total)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{d.last_gift_date ?? "—"}</td>
                      <td className="px-4 py-2 text-right">{d.distinct_years}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {rows && totalDonors > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <div className="text-muted-foreground">Page {page} of {totalPages.toLocaleString()}</div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load(page - 1)} disabled={loading || page <= 1} className="gap-1">
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load(page + 1)} disabled={loading || page >= totalPages} className="gap-1">
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
