"use client";

import TabLink from "@/components/next-link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Home, RefreshCw } from "lucide-react";
import { useContactQuery } from "@/lib/query/useContactDetails";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import type React from "react";
import Link from "next/link";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { contactId } = useParams<{ contactId: string }>();
  const contactIdNum = parseInt(contactId, 10);
  const isValidId = !isNaN(contactIdNum);
  const { data: session } = useSession();
  const userRole = session?.user?.role;
  const isAdmin = userRole === "admin" || userRole === "super_admin";

  return (
    <div className="container mx-auto py-8 max-w-7xl">
      {!isValidId ? (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Invalid contact ID provided. Please check the URL and try again.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <ContactDetails contactId={contactIdNum} />
          <div className="border-b">
            <nav className="flex space-x-8">
              <TabLink href={`/contacts/${contactId}`} exact>
                Contact Info
              </TabLink>
              <TabLink href={`/contacts/${contactId}/pledges`}>Pledges/Donations</TabLink>
              <TabLink href={`/contacts/${contactId}/payment-plans`}>
                Payment Plans
              </TabLink>
              <TabLink href={`/contacts/${contactId}/payments`}>
                Payments
              </TabLink>
              {isAdmin && (
                <>
                  <TabLink href={`/contacts/${contactId}/solicitor`}>
                    Solicitor
                  </TabLink>
                  {/* <TabLink href={`/contacts/${contactId}/contact-roles`}>
                    Contact Roles
                  </TabLink>
                  <TabLink href={`/contacts/${contactId}/student-roles`}>
                    Enrollment
                  </TabLink>
                  <TabLink href={`/contacts/${contactId}/relationships`}>
                    Relationships
                  </TabLink> */}
                </>
              )}
            </nav>
          </div>
          <div className="p-6">{children}</div>
        </>
      )}
    </div>
  );
}

function ContactDetails({ contactId }: { contactId: number }) {
  const { data, isLoading, isError, error, refetch } = useContactQuery({
    contactId,
    page: 1,
    limit: 10,
  });

  if (isLoading) {
    return (
      <nav className="sticky top-4 z-50 mb-3 flex px-4">
        <div className="flex items-center gap-6 px-8 py-4 bg-white/20 backdrop-blur-md border border-white/30 rounded-full shadow-lg shadow-black/5">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-6 w-32" />
        </div>
      </nav>
    );
  }

  if (isError) {
    const errorMessage =
      error?.message ||
      (typeof error === "string" ? error : "An unexpected error occurred");

    return (
      <div className="mb-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>Error loading contact: {errorMessage}</span>
            <button
              onClick={() => refetch?.()}
              className="ml-2 p-1 hover:bg-red-100 rounded-sm transition-colors"
              aria-label="Retry loading contact"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!data?.contact) {
    return (
      <div className="mb-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>No contact data available</span>
            <button
              onClick={() => refetch?.()}
              className="ml-2 p-1 hover:bg-gray-100 rounded-sm transition-colors"
              aria-label="Retry loading contact"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { firstName = "", lastName = "", displayName } = data.contact;
  const fullName = `${firstName} ${lastName}`.trim();
  const displayNameToShow = displayName && displayName.trim() ? displayName : fullName;
  const initials = displayNameToShow.split(' ').map(word => word[0]).join('').toUpperCase() || "?";

  return (
    <nav className="sticky top-4 z-50 mb-3 flex px-4">
      <div className="flex items-center gap-6 px-8 py-4 bg-white/20 backdrop-blur-md border border-white/30 rounded-full shadow-lg shadow-black/5">
        <Link href="/" aria-label="Home">
          <Home className="h-6 w-6 text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100 transition-colors" />
        </Link>
        <Avatar className="h-12 w-12 border-2 border-white/50">
          <AvatarImage
            src={`https://api.dicebear.com/7.x/initials/svg?seed=${displayNameToShow}`}
            alt={displayNameToShow || "Contact"}
          />
          <AvatarFallback className="text-sm font-medium bg-gradient-to-br from-purple-500 to-blue-500 text-white">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className="text-lg font-medium text-gray-800 dark:text-gray-200">
          {displayNameToShow || "Unknown Contact"}
        </span>
      </div>
    </nav>
  );
}
