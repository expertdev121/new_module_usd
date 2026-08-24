/**
 * POST /api/v1/contacts — add (or update) a single donor.
 *
 * Find-or-create by email → phone → external id, tenant-scoped to the API
 * key's account, and mirror to GHL best-effort. Scope: `contacts:write`.
 *
 * Body: { "firstName","lastName","name","email","phone","address","externalId" }
 * (either firstName/lastName or a single "name"; at least one of email/phone/name).
 */
import { authorize, apiError, apiOk, readJson } from "@/lib/api-keys/http";
import { upsertContactFromApi, type ApiContactInput } from "@/lib/api-keys/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authz = await authorize(req, "contacts:write");
  if ("response" in authz) return authz.response;

  const parsed = await readJson(req);
  if ("response" in parsed) return parsed.response;
  const input = parsed.body as ApiContactInput;

  if (!input.email && !input.phone && !input.name && !input.firstName) {
    return apiError(
      422,
      "Contact needs at least one of: email, phone, or a name.",
    );
  }

  try {
    const result = await upsertContactFromApi(authz.ctx.locationId, input);
    return apiOk(
      {
        id: result.contactId,
        matchedBy: result.matchedBy,
        created: result.created,
      },
      result.created ? 201 : 200,
    );
  } catch (err) {
    console.error("[api.v1.contacts] upsert failed:", err);
    return apiError(500, "Failed to create or update the contact.");
  }
}
