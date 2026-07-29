/**
 * Donor returns here after a successful Crowded checkout.
 *
 * Crowded redirects with no guaranteed query params we can trust, so we
 * keep this page intentionally generic: a warm thank-you with the form's
 * configured success message + a "Make another donation" link back.
 *
 * The actual donation row appears in DonorHQ asynchronously via the
 * webhook (usually within seconds). No client-side polling needed —
 * Crowded fires `collect.payment.succeeded` independent of this redirect.
 */
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { crowdedForms } from "@/lib/db/schema-crowded";

interface PageProps {
  params: Promise<{ formId: string }>;
}

export default async function ThankYouPage({ params }: PageProps) {
  const { formId: raw } = await params;
  const formId = parseInt(raw, 10);
  if (Number.isNaN(formId)) notFound();

  const [form] = await db
    .select()
    .from(crowdedForms)
    .where(and(eq(crowdedForms.id, formId), eq(crowdedForms.isActive, true)))
    .limit(1);
  if (!form) notFound();

  const primary = form.primaryColor || "#16A34A";
  const accent = form.accentColor || "#0A0A0A";
  const bg = form.backgroundColor || "#FFFFFF";
  const message =
    form.successMessage ||
    "Your generosity makes a real difference. A receipt is on its way to your inbox.";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: bg,
        fontFamily:
          '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        padding: "60px 16px",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <div
        style={{
          maxWidth: 560,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 24,
          padding: "44px 36px",
          textAlign: "center",
          boxShadow:
            "0 20px 60px rgba(15, 42, 46, 0.12), 0 4px 12px rgba(15, 42, 46, 0.06)",
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
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: accent,
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          Thank you!
        </h1>
        <p
          style={{
            marginTop: 14,
            fontSize: 16,
            color: "#4b5560",
            lineHeight: 1.55,
          }}
        >
          {message}
        </p>
        <Link
          href={`/donate/${form.id}`}
          style={{
            display: "inline-block",
            marginTop: 28,
            color: primary,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Make another donation →
        </Link>
      </div>
    </div>
  );
}
