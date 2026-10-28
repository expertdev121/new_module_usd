/**
 * Request schemas shared by the API routes and their tests.
 */
import { z } from "zod";
import { checkAlertUrl } from "./alert-url";
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
  // Optional: leaving it out keeps what is stored; "" or null clears it.
  alertWebhookUrl: z
    .union([z.string().trim(), z.null()])
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || checkAlertUrl(v) === null, { message: "Use the GoHighLevel inbound webhook URL (it starts with https://services.leadconnectorhq.com/hooks/)." })
    .optional(),
});
