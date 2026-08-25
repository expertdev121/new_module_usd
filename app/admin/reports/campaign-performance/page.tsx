"use client";

/**
 * /admin/reports/campaign-performance (Phase 5) — raised per fund/campaign
 * for a year vs the prior year, with fund codes recovered from notes.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Download, Loader2, Minus } from "lucide-react";

interface CampaignRow {
  fund: string;
  raised: string;
  donors: number;
  gifts: number;
  prior_raised: string;
  prior_donors: number;
}

const money = (v: string | number) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n) : "—";
};

function Delta({ cur, prior }: { cur: number; prior: number }) {
  const pct = prior === 0 ? (cur > 0 ? 100 : 0) : ((cur - prior) / prior) * 100;
  const r = Math.round(pct);
  if (!Number.isFinite(pct) || r === 0) return <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="h-3 w-3" />0%</span>;
  const up = pct > 0;
  return <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-emerald-600" : "text-red-600"}`}>{up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(r)}%</span>;
}

export default function CampaignPerformancePage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const nowYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(nowYear);
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [totalRaised, setTotalRaised] = useState(0);
  const [totalPrior, setTotalPrior] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tagId, setTagId] = useState<number | null>(null);
  const [tags, setTags] = useState<{ id: number; name: string }[]>([]);

  const load = useCallback(async (y: number, tag: number | null) => {
    setLoading(true);
    try {
      const url = `/api/reports/campaigns?year=${y}${tag != null ? `&tagId=${tag}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) { toast.error(`Failed to load (HTTP ${res.status})`); return; }
      const body = await res.json();
      setRows(body.campaigns ?? []);
      setTotalRaised(Number(body.totalRaised ?? 0));
      setTotalPrior(Number(body.totalPrior ?? 0));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/auth/login"); return; }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") { router.push("/contacts"); return; }
    void load(year, tagId);
  }, [session, status, year, tagId, router, load]);

  // Donor-tag list for the filter dropdown (best-effort; empty on 403).
  useEffect(() => {
    if (!session) return;
    fetch("/api/tags?limit=1000&isActive=true", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { tags: [] }))
      .then((b) => setTags((b.tags ?? []).map((t: { id: number; name: string }) => ({ id: t.id, name: t.name }))))
      .catch(() => {});
  }, [session]);

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await fetch(`/api/reports/campaigns?year=${year}&export=csv${tagId != null ? `&tagId=${tagId}` : ""}`);
      if (!res.ok) { toast.error(`Export failed (HTTP ${res.status})`); return; }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `campaign-performance-${year}.csv`; a.click();
      URL.revokeObjectURL(a.href);
    } finally { setExporting(false); }
  }

  const years = Array.from({ length: 12 }, (_, i) => nowYear - i);
  const maxRaised = Math.max(1, ...(rows ?? []).map((r) => parseFloat(r.raised)));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <Link href="/admin/reports" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Reports
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Campaign Performance</h1>
        <p className="text-sm text-muted-foreground">Raised per fund/campaign, {year} vs {year - 1}. Fund codes are recovered from imported donation notes.</p>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Year</div>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="border rounded-md px-3 py-2 text-sm bg-background">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {tags.length > 0 && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">Donor tag</div>
              <select
                value={tagId ?? ""}
                onChange={(e) => setTagId(e.target.value ? Number(e.target.value) : null)}
                className="border rounded-md px-3 py-2 text-sm bg-background"
              >
                <option value="">All tags</option>
                {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex-1" />
          <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting || !rows} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export CSV
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">{year} raised</div><div className="text-2xl font-semibold mt-1">{money(totalRaised)}</div><div className="mt-1"><Delta cur={totalRaised} prior={totalPrior} /> <span className="text-xs text-muted-foreground">vs {year - 1}</span></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">{year - 1} raised</div><div className="text-2xl font-semibold mt-1">{money(totalPrior)}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {!rows ? (
            <div className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No campaign data for {year}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Fund / Campaign</th>
                    <th className="text-right px-4 py-2">{year} Raised</th>
                    <th className="text-right px-4 py-2">Donors</th>
                    <th className="text-right px-4 py-2">Gifts</th>
                    <th className="text-right px-4 py-2">{year - 1}</th>
                    <th className="text-right px-4 py-2">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c, i) => {
                    const cur = parseFloat(c.raised), pri = parseFloat(c.prior_raised);
                    return (
                      <tr key={c.fund + i} className="border-t hover:bg-muted/20">
                        <td className="px-4 py-2">
                          <div className="font-medium">{c.fund}</div>
                          <div className="h-1.5 rounded-full bg-muted mt-1 overflow-hidden" style={{ maxWidth: 220 }}>
                            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(2, (cur / maxRaised) * 100)}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-medium">{money(cur)}</td>
                        <td className="px-4 py-2 text-right">{c.donors}</td>
                        <td className="px-4 py-2 text-right">{c.gifts}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{money(pri)}</td>
                        <td className="px-4 py-2 text-right"><Delta cur={cur} prior={pri} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
