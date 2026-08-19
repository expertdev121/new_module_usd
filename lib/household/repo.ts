/**
 * Household + member + donation queries.
 * All read/write for the household feature funnels through here so the
 * routes stay thin and testable.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { household, type Household, type NewHousehold } from "@/lib/db/schema-household";
import { contact, payment, manualDonation } from "@/lib/db/schema";

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
           COALESCE(
             (SELECT COUNT(*)::text FROM payment p WHERE p.household_id = h.id)::int +
             (SELECT COUNT(*)::text FROM manual_donation md WHERE md.household_id = h.id)::int,
             0
           )::text AS payment_count,
           COALESCE(
             (SELECT COALESCE(SUM(p.amount),0) FROM payment p WHERE p.household_id = h.id AND p.payment_status NOT IN ('refunded','failed','cancelled')) +
             (SELECT COALESCE(SUM(md.amount),0) FROM manual_donation md WHERE md.household_id = h.id AND md.payment_status NOT IN ('refunded','failed','cancelled')),
             0
           )::text AS total_given
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
 * All household-level donations, unioned across the two ledger tables.
 * `source` is the ledger the row came from (pledge-linked `payment` vs
 * bulk-import `manual_donation`); the manual_donation row also carries
 * the finer-grained `importSource` provenance tag.
 */
export interface HouseholdPaymentRow {
  id: number;
  source: "payment" | "manual_donation";
  amount: string;
  currency: string;
  paymentDate: string;
  paymentMethod: string | null;
  paymentStatus: string;
  notes: string | null;
  importSource: string | null;
  contactId: number | null;
}

export async function listHouseholdPayments(
  householdId: number,
  opts: { limit?: number } = {},
): Promise<HouseholdPaymentRow[]> {
  const limit = Math.min(opts.limit ?? 200, 1000);
  const rowsRaw = await db.execute<{
    id: number;
    source: string;
    amount: string;
    currency: string;
    payment_date: string;
    payment_method: string | null;
    payment_status: string;
    notes: string | null;
    import_source: string | null;
    contact_id: number | null;
  }>(sql`
    (SELECT id, 'payment' AS source, amount::text, currency::text,
            payment_date::text, payment_method, payment_status::text, notes,
            NULL AS import_source, payer_contact_id AS contact_id
       FROM payment WHERE household_id = ${householdId})
    UNION ALL
    (SELECT id, 'manual_donation' AS source, amount::text, currency::text,
            payment_date::text, payment_method, payment_status::text, notes,
            import_source, contact_id
       FROM manual_donation WHERE household_id = ${householdId})
    ORDER BY payment_date DESC
    LIMIT ${limit}
  `);
  const rows = (rowsRaw as unknown as { rows?: unknown[] }).rows ??
    (rowsRaw as unknown as unknown[]);
  return (rows as Array<{
    id: number; source: string; amount: string; currency: string;
    payment_date: string; payment_method: string | null; payment_status: string;
    notes: string | null; import_source: string | null; contact_id: number | null;
  }>).map((r) => ({
    id: r.id,
    source: r.source as "payment" | "manual_donation",
    amount: r.amount,
    currency: r.currency,
    paymentDate: r.payment_date,
    paymentMethod: r.payment_method,
    paymentStatus: r.payment_status,
    notes: r.notes,
    importSource: r.import_source,
    contactId: r.contact_id,
  }));
}
