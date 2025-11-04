import { useQuery } from "@tanstack/react-query";

export interface Account {
  id: number;
  name: string;
  description: string | null;
  locationId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const useAccountsQuery = (locationId?: string) => {
  return useQuery({
    queryKey: ["accounts", locationId],
    queryFn: async (): Promise<Account[]> => {
      const params = new URLSearchParams();
      if (locationId) {
        params.append("locationId", locationId);
      }

      const response = await fetch(`/api/accounts?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch accounts");
      }
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
