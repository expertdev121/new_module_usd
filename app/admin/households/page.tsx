"use client";

/**
 * /admin/households — list every household for the current location.
 * Only reachable when the tenant is in household mode. Renders an
 * "enable household mode" prompt otherwise, so the page never 404s
 * for a super-admin exploring the feature.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Home, Loader2, Plus, Search } from "lucide-react";

interface HouseholdRow {
  id: number;
  displayName: string;
  externalId: string | null;
  membershipTier: string | null;
  mailCity: string | null;
  mailState: string | null;
  memberCount: number;
  paymentCount: number;
  totalGiven: string;
}

function fmt(n: string | number) {
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
}

export default function HouseholdsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [mode, setMode] = useState<"individual" | "household" | undefined>(
    undefined,
  );
  const [rows, setRows] = useState<HouseholdRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [enabling, setEnabling] = useState(false);

  const loadMode = useCallback(async () => {
    const res = await fetch("/api/admin/location-settings", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json();
    setMode(body.accountType);
  }, []);

  const loadHouseholds = useCallback(
    async (q?: string) => {
      setLoading(true);
      try {
        const url = new URL("/api/admin/households", window.location.origin);
        if (q) url.searchParams.set("search", q);
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (res.status === 409) {
          setRows(null);
          return;
        }
        if (!res.ok) {
          toast.error(`Failed to load households (HTTP ${res.status})`);
          return;
        }
        const body = await res.json();
        setRows(body.households ?? []);
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
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      router.push("/contacts");
      return;
    }
    void loadMode();
  }, [router, session, status, loadMode]);

  useEffect(() => {
    if (mode === "household") void loadHouseholds();
  }, [mode, loadHouseholds]);

  async function enableHouseholdMode() {
    if (!confirm("Enable household mode for this location? Existing contacts and donations are not modified.")) return;
    setEnabling(true);
    try {
      const res = await fetch("/api/admin/location-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountType: "household" }),
      });
      if (!res.ok) {
        toast.error("Failed to enable household mode.");
        return;
      }
      setMode("household");
      toast.success("Household mode enabled.");
    } finally {
      setEnabling(false);
    }
  }

  if (mode === undefined) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (mode !== "household") {
    return (
      <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-4">
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
                <Home className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Household mode is off</h1>
                <p className="text-sm text-muted-foreground">
                  Turn this on for congregations that track giving by
                  family/household rather than by individual. Existing
                  contacts and donations are not affected — this only
                  unlocks the household UI and endpoints.
                </p>
              </div>
            </div>
            <Button onClick={enableHouseholdMode} disabled={enabling}>
              {enabling ? "Enabling…" : "Enable household mode"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
            <Home className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Households</h1>
            <p className="text-sm text-muted-foreground">
              {rows ? `${rows.length} household${rows.length === 1 ? "" : "s"}` : "Loading…"}
            </p>
          </div>
        </div>
        <Button asChild className="gap-2">
          <Link href="/admin/households/new">
            <Plus className="h-4 w-4" /> New household
          </Link>
        </Button>
      </header>

      <Card>
        <CardContent className="p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadHouseholds(search);
                }}
                placeholder="Search by family name or external id…"
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => void loadHouseholds(search)}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {!rows || rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {loading ? "Loading…" : "No households yet."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Family</th>
                    <th className="text-left px-4 py-2">Tier</th>
                    <th className="text-left px-4 py-2">Location</th>
                    <th className="text-right px-4 py-2">Members</th>
                    <th className="text-right px-4 py-2">Donations</th>
                    <th className="text-right px-4 py-2">Total given</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => (
                    <tr key={h.id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium">
                        <Link
                          href={`/admin/households/${h.id}`}
                          className="hover:underline"
                        >
                          {h.displayName}
                        </Link>
                        {h.externalId ? (
                          <div className="text-xs text-muted-foreground font-mono">
                            {h.externalId}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">{h.membershipTier ?? "—"}</td>
                      <td className="px-4 py-2">
                        {[h.mailCity, h.mailState].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="px-4 py-2 text-right">{h.memberCount}</td>
                      <td className="px-4 py-2 text-right">{h.paymentCount}</td>
                      <td className="px-4 py-2 text-right">{fmt(h.totalGiven)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
