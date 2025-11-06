import { useQuery } from "@tanstack/react-query";

export interface PledgeData {
  id: number;
  pledgeDate: string;
  originalAmount: number;
  currency: string;
  originalAmountUsd: number;
  totalPaid: number;
  totalPaidUsd: number;
  balance: number;
  balanceUsd: number;
  description: string | null;
  notes: string | null;
}

interface PledgesResponse {
  pledges: PledgeData[];
}

export const useGetPledgesByContactId = (contactId: number | null) => {
  return useQuery<PledgesResponse, Error>({
    queryKey: ["pledges", contactId],
    queryFn: async () => {
      if (!contactId) throw new Error("Contact ID is required");

      const response = await fetch(`/api/pledges?contactId=${contactId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch pledges: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    },
    enabled: !!contactId,
    staleTime: 60 * 1000,
    retry: 2,
  });
};
