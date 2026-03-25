import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const querySchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(25),
  action: z.string().optional(),
  userEmail: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export type AuditLogQueryParams = z.infer<typeof querySchema>;

export interface AuditLogEntry {
  id: number;
  userId: number | null;
  userEmail: string;
  locationId: string | null;
  action: string;
  details: any;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: string;
}

export interface AuditLogsResponse {
  logs: AuditLogEntry[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export const useAdminAuditLogs = (params: AuditLogQueryParams) => {
  const validatedParams = querySchema.parse(params);

  return useQuery<AuditLogsResponse, Error>({
    queryKey: [
      "admin-audit-logs",
      validatedParams.page,
      validatedParams.limit,
      validatedParams.action || "",
      validatedParams.userEmail || "",
      validatedParams.dateFrom || "",
      validatedParams.dateTo || "",
    ],
    queryFn: async () => {
      const queryParams = new URLSearchParams({
        page: validatedParams.page.toString(),
        limit: validatedParams.limit.toString(),
        ...(validatedParams.action && { action: validatedParams.action }),
        ...(validatedParams.userEmail && { userEmail: validatedParams.userEmail }),
        ...(validatedParams.dateFrom && { dateFrom: validatedParams.dateFrom }),
        ...(validatedParams.dateTo && { dateTo: validatedParams.dateTo }),
      });

      const response = await fetch(`/api/admin/log-reports?${queryParams}`, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch audit logs: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
};

