export interface ManualDonation {
  id: number;
  contactId: number;
  amount: string;
  currency: string;
  amountUsd: string | null;
  exchangeRate: string | null;
  paymentDate: string;
  receivedDate: string | null;
  checkDate?: string | null;
  account?: string | null;
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
  // For UI purposes
  recordType?: string;
  paymentPlanId: number | null;
  installmentScheduleId: number | null;
}

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
