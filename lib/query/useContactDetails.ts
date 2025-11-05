import { useQuery } from "@tanstack/react-query";
import { Contact, ContactRole, StudentRole } from "@/lib/db/schema";

interface CategoryFinancialSummary {
  categoryId: number | null;
  categoryName: string | null;
  totalPledgedUsd: number;
  totalPaidUsd: number;
  totalManualDonationsUsd: number;
  currentBalanceUsd: number;
}

interface ContactResponse {
  contact: Contact & {
    contactRoles: ContactRole[];
    studentRoles: StudentRole[];
  };
  financialSummary: CategoryFinancialSummary[];
  pagination: {
    page: number;
    limit: number;
    totalContactRoles: number;
    totalStudentRoles: number;
  };
}

interface UseContactQueryParams {
  contactId: number;
  page?: number;
  limit?: number;
}

export function useContactQuery({
  contactId = 1,
  page = 1,
  limit = 10,
}: UseContactQueryParams) {
  return useQuery<ContactResponse, Error>({
    queryKey: ["contact", contactId, page, limit],
    queryFn: async () => {
      if (isNaN(contactId) || contactId <= 0) {
        throw new Error("Invalid contact ID");
      }

      const url = new URL(`/api/contacts/${contactId}`, window.location.origin);
      url.searchParams.set("page", page.toString());
      url.searchParams.set("limit", limit.toString());

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Contact not found");
        }
        throw new Error(`Failed to fetch contact: ${response.statusText}`);
      }

      return response.json();
    },
    enabled: !!contactId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: (failureCount, error) => {
      if (
        error.message.includes("not found") ||
        error.message.includes("Invalid")
      ) {
        return false;
      }
      return failureCount < 3;
    },
    refetchOnWindowFocus: false,
  });
}
