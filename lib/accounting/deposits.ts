/**
 * Manual deposits (checks, cash, ACH): group undeposited gifts into a deposit, build its
 * entry when it is closed, reopen or void it. Every query is scoped by locationId.
 *
 * The Neon HTTP driver has no interactive transactions, so each multi-step change is one
 * atomic statement (data-modifying CTEs) or one db.batch. manual_donation.deposit_id is
 * written with raw SQL so lib/db/schema.ts does not need to change.
 *
 * Guards against double entry: deposit_transactions.manual_donation_id is unique, so a gift
 * can only ever sit in one deposit even if two people click at once.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  depositLines,
  deposits,
  fundMap,
  sourceMap,
} from "@/lib/db/schema-accounting";
import { auditCte, auditInsert } from "./audit";
import { AccountingInputError, getSettings, requireStartDate } from "./settings";
import { errorText, intArray, rows, textArray, type Row } from "./sql-helpers";
import { buildEntry, fromCents, toCents, type BuiltEntry } from "./build-entry";
import {
  KNOWN_RAW_METHODS,
  MANUAL_SOURCES,
  SOURCE_LABELS,
  rawMethodsFor,
  type AccountingSource,
  type ManualSource,
} from "./normalize-payment-method";

const MAX_GIFTS = 500;

function assertManualSource(source: string): asserts source is ManualSource {
  if (!(MANUAL_SOURCES as readonly string[]).includes(source)) {
    throw new AccountingInputError("Manual deposits are for check, cash, ACH, bank transfer or other payments.");
  }
}

function sourcePredicate(source: AccountingSource): SQL {
  if (source === "other") {
    return sql`(md.payment_method is null or lower(trim(md.payment_method)) <> all(${textArray(KNOWN_RAW_METHODS)}))`;
  }
  return sql`lower(trim(md.payment_method)) = any(${textArray(rawMethodsFor(source))})`;
}

// ---------- Undeposited funds ----------
export interface UndepositedFilters {
  source: string;
  from?: string | null;
  to?: string | null;
  limit?: number;
}

export async function listUndeposited(locationId: string, f: UndepositedFilters) {
  assertManualSource(f.source);
  const settings = await getSettings(locationId);
  // No start date yet: show nothing (and say why) instead of every gift ever recorded.
  if (!settings.startDate) return { gifts: [], truncated: false, startDate: null, nonUsdSkipped: 0, needsStartDate: true };
  const limit = Math.min(Math.max(f.limit ?? 300, 1), MAX_GIFTS);
  const base = sql`
    md.location_id = ${locationId}
    and md.deposit_id is null
    and md.payment_status = 'completed'
    and md.currency = 'USD'
    ${settings.startDate ? sql`and md.payment_date >= ${settings.startDate}` : sql``}
    ${f.from ? sql`and md.payment_date >= ${f.from}` : sql``}
    ${f.to ? sql`and md.payment_date <= ${f.to}` : sql``}`;

  const list = await rows(sql`
    select md.id, md.payment_date::text as payment_date, md.amount::text as amount, md.payment_method, md.method_detail,
           md.check_number, md.reference_number, md.campaign_id, c.name as campaign_name,
           ct.first_name, ct.last_name
    from manual_donation md
    left join campaign c on c.id = md.campaign_id
    left join contact ct on ct.id = md.contact_id
    where ${base} and ${sourcePredicate(f.source)}
    order by md.payment_date desc, md.id desc
    limit ${limit + 1}`);

  const [skipped] = await rows(sql`
    select count(*)::int as n from manual_donation md
    where md.location_id = ${locationId} and md.deposit_id is null and md.payment_status = 'completed' and md.currency <> 'USD'
    ${settings.startDate ? sql`and md.payment_date >= ${settings.startDate}` : sql``}`);

  const truncated = list.length > limit;
  return {
    gifts: list.slice(0, limit).map((r) => ({
      id: Number(r.id),
      date: String(r.payment_date),
      amount: String(r.amount),
      method: (r.payment_method as string | null) ?? null,
      methodDetail: (r.method_detail as string | null) ?? null,
      checkNumber: (r.check_number as string | null) ?? null,
      reference: (r.reference_number as string | null) ?? null,
      campaignId: r.campaign_id == null ? null : Number(r.campaign_id),
      campaignName: (r.campaign_name as string | null) ?? null,
      donor: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown",
    })),
    truncated,
    startDate: settings.startDate,
    nonUsdSkipped: Number(skipped?.n ?? 0),
    needsStartDate: false,
  };
}

// ---------- Create ----------
export interface CreateDepositInput {
  source: string;
  depositDate: string;
  bankReference?: string | null;
  giftIds: number[];
}

/** Gifts that may go into a deposit of this source: ours, completed, USD, undeposited, matching source. */
async function eligibleGifts(locationId: string, source: ManualSource, ids: number[]) {
  const startDate = await requireStartDate(locationId);
  return rows(sql`
    select md.id, md.amount::text as amount
    from manual_donation md
    where md.id = any(${intArray(ids)})
      and md.location_id = ${locationId}
      and md.deposit_id is null
      and md.payment_status = 'completed'
      and md.currency = 'USD'
      and md.payment_date >= ${startDate}
      and ${sourcePredicate(source)}`);
}

function friendlyDbError(err: unknown): never {
  const msg = errorText(err);
  if (msg.includes("deposit_transactions_gift_unique") || msg.includes("deposit_transactions_manual_donation_id")) {
    throw new AccountingInputError("One of those gifts was just added to another deposit. Refresh and try again.");
  }
  if (msg.includes("deposits_source_ref_unique")) {
    throw new AccountingInputError("A deposit with that bank reference already exists for this payment type.");
  }
  throw err;
}

export async function createDeposit(locationId: string, userId: number | null, input: CreateDepositInput) {
  assertManualSource(input.source);
  const ids = Array.from(new Set(input.giftIds));
  if (ids.length === 0) throw new AccountingInputError("Pick at least one gift.");
  if (ids.length > MAX_GIFTS) throw new AccountingInputError(`A deposit can hold at most ${MAX_GIFTS} gifts.`);

  const gifts = await eligibleGifts(locationId, input.source, ids);
  if (gifts.length !== ids.length) {
    throw new AccountingInputError("Some of those gifts are no longer available (already deposited, wrong payment type, or changed). Refresh the list.");
  }
  const gross = fromCents(gifts.reduce((s, g) => s + toCents(String(g.amount)), 0));
  const ref = input.bankReference?.trim() || null;

  try {
    const [created] = await rows(sql`
      with d as (
        insert into deposits (location_id, source, external_ref, deposit_date, gross, net, status, created_by)
        values (${locationId}, ${input.source}, ${ref}, ${input.depositDate}, ${gross}, ${gross}, 'open', ${userId})
        returning id
      ), t as (
        insert into deposit_transactions (deposit_id, manual_donation_id)
        select d.id, g from d, unnest(${intArray(ids)}) as g
        returning manual_donation_id
      ), u as (
        update manual_donation set deposit_id = (select id from d)
        where id in (select manual_donation_id from t) returning id
      ), ${auditCte("a", { locationId, userId, action: "deposit_create", object: "deposit", after: { source: input.source, gifts: ids.length, gross, depositDate: input.depositDate, bankReference: ref } }, { whenRows: "d", objectIdSql: sql`d.id::text` })}
      select (select id from d) as id, (select count(*) from u)::int as n`);
    return { id: Number(created.id) };
  } catch (err) {
    friendlyDbError(err);
  }
}

// ---------- List / detail ----------
export async function listDeposits(locationId: string, status?: string | null) {
  const list = await rows(sql`
    select d.id, d.source, d.external_ref, d.deposit_date::text as deposit_date, d.gross::text as gross, d.net::text as net,
           d.status, d.created_at::text as created_at,
           (select count(*)::int from deposit_transactions dt where dt.deposit_id = d.id) as gift_count
    from deposits d
    where d.location_id = ${locationId} ${status ? sql`and d.status = ${status}` : sql``}
    order by d.deposit_date desc, d.id desc
    limit 200`);
  return list.map((r) => ({
    id: Number(r.id),
    source: String(r.source),
    sourceLabel: SOURCE_LABELS[r.source as AccountingSource] ?? String(r.source),
    reference: (r.external_ref as string | null) ?? null,
    depositDate: String(r.deposit_date),
    gross: String(r.gross),
    net: String(r.net),
    status: String(r.status),
    giftCount: Number(r.gift_count),
  }));
}

async function loadDeposit(locationId: string, id: number) {
  const [d] = await rows(sql`select id, source, external_ref, deposit_date::text as deposit_date, gross::text as gross, net::text as net, status from deposits where id = ${id} and location_id = ${locationId}`);
  if (!d) throw new AccountingInputError("Deposit not found.");
  return d;
}

async function depositGifts(locationId: string, id: number) {
  return rows(sql`
    select md.id, md.payment_date::text as payment_date, md.amount::text as amount, md.check_number, md.campaign_id,
           c.name as campaign_name, ct.first_name, ct.last_name
    from deposit_transactions dt
    join manual_donation md on md.id = dt.manual_donation_id
    left join campaign c on c.id = md.campaign_id
    left join contact ct on ct.id = md.contact_id
    where dt.deposit_id = ${id} and md.location_id = ${locationId}
    order by md.payment_date, md.id`);
}

async function previewFor(locationId: string, source: string, giftRows: Row[]): Promise<BuiltEntry> {
  const [settings, maps, [src]] = await Promise.all([
    getSettings(locationId),
    db.select().from(fundMap).where(eq(fundMap.locationId, locationId)),
    db.select().from(sourceMap).where(and(eq(sourceMap.locationId, locationId), eq(sourceMap.source, source))).limit(1),
  ]);
  return buildEntry({
    gifts: giftRows.map((g) => ({
      id: Number(g.id),
      campaignId: g.campaign_id == null ? null : Number(g.campaign_id),
      campaignName: (g.campaign_name as string | null) ?? null,
      amountCents: toCents(String(g.amount)),
    })),
    fundMap: new Map(maps.map((m) => [m.campaignId, { incomeAccountId: m.incomeAccountId, dimensionId: m.dimensionId }])),
    depositAccountId: src?.depositAccountId ?? null,
    catchAllAccountId: settings.unmappedAccountId,
    sourceLabel: SOURCE_LABELS[source as AccountingSource] ?? source,
  });
}

export async function getDeposit(locationId: string, id: number) {
  const d = await loadDeposit(locationId, id);
  const giftRows = await depositGifts(locationId, id);

  const gifts = giftRows.map((g) => ({
    id: Number(g.id),
    date: String(g.payment_date),
    amount: String(g.amount),
    checkNumber: (g.check_number as string | null) ?? null,
    campaignName: (g.campaign_name as string | null) ?? null,
    donor: [g.first_name, g.last_name].filter(Boolean).join(" ") || "Unknown",
  }));

  let lines: Array<{ account: string | null; accountId: number | null; dimension: string | null; debit: string; credit: string; memo: string | null; unmapped: boolean }>;
  let blockers: string[] = [];
  let unmapped: string[] = [];
  if (d.status === "open") {
    const entry = await previewFor(locationId, String(d.source), giftRows);
    const names = await accountNames(locationId);
    lines = entry.lines.map((l) => ({
      account: l.accountId ? names.accounts.get(l.accountId) ?? null : null,
      accountId: l.accountId,
      dimension: l.dimensionId ? names.classes.get(l.dimensionId) ?? null : null,
      debit: fromCents(l.debitCents),
      credit: fromCents(l.creditCents),
      memo: l.memo,
      unmapped: l.unmapped,
    }));
    blockers = entry.blockers;
    unmapped = entry.unmappedCampaigns.map((u) => u.name);
  } else {
    const stored = await rows(sql`
      select dl.account_id, la.number, la.name as account_name, ld.name as dimension_name, dl.debit::text as debit, dl.credit::text as credit, dl.memo
      from deposit_lines dl
      left join ledger_accounts la on la.id = dl.account_id
      left join ledger_dimensions ld on ld.id = dl.dimension_id
      where dl.deposit_id = ${id}
      order by dl.credit desc, dl.id`);
    lines = stored.map((l) => ({
      account: l.account_name ? `${l.number ? `${l.number} · ` : ""}${l.account_name}` : null,
      accountId: l.account_id == null ? null : Number(l.account_id),
      dimension: (l.dimension_name as string | null) ?? null,
      debit: String(l.debit),
      credit: String(l.credit),
      memo: (l.memo as string | null) ?? null,
      unmapped: String(l.memo ?? "").includes("UNMAPPED"),
    }));
    // Stored memos read "<fund> · N gifts · UNMAPPED"; show just the fund name.
    unmapped = lines.filter((l) => l.unmapped).map((l) => String(l.memo).split(" · ")[0]);
  }

  return {
    id: Number(d.id),
    source: String(d.source),
    sourceLabel: SOURCE_LABELS[d.source as AccountingSource] ?? String(d.source),
    reference: (d.external_ref as string | null) ?? null,
    depositDate: String(d.deposit_date),
    gross: String(d.gross),
    net: String(d.net),
    status: String(d.status),
    gifts,
    lines,
    blockers,
    unmapped,
  };
}

async function accountNames(locationId: string) {
  const [a, c] = await Promise.all([
    rows(sql`select id, number, name from ledger_accounts where location_id = ${locationId}`),
    rows(sql`select id, name from ledger_dimensions where location_id = ${locationId}`),
  ]);
  return {
    accounts: new Map(a.map((r) => [Number(r.id), `${r.number ? `${r.number} · ` : ""}${r.name}`])),
    classes: new Map(c.map((r) => [Number(r.id), String(r.name)])),
  };
}

// ---------- Edit an open deposit ----------
export async function addGifts(locationId: string, userId: number | null, id: number, giftIds: number[]) {
  const d = await loadDeposit(locationId, id);
  if (d.status !== "open") throw new AccountingInputError("Only an open deposit can be changed. Reopen it first.");
  assertManualSource(String(d.source));
  const ids = Array.from(new Set(giftIds));
  if (ids.length === 0) throw new AccountingInputError("Pick at least one gift.");
  const current = (await rows(sql`select count(*)::int as n from deposit_transactions where deposit_id = ${id}`))[0];
  if (Number(current.n) + ids.length > MAX_GIFTS) throw new AccountingInputError(`A deposit can hold at most ${MAX_GIFTS} gifts.`);
  const gifts = await eligibleGifts(locationId, String(d.source) as ManualSource, ids);
  if (gifts.length !== ids.length) throw new AccountingInputError("Some of those gifts are not available for this deposit.");
  try {
    await rows(sql`
      with t as (
        insert into deposit_transactions (deposit_id, manual_donation_id)
        select ${id}, g from unnest(${intArray(ids)}) as g
        where exists (select 1 from deposits where id = ${id} and location_id = ${locationId} and status = 'open')
        returning manual_donation_id
      ), u as (
        update manual_donation set deposit_id = ${id} where id in (select manual_donation_id from t) returning amount
      ), ${auditCte("a", { locationId, userId, action: "deposit_add_gifts", object: "deposit", objectId: id, after: { giftIds: ids } }, { whenRows: "t" })}
      update deposits set gross = gross + coalesce((select sum(amount) from u), 0),
                          net = net + coalesce((select sum(amount) from u), 0), updated_at = now()
      where id = ${id} and location_id = ${locationId} and status = 'open'
      returning id`);
  } catch (err) {
    friendlyDbError(err);
  }
}

export async function removeGifts(locationId: string, userId: number | null, id: number, giftIds: number[]) {
  const d = await loadDeposit(locationId, id);
  if (d.status !== "open") throw new AccountingInputError("Only an open deposit can be changed. Reopen it first.");
  const ids = Array.from(new Set(giftIds));
  if (ids.length === 0) throw new AccountingInputError("Pick at least one gift.");
  await rows(sql`
    with del as (
      delete from deposit_transactions
      where deposit_id = ${id} and manual_donation_id = any(${intArray(ids)})
        and exists (select 1 from deposits where id = ${id} and location_id = ${locationId} and status = 'open')
      returning manual_donation_id
    ), u as (
      update manual_donation set deposit_id = null where id in (select manual_donation_id from del) and deposit_id = ${id} returning amount
    ), ${auditCte("a", { locationId, userId, action: "deposit_remove_gifts", object: "deposit", objectId: id, after: { giftIds: ids } }, { whenRows: "del" })}
    update deposits set gross = gross - coalesce((select sum(amount) from u), 0),
                        net = net - coalesce((select sum(amount) from u), 0), updated_at = now()
    where id = ${id} and location_id = ${locationId} and status = 'open'
    returning id`);
}

// ---------- Close / reopen / void ----------
export async function closeDeposit(locationId: string, userId: number | null, id: number, approveUnmapped: boolean) {
  const d = await loadDeposit(locationId, id);
  if (d.status !== "open") throw new AccountingInputError("Only an open deposit can be closed.");
  const giftRows = await depositGifts(locationId, id);
  const entry = await previewFor(locationId, String(d.source), giftRows);
  if (entry.blockers.length > 0) throw new AccountingInputError(entry.blockers[0]);
  if (entry.unmappedCampaigns.length > 0 && !approveUnmapped) {
    throw new AccountingInputError(`These funds are not mapped and will post to the catch-all account: ${entry.unmappedCampaigns.map((u) => u.name).join(", ")}. Confirm to close anyway.`);
  }
  const gross = fromCents(entry.grossCents);
  await db.batch([
    db.delete(depositLines).where(eq(depositLines.depositId, id)),
    db.insert(depositLines).values(
      entry.lines.map((l) => ({
        depositId: id,
        accountId: l.accountId,
        dimensionId: l.dimensionId,
        debit: fromCents(l.debitCents),
        credit: fromCents(l.creditCents),
        memo: l.memo,
        campaignId: l.campaignId,
      })),
    ),
    db
      .update(deposits)
      .set({ status: "closed", closedAt: new Date(), gross, net: gross, updatedAt: new Date() })
      .where(and(eq(deposits.id, id), eq(deposits.locationId, locationId), eq(deposits.status, "open"))),
    auditInsert({ locationId, userId, action: "deposit_close", object: "deposit", objectId: id, after: { gross, lines: entry.lines.length, unmappedApproved: entry.unmappedCampaigns.map((u) => u.name) } }),
  ]);
}

export async function reopenDeposit(locationId: string, userId: number | null, id: number) {
  const d = await loadDeposit(locationId, id);
  if (d.status !== "closed") throw new AccountingInputError("Only a closed deposit (not yet exported) can be reopened.");
  await db.batch([
    db.delete(depositLines).where(eq(depositLines.depositId, id)),
    db
      .update(deposits)
      .set({ status: "open", closedAt: null, updatedAt: new Date() })
      .where(and(eq(deposits.id, id), eq(deposits.locationId, locationId), eq(deposits.status, "closed"))),
    auditInsert({ locationId, userId, action: "deposit_reopen", object: "deposit", objectId: id }),
  ]);
}

/** Voids an open or closed deposit and releases its gifts back to Undeposited funds. */
export async function voidDeposit(locationId: string, userId: number | null, id: number) {
  const d = await loadDeposit(locationId, id);
  if (d.status !== "open" && d.status !== "closed") {
    throw new AccountingInputError(d.status === "voided" ? "This deposit is already voided." : "An exported deposit needs a reversing entry, which is not available yet.");
  }
  await rows(sql`
    with del as (delete from deposit_transactions where deposit_id = ${id} returning manual_donation_id),
         rel as (update manual_donation set deposit_id = null where deposit_id = ${id} returning id),
         lines as (delete from deposit_lines where deposit_id = ${id} returning id),
         up as (
           update deposits set status = 'voided', external_ref = null, updated_at = now()
           where id = ${id} and location_id = ${locationId} and status in ('open','closed')
           returning id
         ),
         ${auditCte("a", { locationId, userId, action: "deposit_void", object: "deposit", objectId: id, before: { status: d.status, reference: d.external_ref } }, { whenRows: "up" })}
    select id from up`);
}
