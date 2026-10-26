/**
 * Builds the accounting entry (deposit lines) for one deposit. Pure: no database.
 * Money is handled in integer cents so debits and credits always balance exactly.
 *
 * Manual deposits (checks, cash, ACH): credit each fund's income account (and class)
 * for its total, debit the bank account for the whole deposit. Processor deposits
 * (fees, refunds) extend this later.
 */

export interface EntryGift {
  id: number;
  campaignId: number | null;
  campaignName: string | null;
  amountCents: number;
}

export interface FundMapping {
  incomeAccountId: number | null;
  dimensionId: number | null;
}

export interface BuiltLine {
  accountId: number | null;
  dimensionId: number | null;
  debitCents: number;
  creditCents: number;
  memo: string;
  campaignId: number | null;
  /** True when the line fell back to the catch-all account because the fund has no mapping. */
  unmapped: boolean;
}

export interface BuiltEntry {
  lines: BuiltLine[];
  grossCents: number;
  /** Funds with no income account that were sent to the catch-all (or have nowhere to go). */
  unmappedCampaigns: Array<{ campaignId: number | null; name: string }>;
  /** Reasons the entry cannot be closed, in plain words. Empty means it can be. */
  blockers: string[];
}

export function toCents(value: string | number): number {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Math.round(n * 100);
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function buildEntry(params: {
  gifts: EntryGift[];
  fundMap: Map<number, FundMapping>;
  depositAccountId: number | null;
  catchAllAccountId: number | null;
  sourceLabel: string;
}): BuiltEntry {
  const { gifts, fundMap, depositAccountId, catchAllAccountId, sourceLabel } = params;
  const blockers: string[] = [];
  const unmappedCampaigns: BuiltEntry["unmappedCampaigns"] = [];

  if (gifts.length === 0) blockers.push("The deposit has no gifts.");
  if (depositAccountId === null) blockers.push(`No deposit account is set for ${sourceLabel} (Settings > Accounting > Payment sources).`);

  // Group by fund (campaign); a null campaign is its own group.
  const groups = new Map<number | null, { name: string; cents: number; count: number }>();
  for (const g of gifts) {
    const key = g.campaignId;
    const cur = groups.get(key) ?? { name: g.campaignName ?? "No campaign", cents: 0, count: 0 };
    cur.cents += g.amountCents;
    cur.count += 1;
    groups.set(key, cur);
  }

  const lines: BuiltLine[] = [];
  let grossCents = 0;
  for (const [campaignId, grp] of groups) {
    const mapping = campaignId === null ? undefined : fundMap.get(campaignId);
    const mapped = mapping?.incomeAccountId ?? null;
    const unmapped = mapped === null;
    if (unmapped) {
      unmappedCampaigns.push({ campaignId, name: grp.name });
      if (catchAllAccountId === null) {
        blockers.push(`"${grp.name}" is not mapped and there is no catch-all income account (Settings > Accounting > General).`);
      }
    }
    grossCents += grp.cents;
    lines.push({
      accountId: unmapped ? catchAllAccountId : mapped,
      dimensionId: mapping?.dimensionId ?? null,
      debitCents: 0,
      creditCents: grp.cents,
      memo: `${grp.name} · ${grp.count} ${grp.count === 1 ? "gift" : "gifts"}${unmapped ? " · UNMAPPED" : ""}`,
      campaignId,
      unmapped,
    });
  }
  lines.sort((a, b) => a.memo.localeCompare(b.memo));

  if (grossCents > 0) {
    lines.push({
      accountId: depositAccountId,
      dimensionId: null,
      debitCents: grossCents,
      creditCents: 0,
      memo: `Deposit · ${sourceLabel} · ${gifts.length} ${gifts.length === 1 ? "gift" : "gifts"}`,
      campaignId: null,
      unmapped: false,
    });
  }

  const debits = lines.reduce((s, l) => s + l.debitCents, 0);
  const credits = lines.reduce((s, l) => s + l.creditCents, 0);
  if (debits !== credits) blockers.push("Debits and credits do not match.");

  return { lines, grossCents, unmappedCampaigns, blockers };
}
