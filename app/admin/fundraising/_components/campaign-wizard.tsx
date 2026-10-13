"use client";

/**
 * Create/edit wizard for a fundraising campaign. 5 steps — Basics, Story,
 * Design, Donations, Launch — with a persistent live preview pane
 * (Desktop/Mobile toggle), mirroring the approved "Campaign Builder"
 * reference design.
 *
 * Deliberately excludes a Team/Peer-to-Peer step and a currency picker
 * (locked to USD) per the approved spec. Payment processing is Stripe-only —
 * the old Crowded processor dropdown is gone; "donation form" here just
 * selects the Crowded-forms-based question/branding template, the money
 * itself now flows through the tenant's connected Stripe account.
 *
 * The GHL-tag-on-donation field used to live inside the removed Team step;
 * it's relocated into Donations (still tags the donor's GHL contact on a
 * completed donation, just no longer tied to P2P).
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  Save,
  ArrowLeft,
  ArrowRight,
  Check,
  Monitor,
  Smartphone,
  CircleDollarSign,
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Rocket,
  Sprout,
  Landmark,
  Handshake,
} from "lucide-react";

export type CampaignInitial = {
  id?: number;
  slug?: string;
  campaignType?: string;
  title?: string;
  story?: string | null;
  goalCents?: number | null;
  coverImageUrl?: string | null;
  logoUrl?: string | null;
  backgroundImageUrl?: string | null;
  primaryColor?: string | null;
  status?: string;
  crowdedFormId?: number | null;
  ghlTag?: string | null;
  processor?: string;
  donorCoversFees?: boolean;
  donationCap?: boolean;
};

const STEPS = ["Basics", "Story", "Design", "Donations", "Launch"] as const;
type StepId = (typeof STEPS)[number];

const CAMPAIGN_TYPES = [
  { id: "personal", label: "Personal", description: "Raise for yourself, family, or a cause you care about.", icon: Sprout },
  { id: "nonprofit", label: "Nonprofit", description: "Official fundraiser for your organization, with receipts.", icon: Landmark },
  { id: "team", label: "Team", description: "Peer-to-peer — supporters each get their own page.", icon: Handshake },
] as const;

const BRAND_COLORS = ["#16A34A", "#2563EB", "#9333EA", "#DB2777", "#EA580C", "#0D9488", "#059669"];

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format((cents || 0) / 100);

export default function CampaignWizard({ mode, initial }: { mode: "create" | "edit"; initial?: CampaignInitial }) {
  const router = useRouter();

  const [stepIdx, setStepIdx] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");

  const [campaignType, setCampaignType] = useState<string>(initial?.campaignType ?? "nonprofit");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [goal, setGoal] = useState(initial?.goalCents != null ? String(initial.goalCents / 100) : "");
  const [story, setStory] = useState(initial?.story ?? "");
  const [coverImageUrl, setCoverImageUrl] = useState(initial?.coverImageUrl ?? "");
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? "");
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(initial?.backgroundImageUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(initial?.primaryColor ?? BRAND_COLORS[0]);
  const [crowdedFormId, setCrowdedFormId] = useState<string>(initial?.crowdedFormId != null ? String(initial.crowdedFormId) : "");
  const [donorCoversFees, setDonorCoversFees] = useState<boolean>(initial?.donorCoversFees ?? false);
  const [donationCap, setDonationCap] = useState<boolean>(initial?.donationCap ?? false);
  const [ghlTag, setGhlTag] = useState(initial?.ghlTag ?? "");
  const [status, setStatus] = useState(initial?.status ?? "active");

  const [forms, setForms] = useState<{ id: number; name: string }[]>([]);
  const [stripeConn, setStripeConn] = useState<{ status: string; accountName: string | null } | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState(mode === "edit");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/admin/crowded/forms", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { forms: [] }))
      .then((b) => setForms((b.forms ?? []).map((f: { id: number; name: string }) => ({ id: f.id, name: f.name }))))
      .catch(() => {});
    fetch("/api/admin/stripe-connect/connection", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { connection: null }))
      .then((b) => setStripeConn(b.connection))
      .catch(() => setStripeConn(null));
  }, []);

  const stripeReady = stripeConn?.status === "active";
  const shareUrl = typeof window !== "undefined" && slug ? `${window.location.origin}/f/${slug}` : slug ? `/f/${slug}` : "";

  function goTo(i: number) {
    if (i > maxVisited) return; // forward-only jump; use Continue to unlock further steps
    setStepIdx(i);
  }
  function next() {
    const i = Math.min(stepIdx + 1, STEPS.length - 1);
    setStepIdx(i);
    setMaxVisited((m) => Math.max(m, i));
  }
  function back() {
    setStepIdx((i) => Math.max(i - 1, 0));
  }

  async function save(finalStatus?: string) {
    setSaving(true);
    setError(null);
    const payload = {
      campaignType,
      title: title.trim(),
      goalCents: goal.trim() ? Math.round(parseFloat(goal) * 100) : null,
      crowdedFormId: crowdedFormId ? Number(crowdedFormId) : null,
      coverImageUrl: coverImageUrl.trim() || null,
      logoUrl: logoUrl.trim() || null,
      backgroundImageUrl: backgroundImageUrl.trim() || null,
      primaryColor,
      story: story.trim() || null,
      status: finalStatus ?? status,
      ghlTag: ghlTag.trim() || null,
      processor: "stripe",
      donorCoversFees,
      donationCap,
    };
    try {
      const res = await fetch(mode === "create" ? "/api/admin/fundraising" : `/api/admin/fundraising/${initial?.id}`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const b = await res.json();
      if (!res.ok) {
        setError(b.details?.[0]?.message || b.error || "Failed to save");
        return;
      }
      setSlug(b.campaign.slug);
      setLaunched(true);
      if (mode === "create") {
        toast.success("Campaign launched");
        router.replace(`/admin/fundraising/${b.campaign.id}`);
      } else {
        toast.success("Changes saved");
        router.refresh();
      }
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const goalCentsPreview = goal.trim() ? Math.round(parseFloat(goal) * 100) : null;
  const canContinueBasics = title.trim().length > 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-5">
        <StepTabs steps={STEPS} current={stepIdx} maxVisited={maxVisited} onSelect={goTo} />

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <Card className="p-6">
          {STEPS[stepIdx] === "Basics" && (
            <div className="space-y-5">
              <StepHeader eyebrow="Step 1 · Start here" title="What are you raising for?" hint="Pick the kind of campaign, name it, and set a goal. You can change any of this before you launch." />
              <div>
                <label className="mb-1.5 block text-sm font-medium">Campaign type</label>
                <div className="grid gap-3 sm:grid-cols-3">
                  {CAMPAIGN_TYPES.map((t) => {
                    const active = campaignType === t.id;
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setCampaignType(t.id)}
                        className={`flex flex-col items-start gap-1.5 rounded-lg border p-4 text-left transition-colors ${
                          active ? "border-green-600 bg-green-50/60 ring-1 ring-green-600" : "border-input hover:bg-muted/50"
                        }`}
                      >
                        <Icon className={`h-5 w-5 ${active ? "text-green-600" : "text-muted-foreground"}`} />
                        <span className="text-sm font-semibold">{t.label}</span>
                        <span className="text-xs text-muted-foreground">{t.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <Field label="Campaign title" required>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summer 2026 Appeal" className="h-11" />
              </Field>
              <Field label="Logo" hint="Shown next to your organization's name on the donation page. Paste a link to a square image.">
                <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" type="url" className="h-11" />
              </Field>
              <Field label="Fundraising goal" hint="Shows a progress bar. Leave blank for open-ended. Locked to USD.">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input value={goal} onChange={(e) => setGoal(e.target.value)} inputMode="decimal" placeholder="10000" className="h-11 pl-6" />
                  </div>
                  <Badge variant="secondary" className="h-11 shrink-0 px-3 text-sm">USD</Badge>
                </div>
              </Field>
            </div>
          )}

          {STEPS[stepIdx] === "Story" && (
            <div className="space-y-5">
              <StepHeader eyebrow="Step 2 · Tell the story" title="Why should people give?" hint="A short, honest story raises the most. Say who it helps, what the money does, and why now." />
              <Field label="Your story" hint="Plain text for now. On launch you can format it with rich blocks.">
                <Textarea value={story} onChange={(e) => setStory(e.target.value)} rows={10} placeholder="Tell donors why this matters…" />
              </Field>
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Rich page blocks — coming to this step</p>
                <p className="mt-0.5 text-xs">Drag in images, video, quotes, FAQ and reward tiers with a visual block editor. The frame — cover, progress, donate button — always stays on-brand.</p>
              </div>
            </div>
          )}

          {STEPS[stepIdx] === "Design" && (
            <div className="space-y-5">
              <StepHeader eyebrow="Step 3 · Make it yours" title="Design the page" hint="Set the cover and a brand color. The preview on the right updates as you go." />
              <Field label="Cover image URL" hint="Paste a link, or upload on launch. A gradient is used until you add one.">
                <Input value={coverImageUrl} onChange={(e) => setCoverImageUrl(e.target.value)} placeholder="https://…/cover.jpg" className="h-11" />
              </Field>
              <Field label="Background image (optional)" hint="Shown blurred behind the page, like a frosted backdrop. Defaults to your cover image if left blank.">
                <Input value={backgroundImageUrl} onChange={(e) => setBackgroundImageUrl(e.target.value)} placeholder="https://…/background.jpg" className="h-11" />
              </Field>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Brand color</label>
                <div className="flex flex-wrap gap-2">
                  {BRAND_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPrimaryColor(c)}
                      aria-label={c}
                      className={`h-10 w-10 rounded-lg border-2 transition-transform ${primaryColor === c ? "scale-105 border-foreground" : "border-transparent"}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Used for the progress bar, buttons and accents on your page.</p>
              </div>
            </div>
          )}

          {STEPS[stepIdx] === "Donations" && (
            <div className="space-y-5">
              <StepHeader eyebrow="Step 4 · Get paid" title="Donations & payments" hint="Link the donation form that collects the money, and choose how fees are handled." />

              <Field label="Donation form" hint="Reuses your Crowded donation forms — the same pipeline that syncs to DonorHQ + GHL.">
                <select value={crowdedFormId} onChange={(e) => setCrowdedFormId(e.target.value)} className="h-11 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">— None (page shows “not open yet”) —</option>
                  {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </Field>

              <div>
                <label className="mb-1.5 block text-sm font-medium">Payment processor</label>
                <div className="rounded-lg border p-4">
                  {stripeConn === undefined ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking connection…</div>
                  ) : stripeReady ? (
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Stripe — connected</p>
                        <p className="truncate text-xs text-muted-foreground">{stripeConn?.accountName ?? "Your Stripe account"} will receive these donations.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                        <div>
                          <p className="text-sm font-medium">Stripe — not connected yet</p>
                          <p className="text-xs text-muted-foreground">Connect Stripe before launching so donations have somewhere to land.</p>
                        </div>
                      </div>
                      <Button asChild variant="outline" size="sm" className="gap-1.5">
                        <Link href="/admin/stripe-connect/connect"><CircleDollarSign className="h-3.5 w-3.5" /> Connect Stripe</Link>
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Donors cover the fees</p>
                  <p className="text-xs text-muted-foreground">Add the processing fee on top so 100% of the gift reaches you. Most donors opt in.</p>
                </div>
                <Switch checked={donorCoversFees} onCheckedChange={setDonorCoversFees} />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Stop at goal (donation cap)</p>
                  <p className="text-xs text-muted-foreground">Automatically close donations once you hit the target amount.</p>
                </div>
                <Switch checked={donationCap} onCheckedChange={setDonationCap} />
              </div>

              <details className="group rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground group-open:text-foreground">Advanced</summary>
                <div className="mt-3">
                  <Field label="GHL tag on donation" hint="Optional — tag applied to the donor's GHL contact when they give">
                    <Input value={ghlTag} onChange={(e) => setGhlTag(e.target.value)} placeholder="Summer 2026" className="h-11" />
                  </Field>
                </div>
              </details>
            </div>
          )}

          {STEPS[stepIdx] === "Launch" && (
            <div className="space-y-5">
              <StepHeader eyebrow="Step 5 · Almost there" title="Review & launch" hint="Here's everything at a glance. Launch when you're ready — you can keep editing after." />

              <div className="space-y-2 rounded-lg border p-4 text-sm">
                <ReviewRow label="Type" value={CAMPAIGN_TYPES.find((t) => t.id === campaignType)?.label ?? "—"} />
                <ReviewRow label="Title" value={title || "—"} />
                <ReviewRow label="Goal" value={goalCentsPreview != null ? money(goalCentsPreview) : "No goal set"} />
                <ReviewRow label="Donation form" value={forms.find((f) => String(f.id) === crowdedFormId)?.name ?? "None"} />
                <ReviewRow label="Processor" value={stripeReady ? "Stripe (connected)" : "Stripe (not connected)"} />
                <ReviewRow label="Donors cover fees" value={donorCoversFees ? "Yes" : "No"} />
                <ReviewRow label="Donation cap" value={donationCap ? "Stops at goal" : "Off"} />
                {ghlTag.trim() && <ReviewRow label="GHL tag" value={ghlTag.trim()} />}
              </div>

              <Field label="Status">
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="active">Active — visible immediately</option>
                  <option value="draft">Draft — hidden until you switch it to Active</option>
                </select>
              </Field>

              {launched && shareUrl && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
                  <p className="mb-2 text-sm font-medium text-emerald-900">Shareable donation link</p>
                  <div className="flex items-center gap-1.5">
                    <code className="flex-1 truncate rounded bg-white px-2 py-1.5 text-xs">{shareUrl}</code>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => { try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy"}
                    </Button>
                    <Button asChild variant="ghost" size="sm" className="gap-1.5"><a href={shareUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> View</a></Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={stepIdx === 0 ? () => router.push("/admin/fundraising") : back} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> {stepIdx === 0 ? "Cancel" : "Back"}
          </Button>

          {STEPS[stepIdx] === "Launch" ? (
            <Button onClick={() => save()} disabled={saving || !title.trim()} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "create" ? <Rocket className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {mode === "create" ? "Launch campaign" : "Save changes"}
            </Button>
          ) : (
            <Button onClick={next} disabled={STEPS[stepIdx] === "Basics" && !canContinueBasics} className="gap-1.5">
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <LivePreview
          device={previewDevice}
          onDeviceChange={setPreviewDevice}
          campaignType={campaignType}
          title={title || "Your campaign title"}
          story={story}
          coverImageUrl={coverImageUrl}
          logoUrl={logoUrl}
          primaryColor={primaryColor}
          goalCents={goalCentsPreview}
        />
      </div>
    </div>
  );
}

function StepTabs({ steps, current, maxVisited, onSelect }: { steps: readonly StepId[]; current: number; maxVisited: number; onSelect: (i: number) => void }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const active = i === current;
        const reachable = i <= maxVisited;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onSelect(i)}
            disabled={!reachable}
            className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "border-green-600 bg-green-50 text-green-700"
                : reachable
                  ? "border-transparent text-muted-foreground hover:bg-muted"
                  : "cursor-not-allowed border-transparent text-muted-foreground/40"
            }`}
          >
            <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${active ? "bg-green-600 text-white" : reachable ? "bg-muted-foreground/20" : "bg-muted-foreground/10"}`}>
              {i + 1 < maxVisited + 1 && i < current ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            {s}
          </button>
        );
      })}
    </div>
  );
}

function StepHeader({ eyebrow, title, hint }: { eyebrow?: string; title: string; hint: string }) {
  return (
    <div>
      {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-green-700">{eyebrow}</p>}
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}

function LivePreview({
  device,
  onDeviceChange,
  campaignType,
  title,
  story,
  coverImageUrl,
  logoUrl,
  primaryColor,
  goalCents,
}: {
  device: "desktop" | "mobile";
  onDeviceChange: (d: "desktop" | "mobile") => void;
  campaignType: string;
  title: string;
  story: string;
  coverImageUrl: string;
  logoUrl: string;
  primaryColor: string;
  goalCents: number | null;
}) {
  const typeLabel = CAMPAIGN_TYPES.find((t) => t.id === campaignType)?.label ?? "Nonprofit";
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live preview</p>
        <div className="flex items-center gap-0.5 rounded-md border p-0.5">
          <button type="button" onClick={() => onDeviceChange("desktop")} className={`rounded p-1.5 ${device === "desktop" ? "bg-muted" : "text-muted-foreground"}`} aria-label="Desktop preview">
            <Monitor className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onDeviceChange("mobile")} className={`rounded p-1.5 ${device === "mobile" ? "bg-muted" : "text-muted-foreground"}`} aria-label="Mobile preview">
            <Smartphone className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className={`mx-auto overflow-hidden rounded-xl border bg-white shadow-sm ${device === "mobile" ? "max-w-[300px]" : "max-w-full"}`}>
        <div className="relative aspect-[16/9] w-full bg-muted">
          <Badge variant="secondary" className="absolute left-2 top-2 z-10">{typeLabel}</Badge>
          {coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverImageUrl} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No cover image</div>
          )}
        </div>
        <div className="space-y-3 p-4">
          {logoUrl && (
            <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt="" className="h-full w-full object-contain p-0.5" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            </div>
          )}
          <h3 className="text-base font-bold leading-tight">{title}</h3>
          {goalCents != null && (
            <div>
              <Progress value={0} className="h-2" />
              <p className="mt-1 text-xs text-muted-foreground">{money(0)} raised of {money(goalCents)}</p>
            </div>
          )}
          {story && <p className="line-clamp-4 text-xs text-muted-foreground">{story}</p>}
          <button type="button" className="w-full rounded-md py-2 text-sm font-semibold text-white" style={{ backgroundColor: primaryColor || "#16A34A" }}>
            Donate now
          </button>
        </div>
      </div>
    </div>
  );
}
