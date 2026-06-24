/**
 * Public donor page: /donate/[formId]
 *
 * Server component — loads the form on the server so:
 *   - First paint already has the form's branding (no flash of default)
 *   - SEO + OG tags can use the form's headline/tagline
 *   - 404s are real 404s (not client-side empty state)
 *
 * The actual form UX is a client component below — handles state,
 * Crowded intent POST, and the redirect to Crowded's hosted checkout.
 */
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { crowdedForms } from "@/lib/db/schema-crowded";
import { DonorForm } from "./_components/donor-form";
import type { Metadata } from "next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ formId: string }>;
}

async function loadForm(formId: number) {
  const [row] = await db
    .select()
    .from(crowdedForms)
    .where(and(eq(crowdedForms.id, formId), eq(crowdedForms.isActive, true)))
    .limit(1);
  return row ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { formId: raw } = await params;
  const formId = parseInt(raw, 10);
  if (Number.isNaN(formId)) return { title: "Donate" };
  const form = await loadForm(formId);
  if (!form) return { title: "Donate" };
  return {
    title: form.headline || form.name,
    description: form.tagline ?? undefined,
    openGraph: form.heroImageUrl
      ? { images: [{ url: form.heroImageUrl }] }
      : undefined,
  };
}

export default async function DonatePage({ params }: PageProps) {
  const { formId: raw } = await params;
  const formId = parseInt(raw, 10);
  if (Number.isNaN(formId)) notFound();

  const form = await loadForm(formId);
  if (!form) notFound();

  return <DonorForm form={form} />;
}
