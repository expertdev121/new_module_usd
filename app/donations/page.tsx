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

export default function DonationsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [rows, setRows] = useState<DonationRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState("0");
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const load = useCallback(async (opts: { q?: string; pageNum?: number } = {}) => {
    const q = opts.q ?? "";
    const pageNum = opts.pageNum ?? 1;
    setLoading(true);
    try {
      const url = new URL("/api/donations", window.location.origin);
      if (q) url.searchParams.set("search", q);
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
      setPage(pageNum);
      setActiveSearch(q);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/login");
      return;
    }
    void load();
  }, [router, session, status, load]);

  // Debounced live search.
  useEffect(() => {
    if (status === "loading" || !session) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void load({ q: search, pageNum: 1 });
    }, 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function exportCsv() {
    setExporting(true);
    try {
      const url = new URL("/api/donations", window.location.origin);
      url.searchParams.set("export", "csv");
      if (activeSearch) url.searchParams.set("search", activeSearch);
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
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
            <Banknote className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Donations</h1>
            <p className="text-sm text-muted-foreground">
              {rows
                ? `${total.toLocaleString()} donation${total === 1 ? "" : "s"} · ${fmtMoney(totalAmount, "USD")} total${activeSearch ? ` matching "${activeSearch}"` : ""}`
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
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by donor name, email, phone, or Partner ID…"
              className="pl-9"
            />
          </div>
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
                      <td className="px-4 py-2 capitalize">{d.paymentStatus}</td>
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
              onClick={() => void load({ q: activeSearch, pageNum: page - 1 })}
              disabled={loading || page <= 1}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load({ q: activeSearch, pageNum: page + 1 })}
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
