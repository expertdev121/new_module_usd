import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface PaymentQueryParams {
  pledgeId?: number;
  contactId?: number;
  solicitorId?: number;
  page?: number;
  limit?: number;
  search?: string;
  paymentMethod?:
  | "ach"
  | "bill_pay"
  | "cash"
  | "check"
  | "credit"
  | "credit_card"
  | "expected"
  | "goods_and_services"
  | "matching_funds"
  | "money_order"
  | "p2p"
  | "pending"
  | "refund"
  | "scholarship"
  | "stock"
  | "student_portion"
  | "unknown"
  | "wire"
  | "xfer";
  paymentStatus?:
  | "pending"
  | "expected"
  | "completed"
  | "failed"
  | "cancelled"
  | "refunded"
  | "processing";
  startDate?: string;
  endDate?: string;
  hasSolicitor?: boolean;
  showPaymentsMade?: boolean;
  showPaymentsReceived?: boolean;
}

export interface Payment {
  id: number;
  contactId?: number;
  pledgeId: number;
  paymentPlanId: number | null;
  installmentScheduleId: number | null;
  amount: string;
  currency: string;
  amountUsd: string | null;
  amountInPledgeCurrency: string | null;
  exchangeRate: string | null;
  paymentDate: string;
  receivedDate: string | null;
  paymentMethod: string;
  methodDetail: string | null;
  paymentStatus: string;
  referenceNumber: string | null;
  checkNumber: string | null;
  tagIds?: number[];
  tags?: Array<{ id: number; name: string }>;
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
  pledgeDescription?: string | null;
  pledgeOriginalAmount?: string | null;
  pledgeOriginalCurrency?: string;
  pledgeExchangeRate?: string | null;
  solicitorName?: string | null;
  isSplitPayment: boolean;
  allocations: PaymentAllocation[];
  allocationCount: number;
  account?: string;
  isThirdPartyPayment?: boolean;
  payerContactId?: number | null;
  pledgeOwnerId?: number | null;
  payerContactName?: string | null;
  pledgeOwnerName?: string | null;
  // Manual donation fields
  isManualDonation?: boolean;
  contactName?: string;
}

export interface PaymentAllocation {
  id: number;
  paymentId: number;
  pledgeId: number;
  installmentScheduleId: number | null;
  allocatedAmount: number;
  currency: string;
  allocatedAmountUsd: string | undefined;
  allocatedAmountInPledgeCurrency?: string | number | null;
  notes: string | null;
  receiptNumber: string | null;
  receiptType: string | null;
  receiptIssued: boolean;
  amountInPledgeCurrency?: string | null;
  pledgeCurrency?: string;
  createdAt: string;
  updatedAt: string;
  pledge?: {
    id: number;
    contactId: number;
    campaignId?: number;
    currency: string;
  };
  pledgeDescription?: string;
  pledgeOwnerName?: string | null;
}

export interface PaymentsResponse {
  payments: Payment[];
  manualDonations?: Payment[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  filters: {
    pledgeId?: number;
    contactId?: number;
    solicitorId?: number;
    search?: string;
    paymentMethod?: string;
    paymentStatus?: string;
    startDate?: string;
    endDate?: string;
    hasSolicitor?: boolean;
    showPaymentsMade?: boolean;
    showPaymentsReceived?: boolean;
  };
}

export interface CreatePaymentData {
  pledgeId: number;
  amount: number;
  currency: "USD" | "ILS" | "EUR" | "JPY" | "GBP" | "AUD" | "CAD" | "ZAR";
  amountUsd: number;
  exchangeRate: number;
  paymentDate: string;
  receivedDate?: string;
  paymentMethod:
  | "ach"
  | "bill_pay"
  | "cash"
  | "check"
  | "credit"
  | "credit_card"
  | "expected"
  | "goods_and_services"
  | "matching_funds"
  | "money_order"
  | "p2p"
  | "pending"
  | "refund"
  | "scholarship"
  | "stock"
  | "student_portion"
  | "unknown"
  | "wire"
  | "xfer";
  paymentStatus?:
  | "pending"
  | "completed"
  | "failed"
  | "cancelled"
  | "refunded"
  | "processing";
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
  paymentPlanId?: number;
  amountInPledgeCurrency?: string | null;
  isSplitPayment?: boolean;
  allocations?: PaymentAllocation[];

  isThirdPartyPayment?: boolean;
  payerContactId?: number | null;
  pledgeOwnerName?: string | null;
}

export interface CreatePaymentResponse {
  message: string;
  payment: Payment;
}

export interface UpdatePaymentData {
  paymentId: number;
  amount?: number;
  currency?: "USD" | "ILS" | "EUR" | "JPY" | "GBP" | "AUD" | "CAD" | "ZAR";
  amountUsd?: number;
  exchangeRate?: number;
  paymentDate?: string;
  receivedDate?: string;
  paymentMethod?:
  | "ach"
  | "bill_pay"
  | "cash"
  | "check"
  | "credit"
  | "credit_card"
  | "expected"
  | "goods_and_services"
  | "matching_funds"
  | "money_order"
  | "p2p"
  | "pending"
  | "refund"
  | "scholarship"
  | "stock"
  | "student_portion"
  | "unknown"
  | "wire"
  | "xfer";
  paymentStatus?:
  | "pending"
  | "completed"
  | "failed"
  | "cancelled"
  | "refunded"
  | "processing";
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
  paymentPlanId?: number;
  amountInPledgeCurrency?: string | null;
  isSplitPayment?: boolean;
  allocations?: PaymentAllocation[];

  isThirdPartyPayment?: boolean;
  payerContactId?: number | null;
  pledgeOwnerName?: string | null;
}

export interface UpdatePaymentResponse {
  message: string;
  payment: Payment;
}

export interface DeletePaymentData {
  paymentId: number;
}

export interface DeletePaymentResponse {
  message: string;
  deletedPayment: {
    id: number;
    amount: string;
    paymentStatus: string;
    solicitorId?: number;
    bonusAmount?: string;
  };
}

const fetchPayments = async (
  params: PaymentQueryParams
): Promise<PaymentsResponse> => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(`/api/payments?${searchParams.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch payments: ${response.statusText}`);
  }
  return response.json();
};

const createPayment = async (
  data: CreatePaymentData
): Promise<CreatePaymentResponse> => {
  const response = await fetch("/api/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      errorData.error || `Failed to create payment: ${response.statusText}`
    );
  }
  return response.json();
};
const updatePayment = async (
  pledgeId: number,
  data: UpdatePaymentData
): Promise<UpdatePaymentResponse> => {
  const response = await fetch(`/api/payments/${pledgeId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      errorData.error || `Failed to update payment: ${response.statusText}`
    );
  }
  return response.json();
};

const deletePayment = async (
  data: DeletePaymentData
): Promise<DeletePaymentResponse> => {
  const response = await fetch(`/api/payments/${data.paymentId}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      errorData.error || `Failed to delete payment: ${response.statusText}`
    );
  }
  return response.json();
};

export const paymentKeys = {
  all: ["payments"] as const,
  lists: () => [...paymentKeys.all, "list"] as const,
  list: (params: PaymentQueryParams) =>
    [...paymentKeys.lists(), params] as const,
  details: () => [...paymentKeys.all, "detail"] as const,
  detail: (id: number) => [...paymentKeys.details(), id] as const,
  solicitor: (solicitorId: number) =>
    [...paymentKeys.all, "solicitor", solicitorId] as const,
};

export const usePaymentsQuery = (
  params: PaymentQueryParams,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
    staleTime?: number;
  }
) => {
  return useQuery({
    queryKey: paymentKeys.list(params),
    queryFn: () => fetchPayments(params),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime ?? 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
};

export const useCreatePaymentMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPayment,
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
    onError: (error) => {
      console.error("Error creating payment:", error);
    },
  });
};

export const useUpdatePaymentMutation = (pledgeId: number) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdatePaymentData) => updatePayment(pledgeId, data),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
    onError: (error) => {
      console.error("Error updating payment:", error);
    },
  });
};

export const useDeletePaymentMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DeletePaymentData) => deletePayment(data),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
    onError: (error) => {
      console.error("Error deleting payment:", error);
    },
  });
};

export const useSolicitorPaymentsQuery = (
  solicitorId: number,
  additionalParams?: Omit<PaymentQueryParams, "solicitorId">,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
    staleTime?: number;
  }
) => {
  const params = { ...additionalParams, solicitorId };
  return useQuery({
    queryKey: paymentKeys.solicitor(solicitorId),
    queryFn: () => fetchPayments(params),
    enabled: (options?.enabled ?? true) && !!solicitorId,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime ?? 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
};

export const usePaymentsBySolicitorStatus = (
  hasSolicitor: boolean,
  additionalParams?: Omit<PaymentQueryParams, "hasSolicitor">,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
    staleTime?: number;
  }
) => {
  const params = { ...additionalParams, hasSolicitor };
  return useQuery({
    queryKey: paymentKeys.list(params),
    queryFn: () => fetchPayments(params),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime ?? 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
};