/**
 * Builds the QuickBooks API body for one closed deposit. Pure: no database, no network.
 *
 * Deposit (default, best for bank-feed matching): the bank account is DepositToAccountRef and each
 * credit line is a line coded to its income account and class.
 * JournalEntry: every line is a Debit or Credit posting.
 * DocNumber is DHQ-<deposit id>, the same number as the CSV export, so entries trace back to DonorHQ.
 */
import { createHash } from "node:crypto";
import { journalNo } from "../qbo-csv";

export interface PostLine {
  accountExternalId: string;
  classExternalId: string | null;
  debitCents: number;
  creditCents: number;
  memo: string | null;
}

export interface PostDeposit {
  id: number;
  /** YYYY-MM-DD */
  depositDate: string;
  reference: string | null;
  lines: PostLine[];
}

export type QboEntity = "Deposit" | "JournalEntry";

export interface QboPayload {
  entity: QboEntity;
  docNumber: string;
  body: Record<string, unknown>;
  /** Same deposit + same content = same id, so a retried POST is not applied twice. Max 50 chars. */
  requestId: string;
}

const dollars = (cents: number) => Math.round(cents) / 100;
const ref = (value: string) => ({ value });

export function buildQboPayload(entity: QboEntity, d: PostDeposit): QboPayload {
  const docNumber = journalNo(d.id);
  const note = `DonorHQ deposit #${d.id}${d.reference ? ` | Ref ${d.reference}` : ""}`;
  const debits = d.lines.filter((l) => l.debitCents > 0);
  const credits = d.lines.filter((l) => l.creditCents > 0);
  const sum = (ls: PostLine[], k: "debitCents" | "creditCents") => ls.reduce((s, l) => s + l[k], 0);
  if (sum(debits, "debitCents") !== sum(credits, "creditCents")) throw new Error(`Deposit #${d.id} does not balance.`);
  if (debits.length === 0 || credits.length === 0) throw new Error(`Deposit #${d.id} has no entry lines.`);

  let body: Record<string, unknown>;
  if (entity === "Deposit") {
    // The first debit is the bank deposit. Any further debit (e.g. a processing fee) is a negative line.
    const [bank, ...extra] = debits;
    body = {
      DocNumber: docNumber,
      TxnDate: d.depositDate,
      PrivateNote: note,
      DepositToAccountRef: ref(bank.accountExternalId),
      Line: [
        ...credits.map((l) => ({
          Amount: dollars(l.creditCents),
          DetailType: "DepositLineDetail",
          Description: l.memo ?? undefined,
          DepositLineDetail: { AccountRef: ref(l.accountExternalId), ...(l.classExternalId ? { ClassRef: ref(l.classExternalId) } : {}) },
        })),
        ...extra.map((l) => ({
          Amount: -dollars(l.debitCents),
          DetailType: "DepositLineDetail",
          Description: l.memo ?? undefined,
          DepositLineDetail: { AccountRef: ref(l.accountExternalId), ...(l.classExternalId ? { ClassRef: ref(l.classExternalId) } : {}) },
        })),
      ],
    };
  } else {
    body = {
      DocNumber: docNumber,
      TxnDate: d.depositDate,
      PrivateNote: note,
      Line: d.lines.map((l) => ({
        Amount: dollars(l.debitCents > 0 ? l.debitCents : l.creditCents),
        DetailType: "JournalEntryLineDetail",
        Description: l.memo ?? undefined,
        JournalEntryLineDetail: {
          PostingType: l.debitCents > 0 ? "Debit" : "Credit",
          AccountRef: ref(l.accountExternalId),
          ...(l.classExternalId ? { ClassRef: ref(l.classExternalId) } : {}),
        },
      })),
    };
  }
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  return { entity, docNumber, body, requestId: `dhq-${d.id}-${hash}` };
}
