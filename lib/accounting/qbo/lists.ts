/**
 * "Refresh from QuickBooks": pulls the chart of accounts and classes into ledger_accounts /
 * ledger_dimensions, keyed by the QuickBooks Id (external_id). It never reads transactions.
 *
 * Rows the org uploaded as CSV before connecting are matched by account number, then by name, so
 * existing fund and payment-source mappings carry over. Rows that disappear from QuickBooks become
 * inactive (never deleted, because mappings may point at them), and mappings that end up pointing at
 * an inactive or unlinked account are reported so the admin can fix them.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fundMap, ledgerAccounts, ledgerDimensions, sourceMap } from "@/lib/db/schema-accounting";
import { writeAuditSafe } from "../audit";
import { getSettings } from "../settings";
import { inChunks, rows } from "../sql-helpers";
import { queryAll } from "./client";
import { getAccessContext } from "./connection";

interface QboAccount { Id: string; Name?: string; FullyQualifiedName?: string; AcctNum?: string; AccountType?: string; Active?: boolean }
interface QboClass { Id: string; Name?: string; FullyQualifiedName?: string; Active?: boolean }

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export interface ListsResult {
  accounts: { created: number; updated: number; linked: number; deactivated: number };
  classes: { created: number; updated: number; linked: number; deactivated: number };
  /** Plain-words problems: a mapping now points at an inactive or unlinked account. */
  attention: string[];
}

export async function refreshFromQuickBooks(locationId: string, userId: number | null): Promise<ListsResult> {
  const ctx = await getAccessContext(locationId);
  const [qAccounts, qClasses] = await Promise.all([queryAll<QboAccount>(ctx, "Account"), queryAll<QboClass>(ctx, "Class")]);

  const accounts = await syncAccounts(locationId, qAccounts);
  const classes = await syncClasses(locationId, qClasses);
  const attention = await mappingsNeedingAttention(locationId);
  await writeAuditSafe({ locationId, userId, action: "qbo_refresh_lists", object: "ledger_accounts", after: { accounts, classes, attention: attention.length } });
  return { accounts, classes, attention };
}

async function syncAccounts(locationId: string, qbo: QboAccount[]) {
  const local = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.locationId, locationId));
  const byExt = new Map(local.filter((l) => l.externalId).map((l) => [l.externalId!, l]));
  const free = local.filter((l) => !l.externalId);
  const freeByNumber = new Map(free.filter((l) => l.number).map((l) => [norm(l.number), l]));
  const freeByName = new Map(free.map((l) => [norm(l.name), l]));
  const taken = new Set<number>();
  const seen = new Set<string>();
  const result = { created: 0, updated: 0, linked: 0, deactivated: 0 };

  const updates: Array<{ id: number; set: Partial<typeof ledgerAccounts.$inferInsert> }> = [];
  const inserts: Array<typeof ledgerAccounts.$inferInsert> = [];

  for (const a of qbo) {
    seen.add(a.Id);
    const name = a.FullyQualifiedName || a.Name || `Account ${a.Id}`;
    const fields = { name, number: a.AcctNum || null, type: a.AccountType || null, active: a.Active !== false, externalId: a.Id, updatedAt: new Date() };
    let target = byExt.get(a.Id);
    let linked = false;
    if (!target) {
      const cand = (a.AcctNum && freeByNumber.get(norm(a.AcctNum))) || freeByName.get(norm(name)) || freeByName.get(norm(a.Name));
      if (cand && !taken.has(cand.id)) {
        target = cand;
        linked = true;
      }
    }
    if (target) {
      taken.add(target.id);
      updates.push({ id: target.id, set: fields });
      if (linked) result.linked++;
      else result.updated++;
    } else {
      inserts.push({ locationId, ...fields });
      result.created++;
    }
  }
  // Gone from QuickBooks: keep the row (mappings point at it) but mark it inactive.
  const gone = local.filter((l) => l.externalId && !seen.has(l.externalId) && l.active);
  result.deactivated = gone.length;

  await inChunks(updates, (c) => db.batch(c.map((u) => db.update(ledgerAccounts).set(u.set).where(and(eq(ledgerAccounts.id, u.id), eq(ledgerAccounts.locationId, locationId)))) as never));
  await inChunks(inserts, (c) => db.insert(ledgerAccounts).values(c));
  await inChunks(gone, (c) => db.batch(c.map((g) => db.update(ledgerAccounts).set({ active: false, updatedAt: new Date() }).where(and(eq(ledgerAccounts.id, g.id), eq(ledgerAccounts.locationId, locationId)))) as never));
  return result;
}

async function syncClasses(locationId: string, qbo: QboClass[]) {
  const local = await db.select().from(ledgerDimensions).where(eq(ledgerDimensions.locationId, locationId));
  const byExt = new Map(local.filter((l) => l.externalId).map((l) => [l.externalId!, l]));
  const freeByName = new Map(local.filter((l) => !l.externalId).map((l) => [norm(l.name), l]));
  const taken = new Set<number>();
  const seen = new Set<string>();
  const result = { created: 0, updated: 0, linked: 0, deactivated: 0 };
  const updates: Array<{ id: number; set: Partial<typeof ledgerDimensions.$inferInsert> }> = [];
  const inserts: Array<typeof ledgerDimensions.$inferInsert> = [];

  for (const c of qbo) {
    seen.add(c.Id);
    const name = c.FullyQualifiedName || c.Name || `Class ${c.Id}`;
    const fields = { name, active: c.Active !== false, externalId: c.Id, updatedAt: new Date() };
    let target = byExt.get(c.Id);
    let linked = false;
    if (!target) {
      const cand = freeByName.get(norm(name)) || freeByName.get(norm(c.Name));
      if (cand && !taken.has(cand.id)) {
        target = cand;
        linked = true;
      }
    }
    if (target) {
      taken.add(target.id);
      updates.push({ id: target.id, set: fields });
      if (linked) result.linked++;
      else result.updated++;
    } else {
      inserts.push({ locationId, ...fields });
      result.created++;
    }
  }
  const gone = local.filter((l) => l.externalId && !seen.has(l.externalId) && l.active);
  result.deactivated = gone.length;
  await inChunks(updates, (c) => db.batch(c.map((u) => db.update(ledgerDimensions).set(u.set).where(and(eq(ledgerDimensions.id, u.id), eq(ledgerDimensions.locationId, locationId)))) as never));
  await inChunks(inserts, (c) => db.insert(ledgerDimensions).values(c));
  await inChunks(gone, (c) => db.batch(c.map((g) => db.update(ledgerDimensions).set({ active: false, updatedAt: new Date() }).where(and(eq(ledgerDimensions.id, g.id), eq(ledgerDimensions.locationId, locationId)))) as never));
  return result;
}

/** Fund / payment-source / catch-all mappings that point at an inactive account, or one not linked to QuickBooks. */
export async function mappingsNeedingAttention(locationId: string): Promise<string[]> {
  const [accounts, funds, sources, settings] = await Promise.all([
    db.select().from(ledgerAccounts).where(eq(ledgerAccounts.locationId, locationId)),
    db.select().from(fundMap).where(eq(fundMap.locationId, locationId)),
    db.select().from(sourceMap).where(eq(sourceMap.locationId, locationId)),
    getSettings(locationId),
  ]);
  const acct = new Map(accounts.map((a) => [a.id, a]));
  const problem = (id: number | null, what: string): string | null => {
    if (id === null) return null;
    const a = acct.get(id);
    if (!a) return `${what} points at an account that no longer exists.`;
    if (!a.active) return `${what} uses "${a.name}", which is inactive.`;
    if (!a.externalId) return `${what} uses "${a.name}", which is not linked to QuickBooks.`;
    return null;
  };
  const out: Array<string | null> = [problem(settings.unmappedAccountId, "The catch-all income account")];
  for (const s of sources) {
    out.push(problem(s.depositAccountId, `The ${s.source} deposit account`), problem(s.feeAccountId, `The ${s.source} fee account`));
  }
  if (funds.length > 0) {
    const names = new Map((await rows(sql`select id, name from campaign where location_id = ${locationId}`)).map((r) => [Number(r.id), String(r.name)]));
    for (const f of funds) out.push(problem(f.incomeAccountId, `Fund "${names.get(f.campaignId) ?? f.campaignId}"`));
  }
  return out.filter((x): x is string => x !== null);
}
