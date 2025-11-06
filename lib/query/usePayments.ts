import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

// Zod schemas for validation, matching the main query file
const paymentStatusEnum = z.enum([
  "pending", "completed", "failed", "cancelled", "refunded", "processing", "expected"
]);

const currencyEnum = z.enum(["USD", "ILS", "EUR", "JPY", "GBP", "AUD", "CAD", "ZAR"]);

const PaymentSchema = z.object({
  id: z.number(),
  amount: z.string(),
  currency: currencyEnum,
  amountUsd: z.string().nullable(),
  paymentDate: z.string(),
  receivedDate: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  paymentStatus: paymentStatusEnum.nullable(),
  referenceNumber: z.string().nullable(),
  checkNumber: z.string().nullable(),
  receiptNumber: z.string().nullable(),
  receiptIssued: z.boolean(),
  notes: z.string().nullable(),
  paymentPlanId: z.number().nullable(),
  pledgeId: z.number().nullable(),
  isSplitPayment: z.boolean(),
  allocationCount: z.number(),
});

const PaymentsResponseSchema = z.object({
  payments: z.array(PaymentSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    totalCount: z.number(),
    totalPages: z.number(),
  }),
});

export type PaymentsResponse = z.infer<typeof PaymentsResponseSchema>;

const queryParamsSchema = z.object({
  pledgeId: z.number().positive().optional(),
  contactId: z.number().positive().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(10),
  search: z.string().optional(),
  paymentStatus: paymentStatusEnum.optional(),
});

type QueryParams = z.infer<typeof queryParamsSchema>;

const fetchPayments = async (params: QueryParams): Promise<PaymentsResponse> => {
  const validatedParams = queryParamsSchema.parse(params);
  const searchParams = new URLSearchParams();

  Object.entries(validatedParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, value.toString());
    }
  });

  try {
    const response = await fetch(`/api/payments?${searchParams.toString()}`);
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Failed to fetch payments: ${response.statusText}`);
    }
    const data = await response.json();
    return PaymentsResponseSchema.parse(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to fetch payments: ${message}`);
    throw new Error(`Failed to fetch payments: ${message}`);
  }
};

export const usePaymentsQuery = (params: QueryParams) => {
  return useQuery<PaymentsResponse, Error>({
    queryKey: ["payments", params],
    queryFn: () => fetchPayments(params),
    enabled: !!(params.pledgeId || params.contactId),
  });
};