/**
 * Public hosted fundraising campaign page: /f/<slug>
 *
 * Branded, shareable page with a progress bar. Standalone (no app shell — see
 * layout-wrapper's /f bypass). Money is collected through the linked Crowded
 * donation form (/donate/<crowdedFormId>), reusing that whole pipeline.
 */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicCampaignBySlug } from "@/lib/fundraising/repo";

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

  const primary = c.primaryColor || "#16A34A";
  const bg = c.backgroundColor || "#F8FAFC";
  const goalReached = c.goalCents != null && c.raisedCents >= c.goalCents;
  const donateHref = c.crowdedFormId ? `/donate/${c.crowdedFormId}` : null;

  return (
    <div style={{ background: bg }} className="min-h-screen">
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          {/* Cover */}
          {c.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.coverImageUrl} alt={c.title} className="h-56 w-full object-cover sm:h-72" />
          ) : (
            <div className="h-24 w-full" style={{ background: `linear-gradient(135deg, ${primary}, ${primary}cc)` }} />
          )}

          <div className="p-6 sm:p-8">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">{c.title}</h1>

            {/* Progress */}
            {c.goalCents != null && c.goalCents > 0 && (
              <div className="mt-5">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-2xl font-bold" style={{ color: primary }}>{money(c.raisedCents)}</div>
                    <div className="text-sm text-gray-500">raised of {money(c.goalCents)} goal</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-gray-900">{c.goalPct ?? 0}%</div>
                    <div className="text-sm text-gray-500">{c.donorCount} donor{c.donorCount === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full transition-[width]" style={{ width: `${c.goalPct ?? 0}%`, background: primary }} />
                </div>
              </div>
            )}

            {/* Donate CTA */}
            <div className="mt-6">
              {donateHref ? (
                goalReached ? (
                  <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-center text-sm font-medium text-green-800">
                    🎉 Goal reached — thank you! You can still give below.
                  </div>
                ) : null
              ) : null}
              {donateHref ? (
                <a
                  href={donateHref}
                  className="mt-3 inline-flex w-full items-center justify-center rounded-xl px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                  style={{ background: primary }}
                >
                  Donate now
                </a>
              ) : (
                <div className="rounded-lg border bg-gray-50 px-4 py-3 text-center text-sm text-gray-500">
                  Donations are not open for this campaign yet.
                </div>
              )}
            </div>

            {/* Story */}
            {c.story && (
              <div className="mt-8 whitespace-pre-wrap text-[15px] leading-relaxed text-gray-700">
                {c.story}
              </div>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">Powered by DonorHQ</p>
      </main>
    </div>
  );
}
