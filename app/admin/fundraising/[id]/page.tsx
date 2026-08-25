"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, Copy, Check, Trash2, Loader2 } from "lucide-react";
import CampaignForm, { type CampaignInitial } from "../_components/campaign-form";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format((cents || 0) / 100);

export default function EditCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<(CampaignInitial & { slug: string; raisedCents: number; goalPct: number | null; donorCount: number }) | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/fundraising/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((b) => setC(b.campaign))
      .catch(() => setNotFound(true));
  }, [id]);

  async function del() {
    if (!confirm("Delete this campaign? The public page will stop working. (Donations already collected are kept.)")) return;
    await fetch(`/api/admin/fundraising/${id}`, { method: "DELETE" });
    router.push("/admin/fundraising");
    router.refresh();
  }

  if (notFound) return <div className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">Campaign not found.</div>;
  if (!c) return <div className="mx-auto max-w-3xl p-8 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/f/${c.slug}` : `/f/${c.slug}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/admin/fundraising" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Fundraising
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{c.title}</h1>
        <Button variant="ghost" size="sm" className="gap-1.5 text-red-600 hover:text-red-700" onClick={del}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
      </div>

      {/* Progress + share */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-semibold">{money(c.raisedCents)}</span>
            {c.goalCents ? <> raised of {money(c.goalCents)} · {c.goalPct ?? 0}%</> : <> raised</>} · {c.donorCount} donor{c.donorCount === 1 ? "" : "s"}
          </div>
          <div className="flex items-center gap-1.5">
            <code className="rounded bg-muted px-2 py-1 text-xs">{shareUrl}</code>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => { try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy"}
            </Button>
            <Button asChild variant="ghost" size="sm" className="gap-1.5"><a href={`/f/${c.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> View</a></Button>
          </div>
        </div>
      </Card>

      <CampaignForm mode="edit" initial={{ ...c, id: Number(id) }} />
    </div>
  );
}
