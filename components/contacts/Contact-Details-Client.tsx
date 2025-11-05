"use client";
import { useContactQuery } from "@/lib/query/useContactDetails";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";

import React from "react";
import { useContactCategories } from "@/lib/query/useContactCategories";
import ContactOverviewTab from "./Contact-Overview-Tab";
import PledgesTable from "../pledges/Pledges-Client";
import useContactId from "@/hooks/use-contact-id";

export default function ContactDetailsClient() {
  const contactId = useContactId();
  const { data, isLoading, isError, error } = useContactQuery({
    contactId: contactId ?? 0,
    page: 1,
    limit: 10,
  });

  const {
    data: categoriesData,
    isLoading: isLoadingCategory,
    isError: isCategoryError,
  } = useContactCategories(contactId ?? 0, 1, 50); // Large limit to show all, or add pagination later

  if (isLoading || isLoadingCategory) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <div className="space-y-4 max-w-md w-full">
          <Skeleton className="h-12 w-full" />
          <div className="flex gap-4">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isError || isCategoryError) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Card className="max-w-md w-full">
          <CardHeader className="items-center">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <CardTitle>Error Loading Contact</CardTitle>
          </CardHeader>
          <CardContent className="text-center text-destructive">
            {error?.message || "An error occurred"}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data?.contact || !data?.financialSummary) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Card className="max-w-md w-full">
          <CardHeader className="items-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground" />
            <CardTitle>No Data Available</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            Contact information could not be found
          </CardContent>
        </Card>
      </div>
    );
  }

  const { contact, financialSummary } = data;

  // Aggregate financial summary from array to single object
  const aggregatedFinancialSummary = financialSummary.reduce(
    (acc, curr) => ({
      totalPledgedUsd: acc.totalPledgedUsd + (Number(curr.totalPledgedUsd) || 0),
      totalPaidUsd: acc.totalPaidUsd + (Number(curr.totalPaidUsd) || 0),
      totalManualDonationsUsd: acc.totalManualDonationsUsd + (Number(curr.totalManualDonationsUsd) || 0),
      currentBalanceUsd: acc.currentBalanceUsd + (Number(curr.currentBalanceUsd) || 0),
    }),
    { totalPledgedUsd: 0, totalPaidUsd: 0, totalManualDonationsUsd: 0, currentBalanceUsd: 0 }
  );

  return (
    <React.Fragment>
      <ContactOverviewTab
        contact={contact}
        financialSummary={aggregatedFinancialSummary}
        categoriesData={categoriesData}
      />
      {/* <PledgesTable /> */}
    </React.Fragment>
  );
}
