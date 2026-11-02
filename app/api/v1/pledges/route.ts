/**
 * POST /api/v1/pledges — record a single pledge.
 *
 * The pledge carries the donor inline. If that donor doesn't exist yet we
 * create them first (email → phone → external id), then record the pledge.
 * Idempotent on `reference`. Scope: `pledges:write`.
 *
 * Body: { "contact": { ...donor fields... },
 *         "amount","currency","date","reference","campaign",
 *         "description","note","exchangeRate" }
 */
import { authorize, apiError, apiOk, readJson } from "@/lib/api-keys/http";
import {
  upsertContactFromApi,
  recordPledgeFromApi,
  ApiIngestError,
  type ApiContactInput,
  type ApiPledgeInput,
} from "@/lib/api-keys/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authz = await authorize(req, "pledges:write");
  if ("response" in authz) return authz.response;

  const parsed = await readJson(req);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;

  // GHL's standard Webhook action can only send flat key/value pairs, so when
  // there's no nested `contact` object accept the donor's fields at top level.
  const contact = (
    body.contact ??
    (body.email || body.phone || body.name || body.firstName
      ? {
          firstName: body.firstName,
          lastName: body.lastName,
          name: body.name,
          email: body.email,
          phone: body.phone,
          address: body.address,
          externalId: body.externalId,
        }
      : null)
  ) as ApiContactInput | null;
  if (!contact || typeof contact !== "object") {
    return apiError(
      400,
      "Missing 'contact' object — a pledge must identify its donor.",
    );
  }
  if (!contact.email && !contact.phone && !contact.name && !contact.firstName) {
    return apiError(
      422,
      "Contact needs at least one of: email, phone, or a name.",
    );
  }
  if (!body.reference) {
    return apiError(422, "Pledge must include a unique 'reference'.");
  }

  try {
    const contactResult = await upsertContactFromApi(authz.ctx.locationId, contact);
    const result = await recordPledgeFromApi(
      authz.ctx.locationId,
      contactResult.contactId,
      body as unknown as ApiPledgeInput,
    );
    return apiOk(
      {
        contact: {
          id: contactResult.contactId,
          matchedBy: contactResult.matchedBy,
          created: contactResult.created,
        },
        pledge: {
          id: result.pledgeId,
          status: result.duplicate ? "duplicate" : "recorded",
        },
      },
      result.duplicate ? 200 : 201,
    );
  } catch (err) {
    if (err instanceof ApiIngestError) return apiError(422, err.message);
    console.error("[api.v1.pledges] record failed:", err);
    return apiError(500, "Failed to record the pledge.");
  }
}
