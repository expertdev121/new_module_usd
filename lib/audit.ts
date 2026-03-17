import { db } from "@/lib/db";
import { auditLog, NewAuditLog } from "@/lib/db/schema";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export type AuditAction = string;

export interface AuditDetails {
  entity?: string;
  entityId?: number;
  contactId?: number;
  contactName?: string;
  oldValue?: any;
  newValue?: any;
  [key: string]: any;
}

export async function logAudit(
  action: AuditAction, 
  details: AuditDetails, 
  userEmailOverride?: string,
  locationIdOverride?: string
) {
  try {
    const session = await getServerSession(authOptions);
    const userEmail = userEmailOverride || session?.user?.email || "unknown";
    const locationId = locationIdOverride || session?.user?.locationId || null;
    
    const auditEntry: NewAuditLog = {
      userId: session?.user?.id ? parseInt(session.user.id as string) : null,
      userEmail,
      locationId,
      action,
      details,
      ipAddress: session?.user?.ipAddress || null,
      userAgent: session?.user?.userAgent || null,
    };

    await db.insert(auditLog).values(auditEntry);
  } catch (error) {
    console.error("Audit log failed:", error);
  }
}

// Generic entity logging
export async function logEntityAction(action: "create" | "update" | "delete", entity: string, entityId: number, details: AuditDetails = {}) {
  await logAudit(`${entity}_${action}`, {
    entity,
    entityId,
    ...details
  });
}

// Convenience functions for common actions (single declarations)
export async function logContactAction(action: "create" | "update" | "delete", contactId: number, contactName: string, details: any = {}) {
  await logEntityAction(action, "contact", contactId, { contactName, ...details });
}

export async function logDonationAction(action: "create" | "update" | "delete" | "add", donationId: number, contactId?: number, amount?: number, details: any = {}) {
  const entityAction = action === "add" ? "create" : action;
  await logEntityAction(entityAction, "manual_donation", donationId, { contactId, amount, originalAction: action, ...details });
}

export async function logPledgeAction(action: "create" | "update" | "delete", pledgeId: number, contactId?: number, amount?: number, details: any = {}) {
  await logEntityAction(action, "pledge", pledgeId, { contactId, amount, ...details });
}

export async function logPaymentPlanAction(action: "create" | "update" | "delete", planId: number, pledgeId?: number, details: any = {}) {
  await logEntityAction(action, "payment_plan", planId, { pledgeId, ...details });
}

export async function logPaymentAction(action: "create" | "update" | "delete", paymentId: number, pledgeId?: number, details: any = {}) {
  await logEntityAction(action, "payment", paymentId, { pledgeId, ...details });
}

export async function logCategoryAction(action: "create" | "update" | "delete", categoryId: number, details: any = {}) {
  await logEntityAction(action, "category", categoryId, details);
}

export async function logCampaignAction(action: "create" | "update" | "delete", campaignId: number, details: any = {}) {
  await logEntityAction(action, "campaign", campaignId, details);
}

export async function logTagAction(action: "create" | "update" | "delete", tagId: number, details: any = {}) {
  await logEntityAction(action, "tag", tagId, details);
}

// Legacy functions (for merge)
export async function logMergeContact(mergedContactId: number, intoContactId: number, intoContactName: string) {
  await logAudit("MERGE_CONTACTS", {
    entity: "contact",
    mergedContactId,
    intoContactId,
    intoContactName
  });
}

