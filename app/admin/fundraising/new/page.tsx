"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import CampaignForm from "../_components/campaign-form";

export default function NewCampaignPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/admin/fundraising" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Fundraising
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">New campaign</h1>
      <CampaignForm mode="create" />
    </div>
  );
}
