"use client";

/**
 * At-a-glance dashboard — a single, opinionated overview built entirely on
 * the canonical donations engine (/api/dashboard/summary), so every number
 * reconciles with the Reports and the Donations ledger.
 *
 * No tabs, no date filter, no exports, no pledges. Hero KPIs headline
 * ALL-TIME totals with a this-year-vs-last-year delta; the mid-page widgets
 * show the last 12 months of activity. Every block hides itself when the
 * tenant has no data for it, so donation-only orgs never see dead cards.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GhlInstallPromptBanner } from "@/components/ghl/install-prompt-banner";
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Tooltip, Legend, Filler,
} from "chart.js";
import type { TooltipItem } from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";
import {
  ArrowDownRight, ArrowUpRight, Minus, Users, HeartHandshake, TrendingUp,
  Receipt, Target, CalendarCheck, DollarSign, Activity, UserPlus, UserMinus, RefreshCw,
} from "lucide-react";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend, Filler);

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#3b82f6", "#eab308", "#06b6d4"];

interface Kpi { allTime: number; thisYear: number; lastYear: number; yoyPct: number }
interface Summary {
  orgName: string | null;
  year: number;
  kpis: { raised: Kpi; donations: Kpi; donors: Kpi; avgGift: Kpi };
  trend: { month: string; raised: string; donations: number }[];
  topFunds: { fund: string; raised: string; gifts: number }[];
  byMethod: { method: string; total: string; gifts: number }[];
  topDonors: { contact_id: number; donor_name: string; total: string; gifts: number }[];
  recentActivity: { contact_id: number; donor_name: string; amount: string; payment_method: string | null; payment_date: string }[];
  donorHealth: { newThisYear: number; returningThisYear: number; lapsed: number; retentionPct: number };
}

const money = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
const compact = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(v);
const monthLabel = (ym: string) => {
  const [yy, mm] = ym.split("-").map(Number);
  return new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
};
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function DeltaPill({ pct }: { pct: number }) {
  const r = Math.round(pct);
  if (!Number.isFinite(pct) || r === 0)
    return <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground"><Minus className="h-3 w-3" />0%</span>;
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? "text-emerald-600" : "text-red-600"}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(r)}%
    </span>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/summary", { cache: "no-store" });
      if (!res.ok) { setError(true); return; }
      setData(await res.json());
    } catch { setError(true); }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/auth/login"); return; }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") { router.push("/contacts"); return; }
    void load();
  }, [session, status, router, load]);

  const kpiCards = useMemo(() => data ? [
    { key: "raised", label: "Total Raised", icon: DollarSign, k: data.kpis.raised, fmt: compact, tint: "text-emerald-600" },
    { key: "donations", label: "Donations", icon: Receipt, k: data.kpis.donations, fmt: (v: number) => v.toLocaleString(), tint: "text-blue-600" },
    { key: "donors", label: "Donors", icon: Users, k: data.kpis.donors, fmt: (v: number) => v.toLocaleString(), tint: "text-violet-600" },
    { key: "avgGift", label: "Average Gift", icon: TrendingUp, k: data.kpis.avgGift, fmt: money, tint: "text-amber-600" },
  ] : [], [data]);

  if (status === "loading" || (!data && !error)) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading your dashboard…</div>;
  }
  if (error || !data) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Couldn&apos;t load the dashboard. Please refresh.</div>;
  }

  const isAdmin = session?.user.role === "admin";
  const who = data.orgName || session?.user.email || "there";

  // ── derived visibility ─────────────────────────────────────────────────
  const hasTrend = data.trend.some((t) => parseFloat(t.raised) > 0);
  const last12Total = data.trend.reduce((s, t) => s + parseFloat(t.raised), 0);
  const meaningfulFunds = data.topFunds.filter((f) => f.fund !== "(Unassigned)");
  const meaningfulFundTotal = meaningfulFunds.reduce((s, f) => s + parseFloat(f.raised), 0);
  // Only surface Top Funds when tenants actually track them — i.e. tracked
  // funds are a material share of giving. Otherwise (donation-only orgs like
  // PTI, whose giving is essentially all "Unassigned") the widget would show
  // a few trivial recovered codes and misrepresent where the money went.
  const showFunds = meaningfulFunds.length > 0 && last12Total > 0 && meaningfulFundTotal / last12Total >= 0.1;
  const showMethods = data.byMethod.length > 0 && data.byMethod.some((m) => parseFloat(m.total) > 0);
  const showDonors = data.topDonors.length > 0;
  const showActivity = data.recentActivity.length > 0;
  const h = data.donorHealth;
  const showHealth = h.newThisYear + h.returningThisYear + h.lapsed > 0 || h.retentionPct > 0;

  const trendData = {
    labels: data.trend.map((t) => monthLabel(t.month)),
    datasets: [{
      label: "Raised",
      data: data.trend.map((t) => parseFloat(t.raised)),
      backgroundColor: "rgba(99,102,241,0.85)",
      hoverBackgroundColor: "rgba(99,102,241,1)",
      borderRadius: 6,
      borderSkipped: false as const,
    }],
  };
  const trendOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (c: TooltipItem<"bar">) => money(Number(c.parsed.y) || 0) } },
    },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, ticks: { callback: (v: string | number) => typeof v === "number" ? (v >= 1000 ? "$" + v / 1000 + "k" : "$" + v) : v } },
    },
  };

  const methodData = {
    labels: data.byMethod.map((m) => titleCase(m.method)),
    datasets: [{
      data: data.byMethod.map((m) => parseFloat(m.total)),
      backgroundColor: PALETTE,
      borderWidth: 2,
      borderColor: "#fff",
    }],
  };
  const methodTotal = data.byMethod.reduce((s, m) => s + parseFloat(m.total), 0);
  const methodOptions = {
    responsive: true, maintainAspectRatio: false, cutout: "62%",
    plugins: {
      legend: { position: "right" as const, labels: { usePointStyle: true, pointStyle: "circle", padding: 14, font: { size: 11 } } },
      tooltip: { callbacks: { label: (c: TooltipItem<"doughnut">) => {
        const v = Number(c.parsed) || 0;
        const p = methodTotal > 0 ? ((v / methodTotal) * 100).toFixed(0) : "0";
        return ` ${money(v)} (${p}%)`;
      } } },
    },
  };

  const maxFund = Math.max(1, ...meaningfulFunds.map((f) => parseFloat(f.raised)));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {isAdmin && <GhlInstallPromptBanner />}

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{greeting()}</h1>
        <p className="text-muted-foreground mt-1">
          Here&apos;s how <span className="font-medium text-foreground">{who}</span> is doing — all figures reconcile with your Reports.
        </p>
      </div>

      {/* Hero KPI strip — all-time headline, this-year-vs-last-year delta below */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map(({ key, label, icon: Icon, k, fmt, tint }) => (
          <Card key={key} className="overflow-hidden">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
                <Icon className={`h-4 w-4 ${tint}`} />
              </div>
              <div className="text-3xl font-bold mt-2 tabular-nums">{fmt(k.allTime)}</div>
              <div className="text-xs text-muted-foreground mt-1">all time</div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                <DeltaPill pct={k.yoyPct} />
                <span className="text-xs text-muted-foreground">{fmt(k.thisYear)} YTD vs {data.year - 1}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Giving trend */}
      {hasTrend && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-indigo-500" /> Giving Trend</CardTitle>
            <CardDescription>Money raised per month — last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]"><Bar data={trendData} options={trendOptions} /></div>
          </CardContent>
        </Card>
      )}

      {/* Funds + Methods */}
      {(showFunds || showMethods) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {showFunds && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4 text-green-600" /> Top Funds &amp; Campaigns</CardTitle>
                <CardDescription>Last 12 months</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-2">
                {meaningfulFunds.map((f, i) => {
                  const raised = parseFloat(f.raised);
                  return (
                    <div key={f.fund + i}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium truncate pr-2">{f.fund}</span>
                        <span className="tabular-nums text-muted-foreground">{money(raised)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted mt-1 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(2, (raised / maxFund) * 100)}%`, background: PALETTE[i % PALETTE.length] }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
          {showMethods && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><DollarSign className="h-4 w-4 text-amber-600" /> By Payment Method</CardTitle>
                <CardDescription>Last 12 months</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]"><Doughnut data={methodData} options={methodOptions} /></div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Top donors + Recent activity */}
      {(showDonors || showActivity) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {showDonors && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><HeartHandshake className="h-4 w-4 text-rose-500" /> Top Donors</CardTitle>
                <CardDescription>Last 12 months</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 pt-2">
                {data.topDonors.map((d, i) => (
                  <Link key={d.contact_id} href={`/contacts/${d.contact_id}`} className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 shrink-0 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center text-xs font-semibold">{i + 1}</div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{d.donor_name || "(no name)"}</p>
                        <p className="text-xs text-muted-foreground">{d.gifts} gift{d.gifts === 1 ? "" : "s"}</p>
                      </div>
                    </div>
                    <span className="font-semibold text-sm tabular-nums">{money(parseFloat(d.total))}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
          {showActivity && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4 text-blue-500" /> Recent Activity</CardTitle>
                <CardDescription>Latest gifts</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 pt-2">
                {data.recentActivity.map((a, i) => (
                  <div key={i} className="flex items-center justify-between border-b last:border-0 py-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      <div className="min-w-0">
                        <Link href={`/contacts/${a.contact_id}`} className="font-medium text-sm truncate hover:underline block">{a.donor_name || "(no name)"}</Link>
                        <p className="text-xs text-muted-foreground">{titleCase(a.payment_method ?? "—")} • {a.payment_date}</p>
                      </div>
                    </div>
                    <span className="font-semibold text-sm tabular-nums">{money(parseFloat(a.amount))}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Donor health */}
      {showHealth && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><CalendarCheck className="h-4 w-4 text-teal-600" /> Donor Health</CardTitle>
            <CardDescription>Retention and momentum in {data.year}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "New donors", value: h.newThisYear.toLocaleString(), sub: `first gift in ${data.year}`, icon: UserPlus, tint: "text-emerald-600" },
                { label: "Returning", value: h.returningThisYear.toLocaleString(), sub: "gave before & in " + data.year, icon: RefreshCw, tint: "text-blue-600" },
                { label: "Retention", value: `${Math.round(h.retentionPct)}%`, sub: `of ${data.year - 1} donors kept`, icon: HeartHandshake, tint: "text-violet-600" },
                { label: "Lapsed", value: h.lapsed.toLocaleString(), sub: "no gift in 13+ months", icon: UserMinus, tint: "text-red-600" },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.label}</span>
                    <s.icon className={`h-4 w-4 ${s.tint}`} />
                  </div>
                  <div className="text-2xl font-bold mt-1 tabular-nums">{s.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.sub}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick links into detailed reports */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { href: "/admin/reports/donor-insights", icon: Users, title: "Donor Insights", desc: "LYBUNT, lapsed, loyal & more", tint: "text-blue-600" },
          { href: "/admin/reports/campaign-performance", icon: Target, title: "Campaign Performance", desc: "Fund & campaign breakdown", tint: "text-green-600" },
          { href: "/admin/reports/year-end", icon: Receipt, title: "Year-End Statements", desc: "Annual tax statements", tint: "text-emerald-600" },
        ].map((l) => (
          <Link key={l.href} href={l.href}>
            <Card className="hover:shadow-md hover:border-foreground/20 transition-all h-full">
              <CardContent className="p-4 flex items-center gap-3">
                <l.icon className={`h-6 w-6 ${l.tint}`} />
                <div>
                  <p className="font-medium text-sm">{l.title}</p>
                  <p className="text-xs text-muted-foreground">{l.desc}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
