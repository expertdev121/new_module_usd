/**
 * Single source of truth for which tables belong to a location and how to
 * scope them. Used by both the export bundle and the hard-delete operation
 * so we never get out of sync (export everything we'd delete; delete
 * everything we exported).
 *
 * `scope` describes the WHERE filter:
 *   - 'location'        : table has its own location_id column
 *   - 'contact_child'   : table has a contact_id FK; rows belong to a
 *                         location only via that contact
 *   - 'pledge_child'    : table has a pledge_id FK (payment); rows belong
 *                         via pledge → contact → location
 *   - 'resource_id'     : ghl_oauth_tokens — keyed by resource_id which
 *                         can be locationId or companyId
 *
 * The order of this list MATTERS for hard-delete:
 *   We delete from child tables first (lower index) so FKs don't break.
 *   The reverse is fine for export — order is irrelevant there.
 */

export type TableScope = "location" | "contact_child" | "pledge_child" | "resource_id";

export interface OffboardTable {
  /** Postgres table name */
  name: string;
  /** Drizzle / SQL scope helper */
  scope: TableScope;
  /** Whether to include in the export ZIP */
  exportable: boolean;
}

/**
 * Ordered child→parent. Hard-delete walks this top to bottom; export
 * walks it in any order.
 */
export const OFFBOARD_TABLES: OffboardTable[] = [
  // ── pledge / payment chain (delete deepest first) ──
  { name: "payment", scope: "pledge_child", exportable: true },
  { name: "manual_donation", scope: "contact_child", exportable: true },
  { name: "pledge", scope: "contact_child", exportable: true },
  { name: "contact_tags", scope: "contact_child", exportable: true },

  // ── contact-graph dependents (FK to contact) ──
  { name: "student_roles", scope: "location", exportable: true },
  { name: "contact_roles", scope: "location", exportable: true },
  { name: "relationships", scope: "location", exportable: true },

  // ── contact itself ──
  { name: "contact", scope: "location", exportable: true },

  // ── ref data (delete after contact since some FK back) ──
  { name: "tag", scope: "location", exportable: true },
  { name: "solicitor", scope: "location", exportable: true },
  { name: "category_item", scope: "location", exportable: true },
  { name: "category_group", scope: "location", exportable: true },
  { name: "category", scope: "location", exportable: true },
  { name: "payment_method_details", scope: "location", exportable: true },
  { name: "payment_methods", scope: "location", exportable: true },
  { name: "campaign", scope: "location", exportable: true },
  { name: "organization_name", scope: "location", exportable: true },

  // ── GHL infrastructure ──
  { name: "ghl_webhook_events", scope: "location", exportable: true },
  { name: "ghl_backfill_jobs", scope: "location", exportable: true },
  { name: "ghl_sync_writes", scope: "location", exportable: false }, // ephemeral
  { name: "audit_log", scope: "location", exportable: true },

  // ── admin users for this location ──
  { name: "user", scope: "location", exportable: true },

  // ── oauth tokens (deleted LAST so its presence guides earlier cleanup) ──
  { name: "ghl_oauth_tokens", scope: "resource_id", exportable: true },
];
