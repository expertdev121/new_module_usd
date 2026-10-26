/**
 * Posts one closed deposit to QuickBooks. Safe to retry: before creating anything it looks for an
 * entry already posted for this deposit (either entry type) and adopts it, and the create call carries
 * a request id so QuickBooks itself returns the original result for a repeated request. A deposit that
 * already has a QuickBooks id is never posted again.
 */
import { sql } from "drizzle-orm";
import { QboApiError, qboRequest } from "./client";
import type { AccessContext } from "./connection";
import { buildQboPayload, type PostDeposit, type QboEntity } from "./payload";
import { auditCte } from "../audit";
import { errorText, rows } from "../sql-helpers";
import { toCents } from "../build-entry";

/** A deposit that cannot be posted as it stands; the message says what to fix, in plain words. */
export class PostProblem extends Error {}

export async function loadPostDeposit(locationId: string, depositId: number): Promise<{ deposit: PostDeposit; status: string }> {
  const [d] = await rows(sql`select id, deposit_date::text as deposit_date, external_ref, status, external_id from deposits where id = ${depositId} and location_id = ${locationId}`);
  if (!d) throw new PostProblem("Deposit not found.");
  const lines = await rows(sql`
    select dl.debit::text as debit, dl.credit::text as credit, dl.memo,
           la.name as account_name, la.external_id as account_ext, la.active as account_active,
           ld.name as class_name, ld.external_id as class_ext, ld.active as class_active, dl.account_id, dl.dimension_id
    from deposit_lines dl
    left join ledger_accounts la on la.id = dl.account_id
    left join ledger_dimensions ld on ld.id = dl.dimension_id
    where dl.deposit_id = ${depositId}
    order by dl.credit desc, dl.id`);

  const problems = new Set<string>();
  const out: PostDeposit["lines"] = [];
  for (const l of lines) {
    if (!l.account_id || !l.account_name) {
      problems.add("A line has no account. Reopen the deposit and fix the mappings.");
      continue;
    }
    if (!l.account_ext) problems.add(`Account "${l.account_name}" is not linked to QuickBooks. Use Refresh from QuickBooks, then map it again.`);
    else if (l.account_active === false) problems.add(`Account "${l.account_name}" is inactive in QuickBooks.`);
    if (l.dimension_id) {
      if (!l.class_ext) problems.add(`Class "${l.class_name}" is not linked to QuickBooks. Use Refresh from QuickBooks.`);
      else if (l.class_active === false) problems.add(`Class "${l.class_name}" is inactive in QuickBooks.`);
    }
    out.push({
      accountExternalId: String(l.account_ext ?? ""),
      classExternalId: l.class_ext ? String(l.class_ext) : null,
      debitCents: toCents(String(l.debit)),
      creditCents: toCents(String(l.credit)),
      memo: (l.memo as string | null) ?? null,
    });
  }
  if (out.length === 0 && problems.size === 0) problems.add("The deposit has no entry lines.");
  if (problems.size > 0) throw new PostProblem(Array.from(problems).join(" "));
  return {
    status: String(d.status),
    deposit: { id: Number(d.id), depositDate: String(d.deposit_date), reference: (d.external_ref as string | null) ?? null, lines: out },
  };
}

/**
 * Looks for an entry we already posted for this deposit.
 * JournalEntry keeps our DocNumber (DHQ-<id>), so that is queried directly.
 * A QuickBooks Deposit does NOT keep a document number (verified against a real sandbox), so we match its
 * PrivateNote ("DonorHQ deposit #<id> ...") among the deposits dated the same day.
 */
async function findExisting(ctx: AccessContext, entity: QboEntity, docNumber: string, d: PostDeposit): Promise<string | null> {
  type Resp = { QueryResponse?: Record<string, Array<{ Id: string; PrivateNote?: string }> | undefined> };
  if (entity === "JournalEntry") {
    const r = await qboRequest<Resp>({ ...ctx, path: "query", query: { query: `select Id from JournalEntry where DocNumber = '${docNumber}'` } });
    return r.QueryResponse?.JournalEntry?.[0]?.Id ?? null;
  }
  const r = await qboRequest<Resp>({ ...ctx, path: "query", query: { query: `select Id, PrivateNote from Deposit where TxnDate = '${d.depositDate}' maxresults 1000` } });
  const marker = new RegExp(`^DonorHQ deposit #${d.id}(\\s|\\||$)`);
  return r.QueryResponse?.Deposit?.find((x) => x.PrivateNote && marker.test(x.PrivateNote))?.Id ?? null;
}

export async function postDeposit(params: {
  ctx: AccessContext;
  locationId: string;
  userId: number | null;
  depositId: number;
  entryType: QboEntity;
}): Promise<{ externalId: string; adopted: boolean }> {
  const { ctx, locationId, userId, depositId, entryType } = params;
  const { deposit, status } = await loadPostDeposit(locationId, depositId);
  if (status !== "closed") throw new PostProblem(`The deposit is ${status}; only closed deposits are posted.`);
  const payload = buildQboPayload(entryType, deposit);

  // Already there from an earlier attempt (e.g. we posted but crashed before saving the id)?
  let externalId: string | null = null;
  let adopted = false;
  // Check both entry types, the selected one first: if the entry type setting was switched between a
  // crash and the retry, the earlier entry is of the other type and must still be found, not duplicated.
  const kinds: QboEntity[] = [payload.entity, payload.entity === "Deposit" ? "JournalEntry" : "Deposit"];
  for (const kind of kinds) {
    try {
      const hit = await findExisting(ctx, kind, payload.docNumber, deposit);
      if (hit) {
        externalId = hit;
        adopted = true;
        break;
      }
    } catch (err) {
      if (!(err instanceof QboApiError)) throw err; // auth problems must surface; a failed lookup just means "not found"
    }
  }

  if (!externalId) {
    const created = await qboRequest<Record<string, { Id?: string } | undefined>>({
      ...ctx,
      method: "POST",
      path: payload.entity.toLowerCase(),
      body: payload.body,
      requestId: payload.requestId,
    });
    externalId = created[payload.entity]?.Id ?? null;
    if (!externalId) throw new QboApiError("QuickBooks accepted the entry but did not return its id.", 502);
  }

  // The entry now exists in QuickBooks. Whatever happens next, the message must say so: telling the user "not
  // posted" here would invite someone to enter it by hand and create a real duplicate.
  let marked: unknown[];
  try {
    marked = await rows(sql`
      with m as (
        update deposits
        set status = 'exported', external_id = ${externalId}, posted_at = now(), exported_at = now(), exported_by = ${userId}, updated_at = now()
        where id = ${depositId} and location_id = ${locationId} and status = 'closed'
        returning id
      ), ${auditCte("a", { locationId, userId, action: "qbo_post", object: "deposit", objectId: depositId, after: { entity: payload.entity, externalId, docNumber: payload.docNumber, adopted } }, { whenRows: "m" })}
      select id from m`);
  } catch (err) {
    console.error("[qbo-post] posted to QuickBooks but could not save the result:", errorText(err));
    throw new PostProblem(
      `This deposit WAS posted to QuickBooks (${payload.entity} ${externalId}) but DonorHQ could not save that. Do not enter it again: press Retry and DonorHQ will link to the existing entry.`,
    );
  }
  if (marked.length === 0) {
    throw new PostProblem(`Posted to QuickBooks as ${payload.entity} ${externalId}, but the deposit changed in DonorHQ meanwhile. Check it in QuickBooks before retrying.`);
  }
  return { externalId, adopted };
}
