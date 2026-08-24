/**
 * POST /api/v1/donations — record a single donation.
 *
 * The donation carries the donor inline. If that donor doesn't exist yet we
 * create them first (email → phone → external id), then record the gift —
 * exactly the "create the contact, then add the donation" flow. Idempotent
 * on `reference`. Scope: `donations:write`.
 *
 * Body: { "contact": { ...donor fields... },
 *         "amount","currency","date","reference","campaign",
 *         "paymentMethod","designation","note","status" }
 */
import { authorize, apiError, apiOk, readJson } from "@/lib/api-keys/http";
import {
  upsertContactFromApi,
  recordDonationFromApi,
  ApiIngestError,
  type ApiContactInput,
  type ApiDonationInput,
} from "@/lib/api-keys/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authz = await authorize(req, "donations:write");
  if ("response" in authz) return authz.response;

  const parsed = await readJson(req);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;

  const contact = (body.contact ?? null) as ApiContactInput | null;
  if (!contact || typeof contact !== "object") {
    return apiError(
      400,
      "Missing 'contact' object — a donation must identify its donor.",
    );
  }
  if (!contact.email && !contact.phone && !contact.name && !contact.firstName) {
    return apiError(
      422,
      "Contact needs at least one of: email, phone, or a name.",
    );
  }
  if (!body.reference) {
    return apiError(422, "Donation must include a unique 'reference'.");
  }

  try {
    const contactResult = await upsertContactFromApi(authz.ctx.locationId, contact);
    const donation = await recordDonationFromApi(
      authz.ctx.locationId,
      contactResult.contactId,
      body as unknown as ApiDonationInput,
    );
    return apiOk(
      {
        contact: {
          id: contactResult.contactId,
          matchedBy: contactResult.matchedBy,
          created: contactResult.created,
        },
        donation: {
          id: donation.donationId,
          status: donation.duplicate ? "duplicate" : "recorded",
        },
      },
      donation.duplicate ? 200 : 201,
    );
  } catch (err) {
    if (err instanceof ApiIngestError) return apiError(422, err.message);
    console.error("[api.v1.donations] record failed:", err);
    return apiError(500, "Failed to record the donation.");
  }
}
