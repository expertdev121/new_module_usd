/**
 * Data access for Settings > Accounting. Every query is scoped by locationId and
 * every write goes to accounting_audit (append-only). Ids that arrive from the
 * client are verified to belong to the same location before they are stored.
 */
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaign, manualDonation } from "@/lib/db/schema";
import {
  accountingSettings,
  fundMap,
  ledgerAccounts,
  ledgerDimensions,
  sourceMap,
} from "@/lib/db/schema-accounting";
import { redactAlertUrl } from "./alert-url";
import { auditCte, auditInsert, writeAuditSafe } from "./audit";
import { ACCOUNTING_SOURCES } from "./normalize-payment-method";
import { inChunks, rows as sqlRows } from "./sql-helpers";

export class AccountingInputError extends Error {}

export const SETTINGS_DEFAULTS = {
  system: "quickbooks_online" as string,
  basis: "cash" as "cash" | "accrual",
  startDate: null as string | null,
  unmappedAccountId: null as number | null,
  entryType: "deposit" as "deposit" | "journal_entry",
  autoSyncEnabled: false,
  alertWebhookUrl: null as string | null,
  alertEmails: null as string | null,
};
/** `alertWebhookUrl` may be left out of a save: the stored value is then kept as it is. */
export type SettingsInput = Omit<typeof SETTINGS_DEFAULTS, "alertWebhookUrl" | "alertEmails"> & { alertWebhookUrl?: string | null; alertEmails?: string | null };

/** Throws unless every id is an account (or class) of this location. */
async function assertOwned(kind: "account" | "class", locationId: string, ids: Array<number | null | undefined>) {
  const wanted = Array.from(new Set(ids.filter((x): x is number => typeof x === "number")));
  if (wanted.length === 0) return;
  const table = kind === "account" ? ledgerAccounts : ledgerDimensions;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.locationId, locationId), inArray(table.id, wanted)));
  if (rows.length !== wanted.length) throw new AccountingInputError(`Unknown ${kind} for this organization`);
}

// ---------- General ----------
export async function getSettings(locationId: string) {
  const [row] = await db.select().from(accountingSettings).where(eq(accountingSettings.locationId, locationId)).limit(1);
  if (!row) return { ...SETTINGS_DEFAULTS, configured: false };
  return {
    system: row.system,
    basis: row.basis as "cash" | "accrual",
    startDate: row.startDate,
    unmappedAccountId: row.unmappedAccountId,
    entryType: row.entryType as "deposit" | "journal_entry",
    autoSyncEnabled: row.autoSyncEnabled,
    alertWebhookUrl: row.alertWebhookUrl,
    alertEmails: row.alertEmails,
    configured: true,
  };
}

/** The audit trail records how many alert addresses are set, not the addresses themselves. */
const countEmails = (v: string | null | undefined) => (v ? `${v.split(",").length} address(es)` : null);

export const START_DATE_MESSAGE =
  "Set the go-live (start) date in Accounting > General first. Only gifts dated on or after it can be deposited, so older donations never reach your books by accident.";

/** The accounting start date, or a plain-words error. Deposits cannot be created without one. */
export async function requireStartDate(locationId: string): Promise<string> {
  const s = await getSettings(locationId);
  if (!s.startDate) throw new AccountingInputError(START_DATE_MESSAGE);
  return s.startDate;
}

export async function saveSettings(locationId: string, userId: number | null, input: SettingsInput) {
  await assertOwned("account", locationId, [input.unmappedAccountId]);
  const before = await getSettings(locationId);
  // The change and its audit row commit together (one HTTP transaction) or not at all.
  await db.batch([
    db
      .insert(accountingSettings)
      .values({ locationId, ...input })
      .onConflictDoUpdate({ target: accountingSettings.locationId, set: { ...input, updatedAt: new Date() } }),
    // The alert URL acts like a password: the audit trail keeps only its host.
    auditInsert({
      locationId,
      userId,
      action: "settings_update",
      object: "accounting_settings",
      before: { ...before, alertWebhookUrl: redactAlertUrl(before.alertWebhookUrl), alertEmails: countEmails(before.alertEmails) },
      after: { ...input, alertWebhookUrl: input.alertWebhookUrl === undefined ? "(unchanged)" : redactAlertUrl(input.alertWebhookUrl), alertEmails: input.alertEmails === undefined ? "(unchanged)" : countEmails(input.alertEmails) },
    }),
  ]);
}

// ---------- Chart of accounts / classes ----------
export async function listLedger(locationId: string) {
  const [accounts, classes] = await Promise.all([
    db
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.locationId, locationId))
      .orderBy(sql`${ledgerAccounts.number} asc nulls last`, asc(ledgerAccounts.name)),
    db.select().from(ledgerDimensions).where(eq(ledgerDimensions.locationId, locationId)).orderBy(asc(ledgerDimensions.name)),
  ]);
  return { accounts, classes };
}

export interface LedgerRowInput {
  name: string;
  number?: string | null;
  type?: string | null;
  active?: boolean;
}

const low = (s: string) => s.trim().toLowerCase();

interface CleanRow {
  name: string;
  number: string | null;
  type: string | null;
  active: boolean;
}

/**
 * Upsert by account number (accounts) or name; never deletes, because mappings may point at a row.
 * All rows are matched in memory first, then written in batched statements (a few HTTP calls, not one per
 * row), and rows repeated inside the same upload collapse into one (the last one wins).
 */
export async function importLedger(locationId: string, userId: number | null, kind: "account" | "class", rows: LedgerRowInput[]) {
  const clean: CleanRow[] = rows.map((r) => ({ name: r.name.trim(), number: r.number?.trim() || null, type: r.type?.trim() || null, active: r.active ?? true }));
  const updates = new Map<number, CleanRow>(); // existing row id -> fields
  const fresh: CleanRow[] = []; // rows to insert
  const freshByNumber = new Map<string, number>();
  const freshByName = new Map<string, number>();

  const place = (r: CleanRow, existingHit: { id: number } | undefined) => {
    if (existingHit) {
      updates.set(existingHit.id, r);
      return;
    }
    const idx = (r.number ? freshByNumber.get(low(r.number)) : undefined) ?? freshByName.get(low(r.name));
    if (idx !== undefined) {
      fresh[idx] = r; // same row repeated in this upload
      return;
    }
    fresh.push(r);
    if (r.number) freshByNumber.set(low(r.number), fresh.length - 1);
    freshByName.set(low(r.name), fresh.length - 1);
  };

  if (kind === "account") {
    const existing = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.locationId, locationId));
    const byNumber = new Map(existing.filter((e) => e.number).map((e) => [low(e.number!), e]));
    const byName = new Map(existing.map((e) => [low(e.name), e]));
    for (const r of clean) place(r, (r.number ? byNumber.get(low(r.number)) : undefined) ?? byName.get(low(r.name)));
    await inChunks([...updates], (c) =>
      db.batch(
        c.map(([id, f]) =>
          db.update(ledgerAccounts).set({ name: f.name, number: f.number, type: f.type, active: f.active, updatedAt: new Date() }).where(and(eq(ledgerAccounts.id, id), eq(ledgerAccounts.locationId, locationId))),
        ) as never,
      ),
    );
    await inChunks(fresh, (c) => db.insert(ledgerAccounts).values(c.map((f) => ({ locationId, name: f.name, number: f.number, type: f.type, active: f.active }))));
  } else {
    const existing = await db.select().from(ledgerDimensions).where(eq(ledgerDimensions.locationId, locationId));
    const byName = new Map(existing.map((e) => [low(e.name), e]));
    for (const r of clean) place(r, byName.get(low(r.name)));
    await inChunks([...updates], (c) =>
      db.batch(c.map(([id, f]) => db.update(ledgerDimensions).set({ active: f.active, updatedAt: new Date() }).where(and(eq(ledgerDimensions.id, id), eq(ledgerDimensions.locationId, locationId)))) as never),
    );
    await inChunks(fresh, (c) => db.insert(ledgerDimensions).values(c.map((f) => ({ locationId, name: f.name, active: f.active }))));
  }
  const created = fresh.length;
  const updated = updates.size;
  // Summary row: best effort (it has no single statement to join, and must not fail a finished import).
  await writeAuditSafe({ locationId, userId, action: "ledger_import", object: kind === "account" ? "ledger_accounts" : "ledger_dimensions", after: { rows: rows.length, created, updated } });
  return { created, updated };
}

export async function setLedgerActive(locationId: string, userId: number | null, kind: "account" | "class", id: number, active: boolean) {
  const table = kind === "account" ? "ledger_accounts" : "ledger_dimensions"; // fixed names, never user input
  // The audit row is written in the same statement, and only if a row was actually changed.
  const res = await sqlRows(sql`
    with u as (
      update ${sql.raw(table)} set active = ${active}, updated_at = now()
      where id = ${id} and location_id = ${locationId} returning id
    ), ${auditCte("a", { locationId, userId, action: "ledger_active", object: kind, objectId: id, after: { active } }, { whenRows: "u" })}
    select id from u`);
  if (res.length === 0) throw new AccountingInputError("Not found");
}

// ---------- Funds (= campaigns) ----------
export async function listFunds(locationId: string) {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [campaigns, maps, recent] = await Promise.all([
    db.select({ id: campaign.id, name: campaign.name, status: campaign.status }).from(campaign).where(eq(campaign.locationId, locationId)).orderBy(asc(campaign.name)),
    db.select().from(fundMap).where(eq(fundMap.locationId, locationId)),
    db
      .select({ campaignId: manualDonation.campaignId, n: sql<number>`count(*)::int` })
      .from(manualDonation)
      .where(and(eq(manualDonation.locationId, locationId), gte(manualDonation.paymentDate, since), eq(manualDonation.paymentStatus, "completed")))
      .groupBy(manualDonation.campaignId),
  ]);
  const mapBy = new Map(maps.map((m) => [m.campaignId, m]));
  const recentBy = new Map(recent.map((r) => [r.campaignId, r.n]));
  return campaigns.map((c) => {
    const m = mapBy.get(c.id);
    return {
      campaignId: c.id,
      name: c.name,
      status: c.status,
      incomeAccountId: m?.incomeAccountId ?? null,
      dimensionId: m?.dimensionId ?? null,
      arAccountId: m?.arAccountId ?? null,
      giftsLast90Days: recentBy.get(c.id) ?? 0,
    };
  });
}

export async function saveFund(
  locationId: string,
  userId: number | null,
  campaignId: number,
  v: { incomeAccountId: number | null; dimensionId: number | null; arAccountId: number | null },
) {
  const [c] = await db.select({ id: campaign.id }).from(campaign).where(and(eq(campaign.id, campaignId), eq(campaign.locationId, locationId))).limit(1);
  if (!c) throw new AccountingInputError("Unknown campaign for this organization");
  await assertOwned("account", locationId, [v.incomeAccountId, v.arAccountId]);
  await assertOwned("class", locationId, [v.dimensionId]);
  const [before] = await db.select().from(fundMap).where(and(eq(fundMap.locationId, locationId), eq(fundMap.campaignId, campaignId))).limit(1);
  await db.batch([
    db
      .insert(fundMap)
      .values({ locationId, campaignId, ...v, updatedBy: userId })
      .onConflictDoUpdate({ target: [fundMap.locationId, fundMap.campaignId], set: { ...v, updatedBy: userId, updatedAt: new Date() } }),
    auditInsert({ locationId, userId, action: "fund_map_update", object: "fund_map", objectId: campaignId, before: before ?? null, after: v }),
  ]);
}

// ---------- Payment sources ----------
export async function listSources(locationId: string) {
  const rows = await db.select().from(sourceMap).where(eq(sourceMap.locationId, locationId));
  const by = new Map(rows.map((r) => [r.source, r]));
  return ACCOUNTING_SOURCES.map((s) => ({
    source: s,
    depositAccountId: by.get(s)?.depositAccountId ?? null,
    feeAccountId: by.get(s)?.feeAccountId ?? null,
  }));
}

export async function saveSource(
  locationId: string,
  userId: number | null,
  source: string,
  v: { depositAccountId: number | null; feeAccountId: number | null },
) {
  if (!(ACCOUNTING_SOURCES as readonly string[]).includes(source)) throw new AccountingInputError("Unknown payment source");
  await assertOwned("account", locationId, [v.depositAccountId, v.feeAccountId]);
  const [before] = await db.select().from(sourceMap).where(and(eq(sourceMap.locationId, locationId), eq(sourceMap.source, source))).limit(1);
  await db.batch([
    db
      .insert(sourceMap)
      .values({ locationId, source, ...v })
      .onConflictDoUpdate({ target: [sourceMap.locationId, sourceMap.source], set: v }),
    auditInsert({ locationId, userId, action: "source_map_update", object: "source_map", objectId: source, before: before ?? null, after: v }),
  ]);
}
