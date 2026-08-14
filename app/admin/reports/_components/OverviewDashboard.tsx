"use client";

/**
 * Reports Overview dashboard (Phase 2).
 * KPI tiles (vs prior period) + monthly trend chart + top donors /
 * campaigns / payment-method widgets. All data from /api/reports/overview
 * (canonical source). Charts via chart.js/react-chartjs-2.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Filler,
  type ChartOptions,
} from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Loader2,
  Minus,
  Receipt,
  TrendingUp,
  Users,
} from "lucide-react";

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, BarElement,
  ArcElement, Tooltip, Filler,
);

interface OverviewData {
  period: { preset: string; start: string; end: string };
  kpis: {
    raised: number; raisedPriorPct: number;
    donations: number; donationsPriorPct: number;
    donors: number; donorsPriorPct: number;
    avgGift: number; avgGiftPriorPct: number;
  };
  trend: { month: string; raised: string; donations: number }[];
  topDonors: { contact_id: number; donor_name: string; total: string; gifts: number }[];
  topCampaigns: { campaign: string; total: string; donations: number }[];
  byMethod: { method: string; total: string; donations: number }[];
}

const PRESETS = [
  { key: "this_month", label: "This month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "ytd", label: "Year to date" },
  { key: "last_year", label: "Last year" },
  { key: "last_12m", label: "Last 12 months" },
  { key: "all", label: "All time" },
];

const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v || 0);
const moneyFull = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v || 0);
const num = (v: number) => new Intl.NumberFormat("en-US").format(v || 0);

// Cohesive categorical palette (light + dark safe).
const PALETTE = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#65a30d"];

function DeltaPill({ pct }: { pct: number }) {
  const rounded = Math.round(pct);
  if (!Number.isFinite(pct) || rounded === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> 0%
      </span>
    );
  }
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-emerald-600" : "text-red-600"}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(rounded)}%
    </span>
  );
}

function Kpi({ icon, label, value, pct }: { icon: React.ReactNode; label: string; value: string; pct: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-muted-foreground">{icon}</div>
        </div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
        <div className="mt-1 flex items-center gap-1">
          <DeltaPill pct={pct} />
          <span className="text-xs text-muted-foreground">vs prior period</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function OverviewDashboard() {
  const [preset, setPreset] = useState("last_12m");
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/overview?preset=${p}`, { cache: "no-store" });
      if (!res.ok) return;
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(preset); }, [preset, load]);

  const trendChart = useMemo(() => {
    const t = data?.trend ?? [];
    return {
      labels: t.map((r) => {
        const [y, m] = r.month.split("-");
        return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      }),
      datasets: [{
        label: "Raised",
        data: t.map((r) => parseFloat(r.raised)),
        backgroundColor: "#4f46e5",
        borderRadius: 4,
        maxBarThickness: 26,
      }],
    };
  }, [data]);

  const trendOptions: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (c) => money(c.parsed.y) } },
    },
    scales: {
      x: { grid: { display: false } },
      y: { ticks: { callback: (v) => money(Number(v)) }, grid: { color: "rgba(120,120,120,0.12)" } },
    },
  };

  const methodChart = useMemo(() => {
    const m = data?.byMethod ?? [];
    return {
      labels: m.map((r) => r.method.replace(/_/g, " ")),
      datasets: [{
        data: m.map((r) => parseFloat(r.total)),
        backgroundColor: m.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 0,
      }],
    };
  }, [data]);

  const methodOptions: ChartOptions<"doughnut"> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "62%",
    plugins: {
      legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: { label: (c) => `${c.label}: ${money(Number(c.parsed))}` } },
    },
  };

  const maxCampaign = useMemo(
    () => Math.max(1, ...(data?.topCampaigns ?? []).map((c) => parseFloat(c.total))),
    [data],
  );

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
              preset === p.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-muted/50 border-border"
            }`}
          >
            {p.label}
          </button>
        ))}
        {loading && <Loader2 className="h-4 w-4 animate-spin self-center text-muted-foreground" />}
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={<Banknote className="h-4 w-4" />} label="Total raised" value={data ? money(data.kpis.raised) : "—"} pct={data?.kpis.raisedPriorPct ?? 0} />
        <Kpi icon={<Receipt className="h-4 w-4" />} label="Donations" value={data ? num(data.kpis.donations) : "—"} pct={data?.kpis.donationsPriorPct ?? 0} />
        <Kpi icon={<Users className="h-4 w-4" />} label="Unique donors" value={data ? num(data.kpis.donors) : "—"} pct={data?.kpis.donorsPriorPct ?? 0} />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Average gift" value={data ? moneyFull(data.kpis.avgGift) : "—"} pct={data?.kpis.avgGiftPriorPct ?? 0} />
      </div>

      {/* Trend chart */}
      <Card>
        <CardContent className="p-5">
          <div className="text-sm font-medium mb-3">Monthly giving — last 24 months</div>
          <div className="h-64">
            {data ? <Bar data={trendChart} options={trendOptions} /> : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Widgets row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top donors */}
        <Card className="lg:col-span-1">
          <CardContent className="p-5">
            <div className="text-sm font-medium mb-3">Top donors</div>
            {!data ? (
              <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
            ) : data.topDonors.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">No donations in this period.</div>
            ) : (
              <ul className="space-y-2">
                {data.topDonors.map((d) => (
                  <li key={d.contact_id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/contacts/${d.contact_id}`} className="truncate hover:underline">
                      {d.donor_name || "(no name)"}
                    </Link>
                    <span className="font-medium whitespace-nowrap">{money(parseFloat(d.total))}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Top campaigns */}
        <Card className="lg:col-span-1">
          <CardContent className="p-5">
            <div className="text-sm font-medium mb-3">Top campaigns</div>
            {!data ? (
              <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
            ) : data.topCampaigns.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">No campaign data.</div>
            ) : (
              <ul className="space-y-3">
                {data.topCampaigns.map((c, i) => {
                  const val = parseFloat(c.total);
                  const w = Math.max(3, (val / maxCampaign) * 100);
                  return (
                    <li key={c.campaign + i}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="truncate">{c.campaign}</span>
                        <span className="font-medium whitespace-nowrap ml-2">{money(val)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${w}%`, backgroundColor: PALETTE[i % PALETTE.length] }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* By method */}
        <Card className="lg:col-span-1">
          <CardContent className="p-5">
            <div className="text-sm font-medium mb-3">Giving by payment method</div>
            {!data ? (
              <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
            ) : data.byMethod.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">No data.</div>
            ) : (
              <div className="h-56">
                <Doughnut data={methodChart} options={methodOptions} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
