/**
 * Request schemas shared by the API routes and their tests.
 */
import { z } from "zod";
import { isoDate } from "./dates";

export const ACCRUAL_MESSAGE = "Accrual basis is not available yet. Use cash basis.";

export const SettingsBody = z.object({
  system: z.enum(["quickbooks_online", "generic_csv"]),
  // Accrual (pledges as receivables) is not built: the entry builder only does cash. Refusing it here, not just
  // greying it out in the screen, so it cannot be switched on through the API either.
  basis: z.enum(["cash", "accrual"]).refine((v) => v === "cash", { message: ACCRUAL_MESSAGE }),
  startDate: isoDate("Start date").nullable(),
  unmappedAccountId: z.number().int().positive().nullable(),
  entryType: z.enum(["deposit", "journal_entry"]),
  autoSyncEnabled: z.boolean(),
});
