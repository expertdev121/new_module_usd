/**
 * One-shot read-only diagnostic. Prints:
 *   - Every row in ghl_oauth_tokens (sanitized — never prints tokens)
 *   - Every row in ghl_webhook_events for the last 24h (to see what GHL has sent)
 *   - Every row in ghl_invoice_events for the last 24h
 *
 *   node --env-file=.env --import tsx scripts/diagnose-ghl-state.ts
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
  const sql = neon(url);

  console.log("\n══ ghl_oauth_tokens ══════════════════════════════════════════════════\n");
  const tokens = (await sql`
    SELECT
      resource_id, resource_type, location_id, company_id,
      location_name, company_name, status, revoked_reason,
      created_at, updated_at, expires_at,
      LEFT(scope, 80) as scope_preview
    FROM ghl_oauth_tokens
    ORDER BY created_at DESC
  `) as Record<string, unknown>[];

  if (tokens.length === 0) {
    console.log("  (no rows — no installs have completed yet)");
  } else {
    for (const t of tokens) {
      console.log(`  resource_id:   ${t.resource_id}`);
      console.log(`  resource_type: ${t.resource_type}`);
      console.log(`  location_id:   ${t.location_id ?? "(null)"}`);
      console.log(`  company_id:    ${t.company_id}`);
      console.log(`  location_name: ${t.location_name ?? "(null)"}`);
      console.log(`  company_name:  ${t.company_name ?? "(null)"}`);
      console.log(`  status:        ${t.status}${t.revoked_reason ? ` (${t.revoked_reason})` : ""}`);
      console.log(`  created_at:    ${t.created_at}`);
      console.log(`  expires_at:    ${t.expires_at}`);
      console.log(`  scope (80ch):  ${t.scope_preview}`);
      console.log("  ───");
    }
  }

  console.log("\n══ ghl_webhook_events (last 24h) ════════════════════════════════════\n");
  const events = (await sql`
    SELECT
      webhook_id, event_type, location_id, company_id,
      signature_valid, processing_status, processing_error,
      received_at, processed_at
    FROM ghl_webhook_events
    WHERE received_at > NOW() - INTERVAL '24 hours'
    ORDER BY received_at DESC
    LIMIT 50
  `) as Record<string, unknown>[];

  if (events.length === 0) {
    console.log("  (no rows in last 24h — GHL hasn't fired any webhooks)");
  } else {
    for (const e of events) {
      console.log(`  ${e.received_at}  ${e.event_type.toString().padEnd(20)}  ${e.processing_status.toString().padEnd(18)}  sig=${e.signature_valid}  loc=${e.location_id ?? "(none)"}`);
      if (e.processing_error) {
        console.log(`      error: ${String(e.processing_error).slice(0, 200)}`);
      }
    }
    console.log(`\n  Total events in window: ${events.length}`);
  }

  console.log("\n══ ghl_invoice_events (last 24h) ════════════════════════════════════\n");
  const invoices = (await sql`
    SELECT received_at, invoice_id, contact_id, location_id, amount, currency
    FROM ghl_invoice_events
    WHERE received_at > NOW() - INTERVAL '24 hours'
    ORDER BY received_at DESC
    LIMIT 20
  `) as Record<string, unknown>[];

  if (invoices.length === 0) {
    console.log("  (no invoice events in last 24h)");
  } else {
    for (const i of invoices) {
      console.log(`  ${i.received_at}  invoice=${i.invoice_id}  loc=${i.location_id}  ${i.amount} ${i.currency}`);
    }
  }

  console.log("\n══ user table — locationIds ════════════════════════════════════════\n");
  const users = (await sql`
    SELECT id, email, role, location_id
    FROM "user"
    WHERE role IN ('admin', 'super_admin')
    ORDER BY id DESC
    LIMIT 10
  `) as Record<string, unknown>[];
  for (const u of users) {
    console.log(`  ${u.id.toString().padEnd(6)}  ${u.role.toString().padEnd(12)}  loc=${u.location_id ?? "(null)"}  ${u.email}`);
  }
  console.log("");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
