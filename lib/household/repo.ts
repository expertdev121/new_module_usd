/**
 * Household + member + donation queries.
 * All read/write for the household feature funnels through here so the
 * routes stay thin and testable.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { household, type Household, type NewHousehold } from "@/lib/db/schema-household";
import { contact, payment } from "@/lib/db/schema";

export interface HouseholdWithCounts extends Household {
  memberCount: number;
  paymentCount: number;
  totalGiven: string; // numeric as string, formatted client-side
}

export async function listHouseholds(
  locationId: string,
  opts: { search?: string; limit?: number; offset?: number } = {},
): Promise<HouseholdWithCounts[]> {
  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = opts.offset ?? 0;

  // Aggregate counts + totals in one round-trip per household. For very
  // large tenants (>5k households) swap to a paged SQL with subqueries.
  const result = await db.execute<{
    id: number;
    location_id: string;
    display_name: string;
    external_id: string | null;
    membership_tier: string | null;
    mail_label: string | null;
    mail_city: string | null;
    mail_state: string | null;
    total_balance: string | null;
    created_at: Date;
    updated_at: Date;
    member_count: string;
    payment_count: string;
    total_given: string;
  }>(sql`
    SELECT h.id, h.location_id, h.display_name, h.external_id,
           h.membership_tier, h.mail_label, h.mail_city, h.mail_state,
           h.total_balance, h.created_at, h.updated_at,
           COALESCE((SELECT COUNT(*)::text FROM contact c WHERE c.household_id = h.id), '0') AS member_count,
           COALESCE((SELECT COUNT(*)::text FROM payment p WHERE p.household_id = h.id), '0') AS payment_count,
           COALESCE((SELECT SUM(p.amount)::text FROM payment p WHERE p.household_id = h.id), '0') AS total_given
    FROM household h
    WHERE h.location_id = ${locationId}
    ${opts.search ? sql`AND (h.display_name ILIKE ${"%" + opts.search + "%"} OR h.external_id ILIKE ${"%" + opts.search + "%"})` : sql``}
    ORDER BY h.display_name ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  // neon-http returns { rows: [...] }; the array is also spread via Symbol.iterator on some versions.
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  return (rows as Array<{
    id: number; location_id: string; display_name: string; external_id: string | null;
    membership_tier: string | null; mail_label: string | null; mail_city: string | null;
    mail_state: string | null; total_balance: string | null; created_at: Date; updated_at: Date;
    member_count: string; payment_count: string; total_given: string;
  }>).map((r) => ({
    id: r.id,
    locationId: r.location_id,
    displayName: r.display_name,
    externalId: r.external_id,
    membershipTier: r.membership_tier,
    mailLabel: r.mail_label,
    mailAddress1: null,
    mailAddress2: null,
    mailCity: r.mail_city,
    mailState: r.mail_state,
    mailZip: null,
    mailCountry: null,
    householdPhone: null,
    householdEmail: null,
    dateJoined: null,
    totalBalance: r.total_balance,
    notes: null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    memberCount: Number(r.member_count),
    paymentCount: Number(r.payment_count),
    totalGiven: r.total_given,
  }));
}

export async function getHousehold(
  locationId: string,
  id: number,
): Promise<Household | null> {
  const rows = await db
    .select()
    .from(household)
    .where(and(eq(household.id, id), eq(household.locationId, locationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createHousehold(input: NewHousehold): Promise<Household> {
  const [row] = await db.insert(household).values(input).returning();
  return row;
}

export async function updateHousehold(
  locationId: string,
  id: number,
  patch: Partial<NewHousehold>,
): Promise<Household | null> {
  const [row] = await db
    .update(household)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(household.id, id), eq(household.locationId, locationId)))
    .returning();
  return row ?? null;
}

/** Members of a household, sorted primary first. */
export async function listHouseholdMembers(
  locationId: string,
  householdId: number,
) {
  return db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      isPrimaryContact: contact.isPrimaryContact,
      relationship: contact.relationship,
    })
    .from(contact)
    .where(
      and(
        eq(contact.householdId, householdId),
        eq(contact.locationId, locationId),
      ),
    )
    .orderBy(desc(contact.isPrimaryContact), contact.firstName);
}

/**
 * Payments visible on any member of a household.
 *   scope=household → payments attached at the household level
 *   scope=personal  → payments attributed to a specific contact
 */
export async function listHouseholdPayments(
  householdId: number,
  opts: { limit?: number } = {},
) {
  const limit = Math.min(opts.limit ?? 200, 1000);
  return db
    .select({
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      paymentDate: payment.paymentDate,
      paymentMethod: payment.paymentMethod,
      paymentStatus: payment.paymentStatus,
      notes: payment.notes,
      payerContactId: payment.payerContactId,
    })
    .from(payment)
    .where(eq(payment.householdId, householdId))
    .orderBy(desc(payment.paymentDate))
    .limit(limit);
}
