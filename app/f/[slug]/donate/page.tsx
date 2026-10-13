/**
 * Public donate page for a Stripe-processor fundraising campaign: /f/<slug>/donate
 *
 * Collects amount + donor identity, then hands off to Stripe Checkout (hosted,
 * PCI-compliant — this app never touches card details) via
 * POST /api/public/fundraising/[slug]/checkout.
 */
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getPublicCampaignBySlug } from "@/lib/fundraising/repo";
import { DonateForm } from "./_components/donate-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await getPublicCampaignBySlug(slug);
  return { title: c ? `Donate — ${c.title}` : "Campaign not found" };
}

export default async function DonatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await getPublicCampaignBySlug(slug);
  if (!c || c.status === "draft") notFound();
  if (c.processor !== "stripe") redirect(`/f/${slug}`);

  return (
    <DonateForm
      slug={slug}
      title={c.title}
      coverImageUrl={c.coverImageUrl}
      primaryColor={c.primaryColor || "#16A34A"}
      backgroundColor={c.backgroundColor || "#FFFFFF"}
      donorCoversFees={c.donorCoversFees}
    />
  );
}
