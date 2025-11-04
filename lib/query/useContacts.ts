import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const querySchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(10),
  search: z.string().optional(),
  sortBy: z
    .enum(["updatedAt", "firstName", "lastName", "totalPledgedUsd","displayName"])
    .default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type ContactQueryParams = z.infer<typeof querySchema>;

export interface ContactResponse {
  id: number;
  firstName: string;
  lastName: string;
  displayName?:string;
  email: string | null;
  phone: string | null;
  title: string | null;
  gender: string | null;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
  totalPledgedUsd: number;
  totalPaidUsd: number;
  currentBalanceUsd: number;
  studentProgram: string | null;
  studentStatus: string | null;
  roleName: string | null;
  lastPaymentDate: Date | null;
}

interface ContactsResponse {
  contacts: ContactResponse[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  summary: {
    totalContacts: number;
    totalPledgedAmount: number;
    totalPaidAmount: number;
    contactsWithPledges: number;
    recentContacts: number;
  };
}

export const useGetContacts = (params: ContactQueryParams) => {
  const validatedParams = querySchema.parse(params);

  return useQuery<ContactsResponse, Error>({
    queryKey: [
      "contacts",
      validatedParams.page,
      validatedParams.limit,
      validatedParams.search || "all",
      validatedParams.sortBy,
      validatedParams.sortOrder,
    ],
    queryFn: async () => {
      const queryParams = new URLSearchParams({
        page: validatedParams.page.toString(),
        limit: validatedParams.limit.toString(),
        sortBy: validatedParams.sortBy,
        sortOrder: validatedParams.sortOrder,
        ...(validatedParams.search && { search: validatedParams.search }),
      });

      const response = await fetch(`/api/contacts?${queryParams.toString()}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch contacts: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    },
    staleTime: 60 * 1000,
    retry: 2,
  });
};
