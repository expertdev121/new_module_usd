export type SortField =
  | "firstName"
  | "lastName"
  | "updatedAt"
  | "totalPledgedUsd";

export type SortOrder = "asc" | "desc";

export interface ContactTag {
  id: number;
  name: string;
}

export interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  gender: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
  totalPledgedUsd: number;
  totalPaidUsd: number;
  currentBalanceUsd: number;
  studentProgram: string | null;
  studentStatus: string | null;
  roleName: string | null;
  lastPaymentDate: string | null;
  tags?: ContactTag[];
}

export interface Pagination {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ContactsResponse {
  contacts: Contact[];
  pagination: Pagination;
}

export interface ContactsQueryParams {
  limit: number;
  cursor?: string | null;
  search?: string;
  sortBy: SortField;
  sortOrder: SortOrder;
}
