import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { CROWDED_ENABLED } from "@/lib/crowded/enabled";

/**
 * The public donation pages (/donate/[formId]) belong to the Crowded
 * integration. While Crowded is paused they must not be reachable — this
 * server layout returns 404 for the whole /donate subtree. Remove the guard
 * (or flip CROWDED_ENABLED) to bring them back. No page code was deleted.
 */
export default function DonateLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!CROWDED_ENABLED) notFound();
  return <>{children}</>;
}
