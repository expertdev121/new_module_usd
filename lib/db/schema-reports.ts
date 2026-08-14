/**
 * Saved report views (Phase 4). One row per saved filter set so admins
 * don't rebuild the same report every week. Per-location; owner recorded
 * for audit but any admin of the location can load a shared saved view.
 */
import { pgTable, serial, text, varchar, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const savedReports = pgTable(
  "saved_reports",
  {
    id: serial("id").primaryKey(),
    locationId: text("location_id").notNull(),
    /** Which report family this view belongs to (e.g. 'donor-insights'). */
    reportKey: varchar("report_key", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    /** The full filter/params object as saved. */
    params: jsonb("params").notNull(),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    locIdx: index("saved_reports_location_idx").on(t.locationId),
    keyIdx: index("saved_reports_key_idx").on(t.reportKey),
  }),
);

export type SavedReport = typeof savedReports.$inferSelect;
export type NewSavedReport = typeof savedReports.$inferInsert;
