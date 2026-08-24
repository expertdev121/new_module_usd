"use client";

/**
 * /donations — the all-donations ledger for the admin's location.
 * One row per donation across BOTH ledgers (manual_donation + payment),
 * searchable by donor name / email / phone / Partner ID, with CSV export.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Search,
} from "lucide-react";

const PAGE_SIZE = 50;

interface DonationRow {
  source: "manual_donation" | "payment";
  donationId: number;
  contactId: number;
  donorName: string;
  email: string | null;
  phone: string | null;
  constituentsId: string | null;
  amount: string;
  currency: string;
  paymentDate: string;
  paymentMethod: string | null;
  paymentStatus: string;
  campaignName: string | null;
  referenceNumber: string | null;
}

interface StatusSummary {
  status: string;
  count: number;
  gross: string;
  net: string;
}

function fmtMoney(amount: string, currency: string) {
  const v = parseFloat(amount);
  if (!Number.isFinite(v)) return amount;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

// Statuses that don't count toward revenue (mirrors NON_REVENUE_STATUSES on
// the server). Used to tint the pill red and to label the total.
const NON_REVENUE = new Set(["refunded", "failed", "cancelled"]);

// Colored pill per payment status so refunded/successful reads at a glance.
function statusPillClass(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "completed" || s === "succeeded" || s === "success")
    return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20";
  if (s === "refunded")
    return "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20";
  if (s === "failed" || s === "cancelled")
    return "bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-500/20";
  if (s === "pending" || s === "processing" || s === "expected")
    return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20";
  return "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20";
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusPillClass(status)}`}
    >
      {status || "—"}
    </span>
  );
}

export default function DonationsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [rows, setRows] = useState<DonationRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState("0");
  const [statusSummary, setStatusSummary] = useState<StatusSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<number | null>(null);
  const [tags, setTags] = useState<{ id: number; name: string }[]>([]);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const load = useCallback(
    async (opts: { q?: string; pageNum?: number; status?: string | null; tagId?: number | null } = {}) => {
      const q = opts.q ?? "";
      const pageNum = opts.pageNum ?? 1;
      const status = opts.status ?? null;
      const tagId = opts.tagId ?? null;
      setLoading(true);
      try {
        const url = new URL("/api/donations", window.location.origin);
        if (q) url.searchParams.set("search", q);
        if (status) url.searchParams.set("status", status);
        if (tagId != null) url.searchParams.set("tagId", String(tagId));
        url.searchParams.set("page", String(pageNum));
        url.searchParams.set("limit", String(PAGE_SIZE));
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) {
          toast.error(`Failed to load donations (HTTP ${res.status})`);
          return;
        }
        const body = await res.json();
        setRows(body.donations ?? []);
        setTotal(Number(body.total ?? 0));
        setTotalAmount(String(body.totalAmount ?? "0"));
        setStatusSummary(Array.isArray(body.statusSummary) ? body.statusSummary : []);
        setPage(pageNum);
        setActiveSearch(q);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/login");
      return;
    }
    void load();
    // Tag list for the filter dropdown (donor tags). Best-effort.
    fetch("/api/tags?limit=1000&isActive=true", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { tags: [] }))
      .then((b) => setTags((b.tags ?? []).map((t: { id: number; name: string }) => ({ id: t.id, name: t.name }))))
      .catch(() => {});
  }, [router, session, status, load]);

  // Debounced live search.
  useEffect(() => {
    if (status === "loading" || !session) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void load({ q: search, pageNum: 1, status: statusFilter, tagId: tagFilter });
    }, 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Selecting a status chip filters the ledger immediately.
  function selectStatus(status: string | null) {
    const next = statusFilter === status ? null : status;
    setStatusFilter(next);
    void load({ q: search, pageNum: 1, status: next, tagId: tagFilter });
  }

  // Selecting a donor tag filters the ledger to donations by tagged donors.
  function selectTag(tagId: number | null) {
    setTagFilter(tagId);
    void load({ q: search, pageNum: 1, status: statusFilter, tagId });
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const url = new URL("/api/donations", window.location.origin);
      url.searchParams.set("export", "csv");
      if (activeSearch) url.searchParams.set("search", activeSearch);
      if (statusFilter) url.searchParams.set("status", statusFilter);
      if (tagFilter != null) url.searchParams.set("tagId", String(tagFilter));
      const res = await fetch(url.toString());
      if (!res.ok) {
        toast.error(`Export failed (HTTP ${res.status})`);
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `donations-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
            <Banknote className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Donations</h1>
            <p className="text-sm text-muted-foreground">
              {rows
                ? `${total.toLocaleString()} donation${total === 1 ? "" : "s"} · ${fmtMoney(totalAmount, "USD")} net${activeSearch ? ` matching "${activeSearch}"` : ""}`
                : "Loading…"}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => void exportCsv()}
          disabled={exporting || !rows}
          className="gap-2"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export CSV
        </Button>
      </header>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by donor name, email, phone, or Partner ID…"
                className="pl-9"
              />
            </div>
            {/* Filter by donor tag — spans both ledgers via the donor's tags. */}
            {tags.length > 0 && (
              <select
                value={tagFilter ?? ""}
                onChange={(e) => selectTag(e.target.value ? Number(e.target.value) : null)}
                className="h-9 rounded-md border bg-background px-3 text-sm text-foreground sm:w-52"
                title="Filter donations by donor tag"
              >
                <option value="">All tags</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Status filter chips — click to filter; each shows its amount.
              Refunded/failed/cancelled show the amount they REMOVE from revenue. */}
          {statusSummary.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => selectStatus(null)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  statusFilter === null
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-border bg-background text-foreground hover:bg-muted"
                }`}
              >
                All
              </button>
              {statusSummary.map((s) => {
                const active = statusFilter === s.status;
                const nonRevenue = NON_REVENUE.has((s.status || "").toLowerCase());
                const shown = nonRevenue ? s.gross : s.net;
                return (
                  <button
                    key={s.status}
                    type="button"
                    onClick={() => selectStatus(s.status)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                      active
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-border bg-background text-foreground hover:bg-muted"
                    }`}
                    title={
                      nonRevenue
                        ? `${s.count} ${s.status} · ${fmtMoney(s.gross, "USD")} (excluded from revenue)`
                        : `${s.count} ${s.status} · ${fmtMoney(s.net, "USD")}`
                    }
                  >
                    <span>{s.status}</span>
                    <span className={active ? "text-white/90" : "text-muted-foreground"}>
                      {nonRevenue ? "−" : ""}
                      {fmtMoney(shown, "USD")}
                    </span>
                    <span className={`rounded-full px-1.5 text-[10px] ${active ? "bg-white/20" : "bg-muted"}`}>
                      {s.count.toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {!rows ? (
            <div className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading donations…
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {activeSearch ? `No donations match "${activeSearch}".` : "No donations yet."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-left px-4 py-2">Donor</th>
                    <th className="text-left px-4 py-2">Email</th>
                    <th className="text-left px-4 py-2">Phone</th>
                    <th className="text-left px-4 py-2">Partner ID</th>
                    <th className="text-right px-4 py-2">Amount</th>
                    <th className="text-left px-4 py-2">Method</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-left px-4 py-2">Campaign</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr
                      key={`${d.source}-${d.donationId}`}
                      className="border-t hover:bg-muted/20"
                    >
                      <td className="px-4 py-2 whitespace-nowrap">{d.paymentDate}</td>
                      <td className="px-4 py-2 font-medium">
                        <Link
                          href={`/contacts/${d.contactId}`}
                          className="hover:underline"
                        >
                          {d.donorName}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{d.email ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{d.phone ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{d.constituentsId ?? "—"}</td>
                      <td className="px-4 py-2 text-right font-medium whitespace-nowrap">
                        {fmtMoney(d.amount, d.currency)}
                      </td>
                      <td className="px-4 py-2 capitalize">{(d.paymentMethod ?? "—").replace(/_/g, " ")}</td>
                      <td className="px-4 py-2">
                        <StatusPill status={d.paymentStatus} />
                      </td>
                      <td className="px-4 py-2 text-muted-foreground truncate max-w-[160px]">{d.campaignName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {rows && total > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-sm">
          <div className="text-muted-foreground">
            Page {page} of {totalPages.toLocaleString()} · showing{" "}
            {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load({ q: activeSearch, pageNum: page - 1, status: statusFilter, tagId: tagFilter })}
              disabled={loading || page <= 1}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load({ q: activeSearch, pageNum: page + 1, status: statusFilter, tagId: tagFilter })}
              disabled={loading || page >= totalPages}
              className="gap-1"
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
