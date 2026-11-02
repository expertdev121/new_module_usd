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

  // GHL's standard Webhook action sends the donor as flat top-level fields
  // (email, phone, first_name, last_name, full_name) and its own unrelated
  // `contact` object, so top-level fields win and a nested `contact` is the
  // fallback for direct API callers.
  const nested = (
    body.contact && typeof body.contact === "object" ? body.contact : {}
  ) as Record<string, unknown>;
  const pick = (...vals: unknown[]) =>
    vals.find((v) => typeof v === "string" && v.trim()) as string | undefined;
  const contact: ApiContactInput = {
    firstName: pick(body.firstName, body.first_name, nested.firstName),
    lastName: pick(body.lastName, body.last_name, nested.lastName),
    name: pick(body.name, body.full_name, nested.name),
    email: pick(body.email, nested.email),
    phone: pick(body.phone, nested.phone),
    address: pick(body.address, nested.address),
    externalId: pick(body.externalId, nested.externalId),
  };
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
