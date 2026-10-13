"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import CampaignWizard from "../_components/campaign-wizard";

export default function NewCampaignPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href="/admin/fundraising" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Fundraising
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">New campaign</h1>
      <CampaignWizard mode="create" />
    </div>
  );
}
