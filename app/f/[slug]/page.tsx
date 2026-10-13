/**
 * Public hosted fundraising campaign page: /f/<slug>
 *
 * Branded, shareable page with a progress bar. Standalone (no app shell — see
 * layout-wrapper's /f bypass). Money is collected through the linked Crowded
 * donation form (/donate/<crowdedFormId>), reusing that whole pipeline.
 */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BadgeCheck } from "lucide-react";
import { getPublicCampaignBySlug, getPublicSubCampaigns } from "@/lib/fundraising/repo";
import { ShareButton } from "./share-button";
import { CampaignTabs } from "./campaign-tabs";
import { FitLogo } from "./fit-logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format((cents || 0) / 100);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await getPublicCampaignBySlug(slug);
  if (!c) return { title: "Campaign not found" };
  return {
    title: c.title,
    description: (c.story ?? "").slice(0, 160) || `Support ${c.title}`,
    openGraph: {
      title: c.title,
      description: (c.story ?? "").slice(0, 200),
      images: c.coverImageUrl ? [c.coverImageUrl] : undefined,
    },
  };
}

export default async function CampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await getPublicCampaignBySlug(slug);
  if (!c || c.status === "draft") notFound();

  // Roll up sub-campaigns (peer-to-peer teams) into the parent's totals.
  const children = await getPublicSubCampaigns(c.id);
  const raisedCents = c.raisedCents + children.reduce((s, ch) => s + ch.raisedCents, 0);
  const donorCount = c.donorCount + children.reduce((s, ch) => s + ch.donorCount, 0);
  const goalPct = c.goalCents && c.goalCents > 0 ? Math.min(100, Math.round((raisedCents / c.goalCents) * 100)) : null;

  const primary = c.primaryColor || "#16A34A";
  const bg = c.backgroundColor || "#F8FAFC";
  const goalReached = c.goalCents != null && raisedCents >= c.goalCents;
  const donationsClosed = c.donationCap && goalReached;
  const donateHref = donationsClosed
    ? null
    : c.processor === "stripe"
      ? `/f/${slug}/donate`
      : c.crowdedFormId
        ? `/donate/${c.crowdedFormId}`
        : null;

  const daysRunning = Math.max(0, Math.floor((Date.now() - new Date(c.createdAt).getTime()) / 86_400_000));

  // Full-page backdrop: the cover image (or a distinct background image, if set),
  // blurred and washed with white so it reads as an immersive frosted backdrop
  // behind the whole page rather than a flat solid color.
  const backdropImage = c.backgroundImageUrl || c.coverImageUrl || null;

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ backgroundColor: bg }}>
      {backdropImage && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={backdropImage}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-3xl"
          />
          <div className="pointer-events-none absolute inset-0 bg-white/70" />
        </>
      )}

      <div className="relative">
        {/* Tall full-bleed hero — the white panel below floats on top of it, so */}
        {/* the page reads as a picture frame rather than a small top banner. */}
        <div className="relative h-[260px] w-full overflow-hidden sm:h-[400px]">
          {c.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.coverImageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full" style={{ background: `linear-gradient(135deg, ${primary}, ${primary}cc)` }} />
          )}
          <div className="absolute inset-0 bg-white/50" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
        </div>

        <main className="mx-auto max-w-5xl px-4 pb-14 sm:px-6">
          {/* Floating panel, pulled up over the hero */}
          <div className="relative -mt-32 rounded-2xl border bg-white shadow-xl sm:-mt-48">
            <div className="p-6 sm:p-8">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">{c.title}</h1>

              {/* Cover image + floating stats/CTA card, side by side. The card is
                  pulled up with a negative margin so it visually floats above the
                  gallery/title boundary rather than sitting flush in the grid. */}
              <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-start">
                <div className="lg:col-span-2">
                  {c.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.coverImageUrl} alt="" className="h-56 w-full rounded-xl object-cover sm:h-72" />
                  ) : (
                    <div className="grid h-56 w-full place-items-center rounded-xl border border-dashed bg-gray-50 text-sm text-gray-400 sm:h-72">
                      No cover image
                    </div>
                  )}
                </div>

                <div className="rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-black/5 lg:-mt-10">
                  <div className="text-2xl font-bold" style={{ color: primary }}>{money(raisedCents)}</div>
                  <div className="text-sm text-gray-500">raised</div>

                  {goalPct != null && (
                    <>
                      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full transition-[width]" style={{ width: `${goalPct}%`, background: primary }} />
                      </div>
                      <div className="mt-1.5 text-sm text-gray-600">
                        <span className="font-semibold text-gray-900">{goalPct}%</span> of {money(c.goalCents!)} goal
                      </div>
                    </>
                  )}

                  <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
                    <span>{donorCount} donor{donorCount === 1 ? "" : "s"}</span>
                    <span>{daysRunning === 1 ? "1 day" : `${daysRunning} days`} running</span>
                  </div>

                  {donateHref ? (
                    <a
                      href={donateHref}
                      className="mt-4 inline-flex w-full items-center justify-center rounded-xl px-6 py-3 text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                      style={{ background: primary }}
                    >
                      Contribute
                    </a>
                  ) : (
                    <div className="mt-4 rounded-lg border bg-gray-50 px-4 py-3 text-center text-sm text-gray-500">
                      {donationsClosed ? "Goal reached — closed" : "Not open yet"}
                    </div>
                  )}

                  <ShareButton className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50" />
                </div>
              </div>

              {goalReached && donateHref && (
                <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-center text-sm font-medium text-green-800">
                  🎉 Goal reached — thank you! You can still give below.
                </div>
              )}

              {/* Identity row: big circular logo + name, a mini donation-progress
                  bar, then the verified line underneath. Vertically centered
                  against the logo so the text block doesn't sit high. */}
              <div className="mt-6 flex items-center gap-4 border-t pt-6">
                {c.logoUrl ? (
                  <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border bg-white shadow-sm sm:h-24 sm:w-24">
                    {/* FitLogo measures the real image and auto-scales it down just
                        enough that its full bounding box sits inside the circle — so
                        wide icon+wordmark logos no longer get clipped at the edges. */}
                    <FitLogo src={c.logoUrl} />
                  </div>
                ) : (
                  <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full border bg-gray-100 text-2xl font-bold text-gray-400 shadow-sm sm:h-24 sm:w-24">
                    {(c.ownerName || c.title).slice(0, 1).toUpperCase()}
                  </div>
                )}
                {c.ownerName && (
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-base text-gray-500 sm:text-lg">
                      By <span className="font-semibold text-gray-900">{c.ownerName}</span>
                    </span>
                    {goalPct != null && (
                      <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full" style={{ width: `${goalPct}%`, background: primary }} />
                      </div>
                    )}
                    <div className="mt-2">
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600">
                        <BadgeCheck className="h-5 w-5 text-blue-500" fill="currentColor" stroke="white" strokeWidth={2} /> Verified organization
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Story / Team leaderboard — tabbed when both have content, else just the one section. */}
              <CampaignTabs
                story={c.story}
                primary={primary}
                leaderboard={children.map((ch) => ({
                  id: ch.id,
                  slug: ch.slug,
                  name: ch.ownerName || ch.title,
                  raisedFormatted: money(ch.raisedCents),
                }))}
              />
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-gray-400">Powered by DonorHQ</p>
        </main>
      </div>
    </div>
  );
}
