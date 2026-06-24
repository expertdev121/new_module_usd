/**
 * Donor returns here after a failed Crowded checkout. Soft tone — most
 * failures are recoverable (card declined, insufficient funds, etc.).
 * One CTA back to the form.
 */
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { crowdedForms } from "@/lib/db/schema-crowded";

interface PageProps {
  params: Promise<{ formId: string }>;
}

export default async function FailedPage({ params }: PageProps) {
  const { formId: raw } = await params;
  const formId = parseInt(raw, 10);
  if (Number.isNaN(formId)) notFound();

  const [form] = await db
    .select()
    .from(crowdedForms)
    .where(and(eq(crowdedForms.id, formId), eq(crowdedForms.isActive, true)))
    .limit(1);
  if (!form) notFound();

  const primary = form.primaryColor || "#00A99D";
  const accent = form.accentColor || "#0F2A2E";
  const bg = form.backgroundColor || "#F5F2EC";

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
            background: "#f4c4c4",
            color: "#9a1f1f",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 36,
            margin: "0 auto 20px",
          }}
        >
          !
        </div>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: accent,
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          We couldn't complete your donation
        </h1>
        <p
          style={{
            marginTop: 14,
            fontSize: 16,
            color: "#4b5560",
            lineHeight: 1.55,
          }}
        >
          The payment didn't go through. Your card was not charged.
          Most often this is a temporary issue — please try again.
        </p>
        <Link
          href={`/donate/${form.id}`}
          style={{
            display: "inline-block",
            marginTop: 28,
            padding: "12px 24px",
            borderRadius: 12,
            background: primary,
            color: "#fff",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Try again
        </Link>
      </div>
    </div>
  );
}
