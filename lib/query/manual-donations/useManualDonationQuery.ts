import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ManualDonation,
  ManualDonationQueryParams,
  ManualDonationsResponse,
  CreateManualDonationData,
  CreateManualDonationResponse,
  UpdateManualDonationData,
  UpdateManualDonationResponse,
  DeleteManualDonationData,
  DeleteManualDonationResponse,
} from "@/lib/types/manual-donations";

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
