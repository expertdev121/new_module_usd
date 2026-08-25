"use client";

/**
 * /admin/fundraising — list of fundraising campaigns with live progress and a
 * shareable public link. "New campaign" launches the create wizard.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Plus, ExternalLink, Copy, Check, Pencil } from "lucide-react";

type Campaign = {
  id: number;
  slug: string;
  title: string;
  goalCents: number | null;
  status: string;
  raisedCents: number;
  donorCount: number;
  goalPct: number | null;
  crowdedFormId: number | null;
};

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format((cents || 0) / 100);

function ShareLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/f/${slug}` : `/f/${slug}`;
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy link"}
      </Button>
      <Button asChild variant="ghost" size="sm" className="gap-1.5">
        <a href={`/f/${slug}`} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> View</a>
      </Button>
    </div>
  );
}

export default function FundraisingPage() {
  const [rows, setRows] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/fundraising", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((b) => setRows(b.campaigns ?? []))
      .catch(() => setError("Failed to load campaigns"));
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-green-100 text-green-700"><Megaphone className="h-5 w-5" /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Fundraising</h1>
            <p className="text-sm text-muted-foreground">Create a campaign, share it, and collect money — powered by your Crowded donation forms.</p>
          </div>
        </div>
        <Button asChild className="gap-2"><Link href="/admin/fundraising/new"><Plus className="h-4 w-4" /> New campaign</Link></Button>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">No campaigns yet.</p>
          <Button asChild className="mt-4 gap-2"><Link href="/admin/fundraising/new"><Plus className="h-4 w-4" /> Create your first campaign</Link></Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{c.title}</span>
                    <Badge variant={c.status === "active" ? "default" : "secondary"} className="capitalize">{c.status}</Badge>
                    {!c.crowdedFormId && <Badge variant="outline" className="text-amber-600">No donation form linked</Badge>}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{money(c.raisedCents)}</span>
                    {c.goalCents ? <> raised of {money(c.goalCents)} · {c.goalPct ?? 0}%</> : <> raised</>} · {c.donorCount} donor{c.donorCount === 1 ? "" : "s"}
                  </div>
                  {c.goalCents ? (
                    <div className="mt-2 h-2 w-full max-w-md overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-green-500 transition-[width]" style={{ width: `${c.goalPct ?? 0}%` }} />
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <ShareLink slug={c.slug} />
                  <Button asChild variant="outline" size="sm" className="gap-1.5"><Link href={`/admin/fundraising/${c.id}`}><Pencil className="h-3.5 w-3.5" /> Edit</Link></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
