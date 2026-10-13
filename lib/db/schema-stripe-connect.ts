/**
 * Stripe Connect settings — tenant-scoped, one connection per location.
 *
 * Mirrors schema-crowded.ts's crowdedConnections table/pattern. A tenant
 * pastes their own Stripe API keys (publishable + secret) in Settings; the
 * secret key is encrypted at rest (lib/stripe-connect/crypto.ts). This is
 * what the Fundraising Campaigns wizard's "Stripe" processor option reads
 * from to collect donations into the tenant's own Stripe account.
 *
 * Kept in its own schema file: the Drizzle client only imports ./schema, so
 * this table is accessed via explicit db.insert/select, never db.query.*.
 *
 * Applied via .apply-stripe-connect-migration.mjs (idempotent).
 */
import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const stripeConnections = pgTable(
  "stripe_connections",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    locationId: text("location_id").notNull(),

    /** Public — safe to return to the client as-is. */
    publishableKey: text("publishable_key").notNull(),
    /** Encrypted at rest — never returned over HTTP; see sanitizeForClient. */
    secretKeyEnc: text("secret_key_enc").notNull(),

    /** Stripe account id + display name, fetched from /v1/account on connect. */
    accountId: varchar("account_id", { length: 255 }),
    accountName: varchar("account_name", { length: 255 }),
    /** 'test' | 'live' — derived from the secret key prefix (sk_test_/sk_live_). */
    mode: varchar("mode", { length: 10 }).notNull().default("test"),

    /** active | needs_reconnect | revoked. */
    status: varchar("status", { length: 50 }).notNull().default("active"),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),

    /**
     * Per-tenant webhook signing secret (whsec_...), encrypted with the same
     * AES-256-GCM scheme as secretKeyEnc. Registered automatically on connect
     * via POST /v1/webhook_endpoints — see lib/stripe-connect/webhook-registration.ts.
     * Null until a public HTTPS app URL is available to register against
     * (e.g. still null in local dev).
     */
    webhookSecretEnc: text("webhook_secret_enc"),
    /** The Stripe webhook_endpoint id (we_...) so it can be updated/deleted on reconnect. */
    webhookEndpointId: varchar("webhook_endpoint_id", { length: 255 }),
    /**
     * Why the last registration attempt failed or was skipped (e.g.
     * "app_url_not_https" or a Stripe API error message). Null once a
     * registration succeeds (webhookEndpointId gets set) or was never
     * attempted. Lets the admin UI surface a silent failure instead of
     * looking connected while donations never get confirmed.
     */
    webhookRegistrationError: text("webhook_registration_error"),

    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    locationUnique: uniqueIndex("stripe_connections_location_unique").on(table.locationId),
    statusIdx: index("idx_stripe_connections_status").on(table.status),
  }),
);

export type StripeConnection = typeof stripeConnections.$inferSelect;
export type NewStripeConnection = typeof stripeConnections.$inferInsert;
