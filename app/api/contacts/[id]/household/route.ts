/**
 * POST   /api/contacts/:contactId/household  { householdId, relationship, setPrimary? }
 *          Attach the contact to a household. Only allowed if the tenant is
 *          in household mode. Contact must belong to the same location as
 *          the household. If contact already has a household, must detach first.
 *
 * DELETE /api/contacts/:contactId/household
 *          Detach the contact. BLOCKED if this contact is is_primary_contact
 *          of its household — the household must have a new primary set first.
 *          On detach, we also NULL out is_primary_contact and relationship.
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contact } from "@/lib/db/schema";
import { household } from "@/lib/db/schema-household";
import { requireHouseholdAdmin } from "@/lib/household/auth-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RELATIONSHIPS = new Set(["primary", "spouse", "child", "family", "other"]);

async function loadContact(contactId: number, locationId: string) {
  const rows = await db
    .select({
      id: contact.id,
      locationId: contact.locationId,
      householdId: contact.householdId,
      isPrimaryContact: contact.isPrimaryContact,
      firstName: contact.firstName,
      lastName: contact.lastName,
    })
    .from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.locationId, locationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireHouseholdAdmin({ requireHouseholdMode: true });
  if (guard.error) return guard.error;
  const locationId = guard.session.user.locationId;

  const { id: cidStr } = await params;
  const contactId = Number(cidStr);
  if (!Number.isFinite(contactId)) {
    return NextResponse.json({ error: "invalid_contact_id" }, { status: 400 });
  }

  let body: { householdId?: unknown; relationship?: unknown; setPrimary?: unknown } = {};
  try { body = await req.json(); } catch {}

  const householdId = Number(body.householdId);
  if (!Number.isFinite(householdId)) {
    return NextResponse.json(
      { error: "invalid_request", message: "householdId is required." },
      { status: 400 },
    );
  }
  const relationship = String(body.relationship ?? "family").toLowerCase();
  if (!RELATIONSHIPS.has(relationship)) {
    return NextResponse.json(
      { error: "invalid_relationship", message: `relationship must be one of: ${[...RELATIONSHIPS].join(", ")}` },
      { status: 400 },
    );
  }
  const setPrimary = Boolean(body.setPrimary);

  // Existence + tenant scoping checks
  const c = await loadContact(contactId, locationId);
  if (!c) return NextResponse.json({ error: "contact_not_found" }, { status: 404 });
  if (c.householdId != null) {
    return NextResponse.json(
      { error: "already_attached", message: "Contact already belongs to a household. Detach first, then attach." },
      { status: 409 },
    );
  }

  const hh = (await db
    .select({ id: household.id, locationId: household.locationId, displayName: household.displayName })
    .from(household)
    .where(and(eq(household.id, householdId), eq(household.locationId, locationId)))
    .limit(1))[0];
  if (!hh) return NextResponse.json({ error: "household_not_found" }, { status: 404 });

  // If setPrimary requested, demote any existing primary first (only one primary per household).
  if (setPrimary || relationship === "primary") {
    await db
      .update(contact)
      .set({ isPrimaryContact: false, updatedAt: new Date() })
      .where(
        and(
          eq(contact.householdId, householdId),
          eq(contact.locationId, locationId),
          eq(contact.isPrimaryContact, true),
        ),
      );
  }

  const [updated] = await db
    .update(contact)
    .set({
      householdId,
      relationship,
      isPrimaryContact: setPrimary || relationship === "primary" ? true : false,
      updatedAt: new Date(),
    })
    .where(and(eq(contact.id, contactId), eq(contact.locationId, locationId)))
    .returning({
      id: contact.id,
      householdId: contact.householdId,
      relationship: contact.relationship,
      isPrimaryContact: contact.isPrimaryContact,
    });

  return NextResponse.json({
    ok: true,
    contact: updated,
    household: { id: hh.id, displayName: hh.displayName },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireHouseholdAdmin({ requireHouseholdMode: true });
  if (guard.error) return guard.error;
  const locationId = guard.session.user.locationId;

  const { id: cidStr } = await params;
  const contactId = Number(cidStr);
  if (!Number.isFinite(contactId)) {
    return NextResponse.json({ error: "invalid_contact_id" }, { status: 400 });
  }
  const c = await loadContact(contactId, locationId);
  if (!c) return NextResponse.json({ error: "contact_not_found" }, { status: 404 });
  if (c.householdId == null) {
    return NextResponse.json({ error: "not_attached" }, { status: 409 });
  }
  if (c.isPrimaryContact === true) {
    return NextResponse.json(
      {
        error: "is_primary",
        message:
          "This contact is the primary contact of the household. Assign a different member as primary before detaching this one.",
      },
      { status: 409 },
    );
  }

  const [updated] = await db
    .update(contact)
    .set({
      householdId: null,
      isPrimaryContact: null,
      relationship: null,
      updatedAt: new Date(),
    })
    .where(and(eq(contact.id, contactId), eq(contact.locationId, locationId)))
    .returning({
      id: contact.id,
      householdId: contact.householdId,
    });

  return NextResponse.json({ ok: true, contact: updated });
}
