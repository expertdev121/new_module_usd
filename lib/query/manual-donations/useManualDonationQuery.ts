import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface ManualDonationQueryParams {
  contactId?: number;
  solicitorId?: number;
  page?: number;
  limit?: number;
  search?: string;
  paymentMethod?: string;
  methodDetail?: string;
  paymentStatus?: "pending" | "completed" | "failed" | "cancelled" | "refunded" | "processing" | "expected";
  startDate?: string;
  endDate?: string;
  hasSolicitor?: boolean;
}

export interface ManualDonation {
  id: number;
  contactId: number;
  amount: string;
  currency: string;
  amountUsd: string | null;
  exchangeRate: string | null;
  paymentDate: string;
  receivedDate: string | null;
  checkDate: string | null;
  account: string | null;
  paymentMethod: string;
  methodDetail: string | null;
  paymentStatus: string;
  referenceNumber: string | null;
  checkNumber: string | null;
  receiptNumber: string | null;
  receiptType: string | null;
  receiptIssued: boolean;
  solicitorId: number | null;
  bonusPercentage: string | null;
  bonusAmount: string | null;
  bonusRuleId: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  // Joined fields
  contactName?: string;
  solicitorName?: string | null;
}

export interface ManualDonationsResponse {
  donations: ManualDonation[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  filters: ManualDonationQueryParams;
}

export interface CreateManualDonationData {
  contactId: number;
  amount: number;
  currency: "USD" | "ILS" | "EUR" | "JPY" | "GBP" | "AUD" | "CAD" | "ZAR";
  amountUsd?: number;
  exchangeRate: number;
  paymentDate: string;
  receivedDate?: string;
  checkDate?: string;
  account?: string;
  paymentMethod: string;
  methodDetail?: string;
  paymentStatus?: "pending" | "completed" | "failed" | "cancelled" | "refunded" | "processing" | "expected";
  referenceNumber?: string;
  checkNumber?: string;
  receiptNumber?: string;
  receiptType?: "invoice" | "confirmation" | "receipt" | "other";
  receiptIssued?: boolean;
  solicitorId?: number;
  bonusPercentage?: number;
  bonusAmount?: number;
  bonusRuleId?: number;
  notes?: string;
}

export interface CreateManualDonationResponse {
  message: string;
  donation: ManualDonation;
}

export interface UpdateManualDonationData extends Partial<CreateManualDonationData> {
  id: number;
}

export interface UpdateManualDonationResponse {
  message: string;
  donation: ManualDonation;
}

export interface DeleteManualDonationData {
  id: number;
}

export interface DeleteManualDonationResponse {
  message: string;
  deletedDonation: {
    id: number;
    amount: string;
    paymentStatus: string;
    solicitorId?: number;
    bonusAmount?: string;
  };
}

const fetchManualDonations = async (
  params: ManualDonationQueryParams
): Promise<ManualDonationsResponse> => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(`/api/manual-donations?${searchParams.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch manual donations: ${response.statusText}`);
  }
  return response.json();
};

const createManualDonation = async (
  data: CreateManualDonationData
): Promise<CreateManualDonationResponse> => {
  const response = await fetch("/api/manual-donations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      errorData.error || `Failed to create manual donation: ${response.statusText}`
    );
  }
  return response.json();
};

const fetchManualDonationDetail = async (id: number): Promise<ManualDonation> => {
  const response = await fetch(`/api/manual-donations/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch manual donation: ${response.statusText}`);
  }
  return response.json();
};

const updateManualDonation = async (
  data: UpdateManualDonationData
): Promise<UpdateManualDonationResponse> => {
  const response = await fetch(`/api/manual-donations/${data.id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      errorData.error || `Failed to update manual donation: ${response.statusText}`
    );
  }
  return response.json();
};

const deleteManualDonation = async (
  data: DeleteManualDonationData
): Promise<DeleteManualDonationResponse> => {
  const response = await fetch(`/api/manual-donations/${data.id}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      errorData.error || `Failed to delete manual donation: ${response.statusText}`
    );
  }
  return response.json();
};

export const manualDonationKeys = {
  all: ["manual-donations"] as const,
  lists: () => [...manualDonationKeys.all, "list"] as const,
  list: (params: ManualDonationQueryParams) =>
    [...manualDonationKeys.lists(), params] as const,
  details: () => [...manualDonationKeys.all, "detail"] as const,
  detail: (id: number) => [...manualDonationKeys.details(), id] as const,
  solicitor: (solicitorId: number) =>
    [...manualDonationKeys.all, "solicitor", solicitorId] as const,
};

export const useManualDonationsQuery = (
  params: ManualDonationQueryParams,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
    staleTime?: number;
  }
) => {
  return useQuery({
    queryKey: manualDonationKeys.list(params),
    queryFn: () => fetchManualDonations(params),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime ?? 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
};

export const useCreateManualDonationMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createManualDonation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: manualDonationKeys.all });
    },
    onError: (error) => {
      console.error("Error creating manual donation:", error);
    },
  });
};

export const useUpdateManualDonationMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateManualDonation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: manualDonationKeys.all });
    },
    onError: (error) => {
      console.error("Error updating manual donation:", error);
    },
  });
};

export const useDeleteManualDonationMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteManualDonation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: manualDonationKeys.all });
    },
    onError: (error) => {
      console.error("Error deleting manual donation:", error);
    },
  });
};

export const useManualDonationsBySolicitorQuery = (
  solicitorId: number,
  additionalParams?: Omit<ManualDonationQueryParams, "solicitorId">,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
    staleTime?: number;
  }
) => {
  const params = { ...additionalParams, solicitorId };
  return useQuery({
    queryKey: manualDonationKeys.solicitor(solicitorId),
    queryFn: () => fetchManualDonations(params),
    enabled: (options?.enabled ?? true) && !!solicitorId,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime ?? 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
};

export const useManualDonationDetailQuery = (
  id: number,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
    staleTime?: number;
  }
) => {
  return useQuery({
    queryKey: manualDonationKeys.detail(id),
    queryFn: () => fetchManualDonationDetail(id),
    enabled: (options?.enabled ?? true) && !!id,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime ?? 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
};

export const useManualDonationsBySolicitorStatus = (
  hasSolicitor: boolean,
  additionalParams?: Omit<ManualDonationQueryParams, "hasSolicitor">,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
    staleTime?: number;
  }
) => {
  const params = { ...additionalParams, hasSolicitor };
  return useQuery({
    queryKey: manualDonationKeys.list(params),
    queryFn: () => fetchManualDonations(params),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime ?? 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
};
