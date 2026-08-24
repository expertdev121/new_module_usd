/**
 * POST /api/v1/donors — the primary "connect your platform" endpoint.
 *
 * Push one donor plus every gift you have for them in a single call. We
 * find-or-create the contact (email → phone → external id, tenant-scoped),
 * then record each donation idempotently on its `reference`. A donor with an
 * empty `donations` array is a pure contact upsert.
 *
 * Auth: API key resolves the account. Needs `contacts:write`, plus
 * `donations:write` when the `donations` array is non-empty.
 *
 * Body:
 * {
 *   "contact":   { "firstName","lastName","email","phone","address","externalId" },
 *   "donations": [ { "amount","currency","date","reference","campaign",
 *                    "paymentMethod","designation","note","status" }, ... ]
 * }
 */
import { authenticateApiRequest, requireScope } from "@/lib/api-keys/authenticate";
import { apiError, apiOk, readJson } from "@/lib/api-keys/http";
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
  const auth = await authenticateApiRequest(req.headers);
  if (!auth.ok) return apiError(auth.status, auth.error);

  const parsed = await readJson(req);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;

  const contact = (body.contact ?? null) as ApiContactInput | null;
  if (!contact || typeof contact !== "object") {
    return apiError(400, "Missing 'contact' object.");
  }
  const donations = Array.isArray(body.donations)
    ? (body.donations as ApiDonationInput[])
    : [];

  // Scope checks — contacts always; donations only when some are present.
  const needContacts = requireScope(auth.ctx, "contacts:write");
  if (!needContacts.ok) return apiError(needContacts.status, needContacts.error);
  if (donations.length > 0) {
    const needDonations = requireScope(auth.ctx, "donations:write");
    if (!needDonations.ok)
      return apiError(needDonations.status, needDonations.error);
  }

  if (!contact.email && !contact.phone && !contact.name && !contact.firstName) {
    return apiError(
      422,
      "Contact needs at least one of: email, phone, or a name.",
    );
  }

  let contactResult;
  try {
    contactResult = await upsertContactFromApi(auth.ctx.locationId, contact);
  } catch (err) {
    console.error("[api.v1.donors] contact upsert failed:", err);
    return apiError(500, "Failed to create or update the contact.");
  }

  // Record each donation, capturing per-item outcomes so one bad row doesn't
  // sink the whole batch.
  const results: Array<Record<string, unknown>> = [];
  let recorded = 0;
  let duplicates = 0;
  let failed = 0;
  for (const d of donations) {
    try {
      const r = await recordDonationFromApi(
        auth.ctx.locationId,
        contactResult.contactId,
        d,
      );
      if (r.duplicate) duplicates++;
      else recorded++;
      results.push({
        reference: d?.reference ?? null,
        donationId: r.donationId,
        status: r.duplicate ? "duplicate" : "recorded",
      });
    } catch (err) {
      failed++;
      results.push({
        reference: d?.reference ?? null,
        status: "error",
        error:
          err instanceof ApiIngestError
            ? err.message
            : "Failed to record donation.",
      });
      if (!(err instanceof ApiIngestError))
        console.error("[api.v1.donors] donation insert failed:", err);
    }
  }

  return apiOk(
    {
      contact: {
        id: contactResult.contactId,
        matchedBy: contactResult.matchedBy,
        created: contactResult.created,
      },
      donations: results,
      summary: { recorded, duplicates, failed, total: donations.length },
    },
    contactResult.created ? 201 : 200,
  );
}
