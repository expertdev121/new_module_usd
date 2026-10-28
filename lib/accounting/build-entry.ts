/**
 * Builds the accounting entry (deposit lines) for one deposit. Pure: no database.
 * Money is handled in integer cents so debits and credits always balance exactly.
 *
 * Manual deposits (checks, cash, ACH): credit each fund's income account (and class)
 * for its total, debit the bank account for the whole deposit. Card and PayPal deposits
 * are net of the processor's fee: the bank is debited for gifts minus fee and the fee
 * goes to the source's fee account. Refunds are not handled yet.
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
  /** What reaches the bank: gifts minus the processing fee. Equals grossCents when there is no fee. */
  netCents: number;
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

/**
 * Card and PayPal payouts arrive net of the processor's fee. The deposit total must equal the bank
 * amount, so the fee is entered once and the bank amount is confirmed when the deposit is closed.
 * Returns a plain-words problem, or null when gifts - fee equals the bank amount.
 */
export function checkBankAmount(grossCents: number, feesCents: number, bankCents: number): string | null {
  const expected = grossCents - feesCents;
  if (bankCents === expected) return null;
  return `The bank amount ${fromCents(bankCents)} does not match the gifts ${fromCents(grossCents)} minus the fee ${fromCents(feesCents)}, which is ${fromCents(expected)}. Check the fee or the gifts.`;
}

export function buildEntry(params: {
  gifts: EntryGift[];
  fundMap: Map<number, FundMapping>;
  depositAccountId: number | null;
  catchAllAccountId: number | null;
  sourceLabel: string;
  /** Processing fee kept by the processor, in cents. Card and PayPal deposits only. */
  feesCents?: number;
  feeAccountId?: number | null;
}): BuiltEntry {
  const { gifts, fundMap, depositAccountId, catchAllAccountId, sourceLabel } = params;
  const feesCents = params.feesCents ?? 0;
  const feeAccountId = params.feeAccountId ?? null;
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

  if (feesCents < 0) blockers.push("The fee cannot be negative.");
  if (feesCents > 0) {
    if (feesCents >= grossCents) blockers.push("The fee must be smaller than the gifts in the deposit.");
    if (feeAccountId === null) blockers.push(`No fee account is set for ${sourceLabel} (Settings > Accounting > Payment sources).`);
  }
  const fee = feesCents > 0 && feesCents < grossCents ? feesCents : 0;
  const netCents = grossCents - fee;

  if (grossCents > 0) {
    // The bank line must stay the first debit: QuickBooks takes it as the deposit account and posts
    // any later debit (the fee) as a negative line, so the deposit total equals the bank amount.
    lines.push({
      accountId: depositAccountId,
      dimensionId: null,
      debitCents: netCents,
      creditCents: 0,
      memo: `Deposit · ${sourceLabel} · ${gifts.length} ${gifts.length === 1 ? "gift" : "gifts"}`,
      campaignId: null,
      unmapped: false,
    });
    if (fee > 0) {
      lines.push({
        accountId: feeAccountId,
        dimensionId: null,
        debitCents: fee,
        creditCents: 0,
        memo: `Processing fees · ${sourceLabel}`,
        campaignId: null,
        unmapped: false,
      });
    }
  }

  const debits = lines.reduce((s, l) => s + l.debitCents, 0);
  const credits = lines.reduce((s, l) => s + l.creditCents, 0);
  if (debits !== credits) blockers.push("Debits and credits do not match.");

  return { lines, grossCents, netCents, unmappedCampaigns, blockers };
}
