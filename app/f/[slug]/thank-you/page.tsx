/**
 * Donor returns here after a successful Stripe Checkout session.
 *
 * Stripe's success_url includes {CHECKOUT_SESSION_ID}, but we don't trust it
 * to show donation details — the actual manual_donation row is written
 * asynchronously by the webhook (app/api/webhook/stripe/fundraising/[locationId])
 * once Stripe confirms payment, same pattern as the Crowded thank-you page.
 * This page is intentionally a generic, warm confirmation.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicCampaignBySlug } from "@/lib/fundraising/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CampaignThankYouPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await getPublicCampaignBySlug(slug);
  if (!c) notFound();

  const primary = c.primaryColor || "#16A34A";
  const bg = c.backgroundColor || "#F8FAFC";

  return (
    <div style={{ minHeight: "100vh", background: bg, padding: "60px 16px" }}>
      <div
        style={{
          maxWidth: 560,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 24,
          padding: "44px 36px",
          textAlign: "center",
          boxShadow: "0 20px 60px rgba(15, 42, 46, 0.12), 0 4px 12px rgba(15, 42, 46, 0.06)",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: primary,
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 36,
            margin: "0 auto 20px",
          }}
        >
          ✓
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "#0A0A0A", margin: 0, letterSpacing: "-0.02em" }}>Thank you!</h1>
        <p style={{ marginTop: 14, fontSize: 16, color: "#4b5560", lineHeight: 1.55 }}>
          Your gift to {c.title} makes a real difference. A receipt is on its way to your inbox.
        </p>
        <Link href={`/f/${slug}`} style={{ display: "inline-block", marginTop: 28, color: primary, fontWeight: 600, textDecoration: "none" }}>
          Back to the campaign →
        </Link>
      </div>
    </div>
  );
}
