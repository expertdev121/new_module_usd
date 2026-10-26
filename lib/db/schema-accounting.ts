/**
 * Accounting sync (QuickBooks first). Mirrors drizzle/0030_accounting_sync.sql —
 * keep the two in step. Tenant scope is location_id; a gift is a manual_donation
 * row and fund = campaign.
 */
import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  boolean,
  numeric,
  date,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";

export const accountingSettings = pgTable("accounting_settings", {
  id: serial("id").primaryKey(),
  locationId: text("location_id").notNull().unique(),
  /** quickbooks_online | generic_csv */
  system: varchar("system", { length: 32 }).notNull().default("quickbooks_online"),
  /** cash | accrual */
  basis: varchar("basis", { length: 16 }).notNull().default("cash"),
  /** Gifts dated before this are never exported. */
  startDate: date("start_date"),
  unmappedAccountId: integer("unmapped_account_id"),
  /** deposit | journal_entry */
  entryType: varchar("entry_type", { length: 16 }).notNull().default("deposit"),
  autoSyncEnabled: boolean("auto_sync_enabled").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: serial("id").primaryKey(),
    locationId: text("location_id").notNull(),
    /** QuickBooks Id once connected. */
    externalId: text("external_id"),
    number: text("number"),
    name: text("name").notNull(),
    type: text("type"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    locIdx: index("ledger_accounts_location_idx").on(t.locationId),
  }),
);

/** QuickBooks classes (Xero tracking categories later). */
export const ledgerDimensions = pgTable(
  "ledger_dimensions",
  {
    id: serial("id").primaryKey(),
    locationId: text("location_id").notNull(),
    externalId: text("external_id"),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    locIdx: index("ledger_dimensions_location_idx").on(t.locationId),
  }),
);

/** One row per campaign (fund = campaign). */
export const fundMap = pgTable(
  "fund_map",
  {
    id: serial("id").primaryKey(),
    locationId: text("location_id").notNull(),
    campaignId: integer("campaign_id").notNull(),
    incomeAccountId: integer("income_account_id"),
    dimensionId: integer("dimension_id"),
    arAccountId: integer("ar_account_id"),
    updatedBy: integer("updated_by"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    uniq: unique("fund_map_unique").on(t.locationId, t.campaignId),
  }),
);

/** Normalized payment source (see lib/accounting/normalize-payment-method.ts) → bank/fee accounts. */
export const sourceMap = pgTable(
  "source_map",
  {
    id: serial("id").primaryKey(),
    locationId: text("location_id").notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    depositAccountId: integer("deposit_account_id"),
    feeAccountId: integer("fee_account_id"),
  },
  (t) => ({
    uniq: unique("source_map_unique").on(t.locationId, t.source),
  }),
);

export const exportFiles = pgTable("export_files", {
  id: serial("id").primaryKey(),
  locationId: text("location_id").notNull(),
  template: varchar("template", { length: 32 }).notNull(),
  depositCount: integer("deposit_count").notNull().default(0),
  fileUrl: text("file_url"),
  filename: text("filename"),
  /** The generated CSV, kept so the same file can be downloaded again. */
  content: text("content"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const deposits = pgTable(
  "deposits",
  {
    id: serial("id").primaryKey(),
    locationId: text("location_id").notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    /** Stripe payout id, or the bank slip reference. */
    externalRef: text("external_ref"),
    depositDate: date("deposit_date").notNull(),
    gross: numeric("gross", { precision: 12, scale: 2 }).notNull().default("0"),
    fees: numeric("fees", { precision: 12, scale: 2 }).notNull().default("0"),
    refunds: numeric("refunds", { precision: 12, scale: 2 }).notNull().default("0"),
    net: numeric("net", { precision: 12, scale: 2 }).notNull().default("0"),
    /** open | closed | exported | voided */
    status: varchar("status", { length: 16 }).notNull().default("open"),
    createdBy: integer("created_by"),
    closedAt: timestamp("closed_at"),
    exportedAt: timestamp("exported_at"),
    exportedBy: integer("exported_by"),
    exportFileId: integer("export_file_id"),
    /** QuickBooks transaction id once posted. */
    externalId: text("external_id"),
    postedAt: timestamp("posted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    locStatusIdx: index("deposits_location_status_idx").on(t.locationId, t.status),
    // deposits_external_unique and deposits_source_ref_unique are partial unique
    // indexes (WHERE ... IS NOT NULL); they live only in the SQL migration.
  }),
);

export const depositLines = pgTable(
  "deposit_lines",
  {
    id: serial("id").primaryKey(),
    depositId: integer("deposit_id").notNull(),
    accountId: integer("account_id"),
    dimensionId: integer("dimension_id"),
    debit: numeric("debit", { precision: 12, scale: 2 }).notNull().default("0"),
    credit: numeric("credit", { precision: 12, scale: 2 }).notNull().default("0"),
    memo: text("memo"),
    /** Snapshot of the fund (campaign) at close. */
    campaignId: integer("campaign_id"),
  },
  (t) => ({
    depositIdx: index("deposit_lines_deposit_idx").on(t.depositId),
  }),
);

/** unique(manual_donation_id) is the one-deposit-per-gift guard. */
export const depositTransactions = pgTable(
  "deposit_transactions",
  {
    depositId: integer("deposit_id").notNull(),
    manualDonationId: integer("manual_donation_id").notNull().unique(),
    /** The gift as it was when the deposit was closed; compared later to detect changes (see gift-drift.ts). */
    snapAmount: numeric("snap_amount", { precision: 12, scale: 2 }),
    snapCampaignId: integer("snap_campaign_id"),
    snapStatus: varchar("snap_status", { length: 20 }),
    snapDate: date("snap_date"),
    snappedAt: timestamp("snapped_at"),
  },
);

/** Append-only (UPDATE/DELETE blocked by a trigger). */
export const accountingAudit = pgTable(
  "accounting_audit",
  {
    id: serial("id").primaryKey(),
    locationId: text("location_id").notNull(),
    action: varchar("action", { length: 48 }).notNull(),
    object: varchar("object", { length: 48 }).notNull(),
    objectId: text("object_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    userId: integer("user_id"),
    at: timestamp("at").defaultNow().notNull(),
  },
  (t) => ({
    locIdx: index("accounting_audit_location_idx").on(t.locationId, t.at),
  }),
);

/** One QuickBooks connection per location. Tokens are encrypted by lib/accounting/qbo/crypto.ts. */
export const ledgerConnections = pgTable("ledger_connections", {
  id: serial("id").primaryKey(),
  locationId: text("location_id").notNull().unique(),
  system: varchar("system", { length: 32 }).notNull().default("quickbooks_online"),
  /** sandbox | production */
  environment: varchar("environment", { length: 16 }).notNull().default("sandbox"),
  realmId: text("realm_id").notNull(),
  companyName: text("company_name"),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  accessExpiresAt: timestamp("access_expires_at"),
  refreshExpiresAt: timestamp("refresh_expires_at"),
  /** active | needs_reconnect | disconnected */
  status: varchar("status", { length: 20 }).notNull().default("active"),
  lastError: text("last_error"),
  connectedAt: timestamp("connected_at").defaultNow().notNull(),
  connectedBy: integer("connected_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: serial("id").primaryKey(),
    locationId: text("location_id").notNull(),
    /** manual | nightly | retry */
    trigger: varchar("trigger", { length: 16 }).notNull(),
    /** running | success | partial | failed (one running per location: partial unique index in the SQL migration) */
    status: varchar("status", { length: 16 }).notNull().default("running"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    posted: integer("posted").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    error: text("error"),
    startedBy: integer("started_by"),
  },
  (t) => ({
    locIdx: index("sync_runs_location_idx").on(t.locationId, t.startedAt),
  }),
);

export const syncResults = pgTable(
  "sync_results",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").notNull(),
    depositId: integer("deposit_id").notNull(),
    /** posted | failed | skipped */
    status: varchar("status", { length: 12 }).notNull(),
    externalId: text("external_id"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    runIdx: index("sync_results_run_idx").on(t.runId),
    depositIdx: index("sync_results_deposit_idx").on(t.depositId),
  }),
);

export type AccountingSettings = typeof accountingSettings.$inferSelect;
export type LedgerConnection = typeof ledgerConnections.$inferSelect;
export type LedgerAccount = typeof ledgerAccounts.$inferSelect;
export type LedgerDimension = typeof ledgerDimensions.$inferSelect;
export type FundMapRow = typeof fundMap.$inferSelect;
export type SourceMapRow = typeof sourceMap.$inferSelect;
export type Deposit = typeof deposits.$inferSelect;
