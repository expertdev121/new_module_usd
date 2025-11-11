/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface SolicitorsParams {
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export const useSolicitors = (params: SolicitorsParams = {}) => {
  return useQuery({
    queryKey: ["solicitors", params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params.search) searchParams.set("search", params.search);
      if (params.status) searchParams.set("status", params.status);
      if (params.page) searchParams.set("page", params.page.toString());
      if (params.limit) searchParams.set("limit", params.limit.toString());

      const response = await fetch(`/api/solicitor?${searchParams}`);
      if (!response.ok) throw new Error("Failed to fetch solicitors");
      return response.json();
    },
  });
};

export const useSolicitor = (solicitorId: number) => {
  return useQuery({
    queryKey: ["solicitor", solicitorId],
    queryFn: async () => {
      const response = await fetch(`/api/solicitor/${solicitorId}`);
      if (!response.ok) throw new Error("Failed to fetch solicitor");
      return response.json();
    },
    enabled: !!solicitorId,
  });
};

// Hook specifically for active solicitors (commonly used)
export const useActiveSolicitors = () => {
  return useSolicitors({ status: "active" });
};

export const useCreateSolicitor = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch("/api/solicitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create solicitor");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["solicitors"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
};

export const useUpdateSolicitor = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const response = await fetch(`/api/solicitor/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update solicitor");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["solicitors"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
};

export const useDeleteSolicitor = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/solicitor/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete solicitor");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["solicitors"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
};

interface BonusRulesParams {
  solicitorId?: number;
}

export const useBonusRules = (params: BonusRulesParams = {}) => {
  return useQuery({
    queryKey: ["bonus-rules", params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params.solicitorId)
        searchParams.set("solicitorId", params.solicitorId.toString());

      const response = await fetch(`/api/bonus-rules?${searchParams}`);
      if (!response.ok) throw new Error("Failed to fetch bonus rules");
      return response.json();
    },
  });
};

export const useCreateBonusRule = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch("/api/bonus-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create bonus rule");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bonus-rules"] });
    },
  });
};

export const useUpdateBonusRule = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const response = await fetch(`/api/bonus-rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update bonus rule");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bonus-rules"] });
    },
  });
};

export const useDeleteBonusRule = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/bonus-rules/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete bonus rule");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bonus-rules"] });
    },
  });
};

// hooks/usePayments.ts
interface PaymentsParams {
  assigned?: boolean;
  solicitorId?: number;
  page?: number;
  limit?: number;
}

export const usePayments = (params: PaymentsParams = {}) => {
  return useQuery({
    queryKey: ["payments", params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params.assigned !== undefined)
        searchParams.set("assigned", params.assigned.toString());
      if (params.solicitorId)
        searchParams.set("solicitorId", params.solicitorId.toString());
      if (params.page) searchParams.set("page", params.page.toString());
      if (params.limit) searchParams.set("limit", params.limit.toString());

      const response = await fetch(`/api/solicitor-payments?${searchParams}`);
      if (!response.ok) throw new Error("Failed to fetch payments");
      return response.json();
    },
  });
};

export const useAssignPayment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      paymentId,
      solicitorId,
    }: {
      paymentId: number;
      solicitorId: number;
    }) => {
      const response = await fetch(
        `/api/solicitor-payments/${paymentId}/assign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ solicitorId }),
        }
      );
      if (!response.ok) throw new Error("Failed to assign payment");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["solicitors"] });
      queryClient.invalidateQueries({ queryKey: ["bonus-calculations"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
};

export const useUnassignPayment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (paymentId: number) => {
      const response = await fetch(
        `/api/solicitor-payments/${paymentId}/unassign`,
        {
          method: "POST",
        }
      );
      if (!response.ok) throw new Error("Failed to unassign payment");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["solicitors"] });
      queryClient.invalidateQueries({ queryKey: ["bonus-calculations"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
};

// hooks/useBonusCalculations.ts
interface BonusCalculationsParams {
  solicitorId?: number;
  isPaid?: boolean;
}

export const useBonusCalculations = (params: BonusCalculationsParams = {}) => {
  return useQuery({
    queryKey: ["bonus-calculations", params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params.solicitorId)
        searchParams.set("solicitorId", params.solicitorId.toString());
      if (params.isPaid !== undefined)
        searchParams.set("isPaid", params.isPaid.toString());

      const response = await fetch(`/api/bonus-calculations?${searchParams}`);
      if (!response.ok) throw new Error("Failed to fetch bonus calculations");
      return response.json();
    },
  });
};

export const useMarkBonusPaid = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (calculationId: number) => {
      const response = await fetch(
        `/api/bonus-calculations/${calculationId}/mark-paid`,
        {
          method: "POST",
        }
      );
      if (!response.ok) throw new Error("Failed to mark bonus as paid");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bonus-calculations"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
};

export const useBulkMarkBonusesPaid = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (calculationIds: number[]) => {
      const response = await fetch("/api/bonus-calculations/bulk-mark-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calculationIds }),
      });
      if (!response.ok) throw new Error("Failed to bulk mark bonuses as paid");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bonus-calculations"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
};

export const useRecalculateBonus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (paymentId: number) => {
      const response = await fetch("/api/bonus-calculations/recalculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId }),
      });
      if (!response.ok) throw new Error("Failed to recalculate bonus");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bonus-calculations"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["solicitors"] });
    },
  });
};

export const useDashboardStats = () => {
  return useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const response = await fetch("/api/dashboard/stats");
      if (!response.ok) throw new Error("Failed to fetch dashboard stats");
      return response.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });
};

export const useTopPerformers = (
  period: string = "all",
  limit: number = 10
) => {
  return useQuery({
    queryKey: ["top-performers", period, limit],
    queryFn: async () => {
      const searchParams = new URLSearchParams({
        period,
        limit: limit.toString(),
      });

      const response = await fetch(
        `/api/dashboard/top-performers?${searchParams}`
      );
      if (!response.ok) throw new Error("Failed to fetch top performers");
      return response.json();
    },
  });
};
