/**
 * Collapses the free-text manual_donation.payment_method values into the small
 * set of sources the accounting sync groups deposits by and maps to bank
 * accounts (source_map). Spellings come from the live data (e.g. `card`,
 * `credit card` and `credit_card` are all in use; so are `check` and `cheque`).
 */
export const ACCOUNTING_SOURCES = [
  "card",
  "check",
  "cash",
  "ach",
  "paypal",
  "bank_transfer",
  "other",
] as const;

export type AccountingSource = (typeof ACCOUNTING_SOURCES)[number];

const MAP: Record<string, AccountingSource> = {
  card: "card",
  "credit card": "card",
  credit_card: "card",
  "debit card": "card",
  debit_card: "card",
  credit: "card",
  stripe: "card",
  gateway: "card",
  check: "check",
  cheque: "check",
  money_order: "check",
  "money order": "check",
  cash: "cash",
  ach: "ach",
  "ach-stripe": "ach",
  paypal: "paypal",
  bank_transfer: "bank_transfer",
  "bank transfer": "bank_transfer",
  wire: "bank_transfer",
  xfer: "bank_transfer",
};

export const SOURCE_LABELS: Record<AccountingSource, string> = {
  card: "Card",
  check: "Check",
  cash: "Cash",
  ach: "ACH",
  paypal: "PayPal",
  bank_transfer: "Bank transfer / wire",
  other: "Other",
};

/**
 * Sources staff group into a deposit by hand. Card and PayPal are grouped by payout: the processor
 * keeps a fee, so these deposits also take a fee and the bank amount received (see FEE_SOURCES).
 */
export const MANUAL_SOURCES = ["check", "cash", "ach", "card", "paypal", "bank_transfer", "other"] as const satisfies readonly AccountingSource[];
export type ManualSource = (typeof MANUAL_SOURCES)[number];

/** Sources whose deposit is net of a processing fee, so the bank amount is checked at close. */
export const FEE_SOURCES = ["card", "paypal"] as const satisfies readonly AccountingSource[];
export const isFeeSource = (source: string): boolean => (FEE_SOURCES as readonly string[]).includes(source);

/** Lower-cased raw payment_method values that normalize to `source` (never includes "other"). */
export function rawMethodsFor(source: AccountingSource): string[] {
  return Object.entries(MAP)
    .filter(([, s]) => s === source)
    .map(([raw]) => raw);
}

/** Every raw value with an explicit mapping; "other" is whatever is not in this list (or empty). */
export const KNOWN_RAW_METHODS = Object.keys(MAP);

export function normalizePaymentMethod(raw: string | null | undefined): AccountingSource {
  if (!raw) return "other";
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return MAP[key] ?? "other";
}
