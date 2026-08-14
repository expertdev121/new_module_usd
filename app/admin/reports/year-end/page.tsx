"use client";

/**
 * /admin/reports/year-end (Phase 4) — annual giving statements for tax
 * season. Per-donor annual total for a year; export CSV for the whole
 * set, or open one donor to see the itemized gifts behind the number.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Loader2, Receipt } from "lucide-react";

const PAGE_SIZE = 50;

interface StatementRow {
  contact_id: number;
  donor_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  annual_total: string;
  gift_count: number;
}
interface ItemRow { payment_date: string; amount: string; currency: string; payment_method: string | null; campaign_name: string | null; reference_number: string | null; }

const money = (v: string | number) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n) : "—";
};

export default function YearEndPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const lastYear = new Date().getUTCFullYear() - 1;
  const [year, setYear] = useState(lastYear);
  const [rows, setRows] = useState<StatementRow[] | null>(null);
  const [totalDonors, setTotalDonors] = useState(0);
  const [totalRaised, setTotalRaised] = useState("0");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<{ donor: StatementRow; items: ItemRow[] } | null>(null);

  const load = useCallback(async (y: number, pageNum: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/year-end?year=${y}&page=${pageNum}&limit=${PAGE_SIZE}`, { cache: "no-store" });
      if (!res.ok) { toast.error(`Failed to load (HTTP ${res.status})`); return; }
      const body = await res.json();
      setRows(body.donors ?? []);
      setTotalDonors(Number(body.totalDonors ?? 0));
      setTotalRaised(String(body.totalRaised ?? "0"));
      setPage(pageNum);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/auth/login"); return; }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") { router.push("/contacts"); return; }
    void load(year, 1);
  }, [session, status, year, router, load]);

  async function openDonor(row: StatementRow) {
    const res = await fetch(`/api/reports/year-end?year=${year}&contactId=${row.contact_id}`, { cache: "no-store" });
    if (!res.ok) { toast.error("Failed to load statement"); return; }
    const body = await res.json();
    setDetail({ donor: row, items: body.items ?? [] });
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await fetch(`/api/reports/year-end?year=${year}&export=csv`);
      if (!res.ok) { toast.error(`Export failed (HTTP ${res.status})`); return; }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `year-end-statements-${year}.csv`; a.click();
      URL.revokeObjectURL(a.href);
    } finally { setExporting(false); }
  }

  const totalPages = Math.max(1, Math.ceil(totalDonors / PAGE_SIZE));
  const years = Array.from({ length: 12 }, (_, i) => new Date().getUTCFullYear() - i);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <Link href="/admin/reports" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Reports
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Year-End Giving Statements</h1>
        <p className="text-sm text-muted-foreground">Each donor&apos;s total giving for the year — for tax letters. Click a donor to see the itemized gifts.</p>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Tax year</div>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="border rounded-md px-3 py-2 text-sm bg-background">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex-1" />
          <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting || !rows} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export all statements (CSV)
          </Button>
        </CardContent>
      </Card>

      <div className="text-sm text-muted-foreground">
        {rows ? `${totalDonors.toLocaleString()} donor${totalDonors === 1 ? "" : "s"} gave in ${year} · ${money(totalRaised)} total` : "Loading…"}
      </div>

      <Card>
        <CardContent className="p-0">
          {!rows ? (
            <div className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No donations in {year}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Donor</th>
                    <th className="text-left px-4 py-2">Email</th>
                    <th className="text-left px-4 py-2">Address</th>
                    <th className="text-right px-4 py-2">{year} Total</th>
                    <th className="text-right px-4 py-2">Gifts</th>
                    <th className="text-right px-4 py-2">Statement</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.contact_id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium"><Link href={`/contacts/${d.contact_id}`} className="hover:underline">{d.donor_name || "(no name)"}</Link></td>
                      <td className="px-4 py-2 text-muted-foreground">{d.email ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground truncate max-w-[220px]">{d.address ?? "—"}</td>
                      <td className="px-4 py-2 text-right font-medium">{money(d.annual_total)}</td>
                      <td className="px-4 py-2 text-right">{d.gift_count}</td>
                      <td className="px-4 py-2 text-right">
                        <Button variant="ghost" size="sm" className="gap-1" onClick={() => void openDonor(d)}><Receipt className="h-3.5 w-3.5" /> View</Button>
                      </td>
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
            <Button variant="outline" size="sm" onClick={() => void load(year, page - 1)} disabled={loading || page <= 1} className="gap-1"><ChevronLeft className="h-4 w-4" /> Previous</Button>
            <Button variant="outline" size="sm" onClick={() => void load(year, page + 1)} disabled={loading || page >= totalPages} className="gap-1">Next <ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* Itemized statement drawer */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
          <div className="bg-background rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b">
              <div className="text-lg font-semibold">{detail.donor.donor_name}</div>
              <div className="text-sm text-muted-foreground">{detail.donor.email ?? ""}</div>
              <div className="text-sm mt-1">{year} total: <span className="font-semibold">{money(detail.donor.annual_total)}</span> across {detail.donor.gift_count} gift{detail.donor.gift_count === 1 ? "" : "s"}</div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr><th className="text-left px-4 py-2">Date</th><th className="text-right px-4 py-2">Amount</th><th className="text-left px-4 py-2">Method</th><th className="text-left px-4 py-2">Campaign</th></tr>
              </thead>
              <tbody>
                {detail.items.map((it, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-4 py-2">{it.payment_date}</td>
                    <td className="px-4 py-2 text-right">{money(it.amount)}</td>
                    <td className="px-4 py-2 capitalize">{(it.payment_method ?? "—").replace(/_/g, " ")}</td>
                    <td className="px-4 py-2 text-muted-foreground">{it.campaign_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-4 flex justify-end"><Button variant="outline" onClick={() => setDetail(null)}>Close</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
