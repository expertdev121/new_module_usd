import { useQuery } from "@tanstack/react-query";

export interface ManualDonationData {
  id: number;
  paymentDate: string;
  amount: number;
  currency: string;
  amountUsd: number;
  paymentMethod: string | null;
  referenceNumber: string | null;
  notes: string | null;
}

interface ManualDonationsResponse {
  manualDonations: ManualDonationData[];
}

export const useGetManualDonationsByContactId = (contactId: number | null) => {
  return useQuery<ManualDonationsResponse, Error>({
    queryKey: ["manualDonations", contactId],
    queryFn: async () => {
      if (!contactId) throw new Error("Contact ID is required");

      const response = await fetch(`/api/manual-donations?contactId=${contactId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch manual donations: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    },
    enabled: !!contactId,
    staleTime: 60 * 1000,
    retry: 2,
  });
};
