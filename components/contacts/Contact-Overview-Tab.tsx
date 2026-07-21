"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { User, MapPin, Grid2x2, Trash2, LogOut, Edit } from "lucide-react";
import { Contact, ContactRole, StudentRole } from "@/lib/db/schema";
import ContactCampaignsCard from "./Contact-Campaign";
import { Category } from "@/lib/query/useContactCategories";
import { DeleteConfirmationDialog } from "../ui/delete-confirmation-dialog";
import { useDeleteContact } from "@/lib/mutation/useDeleteContact";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import ContactFormDialog from "../forms/contact-form";
import { useQueryClient } from "@tanstack/react-query";


interface ContactWithRoles extends Contact {
  contactRoles: ContactRole[];
  studentRoles: StudentRole[];
  tags?: {id: number; name: string}[];
  // Structured address fields synced from GHL via the contact-upsert
  // enrichment path. The legacy `address` column is also populated as a
  // composed single-line fallback, but the UI prefers the structured
  // values when they're present.
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  organization?: string | null;
}

interface FinancialSummary {
  totalPledgedUsd: number;
  totalPaidUsd: number;
  totalManualDonationsUsd: number;
  currentBalanceUsd: number;
  currency?: string;
}

interface ContactOverviewTabProps {
  contact: ContactWithRoles;
  financialSummary: FinancialSummary;
  categoriesData?: {
    categories: Category[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

const ContactOverviewTab: React.FC<ContactOverviewTabProps> = ({
  contact,
  financialSummary,
  categoriesData,
}) => {
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteContactMutation = useDeleteContact();
  const { data: session } = useSession();

  // Debug: Log when component re-renders
  console.log('ContactOverviewTab re-rendered with contact:', contact);

  // Helper function to get currency symbol
  const getCurrencySymbol = (currency: string = 'USD') => {
    const currencySymbols: Record<string, string> = {
      USD: '$',
      ILS: '₪',
      EUR: '€',
      GBP: '£',
      JPY: '¥',
      AUD: 'A$',
      CAD: 'C$',
      ZAR: 'R',
    };
    return currencySymbols[currency] || currency;
  };

  const displayCurrency = financialSummary.currency || 'USD';
  const currencySymbol = getCurrencySymbol(displayCurrency);

  // Debug: Log the currency to see what we're receiving
  console.log('Financial Summary:', financialSummary);
  console.log('Currency:', displayCurrency);

  const paymentPercentage =
    financialSummary.totalPledgedUsd > 0
      ? Math.round(
        parseFloat(((financialSummary.totalPaidUsd /
          financialSummary.totalPledgedUsd) *
          100).toFixed(2))
      )
      : 0;

  const handleDeleteClick = () => {
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    deleteContactMutation.mutate(contact.id, {
      onSuccess: () => {
        setDeleteDialogOpen(false);
        router.push("/contacts");
      },
    });
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
  };

  const contactName = contact.displayName || `${contact.firstName} ${contact.lastName}`;

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Contact Information Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Contact Information
              </div>
              <ContactFormDialog
                key={`${contact.id}-${contact.updatedAt}`}
                isEditMode={true}
contactData={{
                  id: contact.id,
                  firstName: contact.firstName || "",
                  lastName: contact.lastName || "",
                  displayName: contact.displayName || "",
                  email: contact.email || "",
                  phone: contact.phone || "",
                  gender: contact.gender as any || undefined,
                  address: contact.address || "",
                  tags: contact.tags || [],
                }}
                trigger={
                  <Button variant="outline" size="sm">
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                }
              />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4 divide-y">
              <div className="grid grid-cols-2 gap-1 py-2">
                <dt className="text-muted-foreground font-medium">Full Name</dt>
                <dd className="text-right capitalize">
                  {contact.displayName || `${contact.title ? `${contact.title}. ` : ""}${contact.firstName} ${contact.lastName}` || "N/A"}
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-1 py-2">
                <dt className="text-muted-foreground font-medium">Email</dt>
                <dd className="text-right overflow-hidden text-ellipsis">
                  {contact.email ?? "N/A"}
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-1 py-2">
                <dt className="text-muted-foreground font-medium">Phone</dt>
                <dd className="text-right">{contact.phone ?? "N/A"}</dd>
              </div>
              <div className="grid grid-cols-2 gap-1 py-2">
                <dt className="text-muted-foreground font-medium">Gender</dt>
                <dd className="text-right capitalize">
                  {contact.gender ?? "N/A"}
                </dd>
              </div>
              {/* Address — prefer the structured columns synced from GHL.
                  Fall back to the legacy single `address` field if the
                  contact predates the GHL sync. */}
              {(() => {
                const structuredParts = [
                  contact.address1,
                  contact.city,
                  contact.state,
                  contact.postalCode,
                  contact.country,
                ].filter((p): p is string => Boolean(p && p.trim().length > 0));

                const hasStructured = structuredParts.length > 0;
                const displayAddress = hasStructured
                  ? structuredParts.join(", ")
                  : contact.address ?? "N/A";

                return (
                  <div className="grid grid-cols-2 gap-1 py-2">
                    <dt className="text-muted-foreground font-medium flex items-center">
                      <MapPin className="h-4 w-4 mr-1" />
                      Address
                    </dt>
                    <dd className="text-right">
                      {hasStructured ? (
                        <div className="space-y-0.5">
                          {contact.address1 && (
                            <div>{contact.address1}</div>
                          )}
                          {(contact.city || contact.state || contact.postalCode) && (
                            <div className="text-sm">
                              {[contact.city, contact.state, contact.postalCode]
                                .filter(Boolean)
                                .join(", ")}
                            </div>
                          )}
                          {contact.country && (
                            <div className="text-sm text-muted-foreground">
                              {contact.country}
                            </div>
                          )}
                        </div>
                      ) : (
                        displayAddress
                      )}
                    </dd>
                  </div>
                );
              })()}

              {contact.organization && contact.organization.trim().length > 0 && (
                <div className="grid grid-cols-2 gap-1 py-2">
                  <dt className="text-muted-foreground font-medium">Organization</dt>
                  <dd className="text-right">{contact.organization}</dd>
                </div>
              )}

              {/* Tags — full-width row so the pills can wrap to as many
                  lines as needed. Uses the same pill styling as the
                  contacts list table for visual parity. */}
              <div className="grid grid-cols-[minmax(0,1fr)_2fr] gap-1 py-2">
                <dt className="text-muted-foreground font-medium">Tags</dt>
                <dd className="text-right">
                  {contact.tags && contact.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1 justify-end">
                      {contact.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full"
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">No tags</span>
                  )}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* General Overview Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Grid2x2 className="h-5 w-5" />
              General Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-muted-foreground">
                  Payment Progress
                </span>
                <span className="text-sm font-medium">{paymentPercentage}%</span>
              </div>
              <Progress value={paymentPercentage} />
            </div>

            <dl className="space-y-4 divide-y">
              <div className="grid grid-cols-2 gap-1 py-2">
                <dt className="text-muted-foreground font-medium">
                  Pledges
                </dt>
                <dd className="text-right font-medium">
                  {currencySymbol}{financialSummary.totalPledgedUsd.toLocaleString("en-US")}
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-1 py-2">
                <dt className="text-muted-foreground font-medium">Total Paid</dt>
                <dd className="text-right font-medium">
                  {currencySymbol}{(financialSummary.totalPaidUsd + financialSummary.totalManualDonationsUsd).toLocaleString("en-US")}
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-1 py-2">
                <dt className="text-muted-foreground font-medium">Manual Donations</dt>
                <dd className="text-right font-medium">
                  {currencySymbol}{financialSummary.totalManualDonationsUsd.toLocaleString("en-US")}
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-1 py-2">
                <dt className="text-muted-foreground font-medium">
                  Current Balance
                </dt>
                <dd className="text-right font-bold">
                  {currencySymbol}{financialSummary.currentBalanceUsd.toLocaleString("en-US")}
                </dd>
              </div>
            </dl>


          </CardContent>
        </Card>

        {/* Campaigns Section */}
        <div className="lg:col-span-2">
          <ContactCampaignsCard />
        </div>
      </div>

      <DeleteConfirmationDialog
        isOpen={deleteDialogOpen}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        contactName={contactName}
        isDeleting={deleteContactMutation.isPending}
      />


    </>
  );
};

export default ContactOverviewTab;