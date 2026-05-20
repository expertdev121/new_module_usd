/**
 * Print the current state of every ghl_backfill_jobs row + try a real
 * GHL contacts list call against the most recent job's location so we can
 * see the actual upstream error (not just the swallowed log line).
 *
 *   node --env-file=.env --import tsx scripts/diagnose-backfill.ts
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const sql = neon(url);

  const jobs = (await sql`
    SELECT
      id, resource_id, location_id, company_id, kind, status,
      page, page_size, processed_count, upserted_count, failed_count,
      attempt_count, triggered_by,
      cursor, total_estimate,
      last_error,
      lease_token, lease_expires_at,
      next_run_at, created_at, started_at, completed_at, updated_at
    FROM ghl_backfill_jobs
    ORDER BY created_at DESC
    LIMIT 10
  `) as Record<string, unknown>[];

  console.log(`\n[diag] Found ${jobs.length} backfill job(s):\n`);

  for (const j of jobs) {
    console.log(`──────────────────────────────────────────────`);
    console.log(`id:               ${j.id}`);
    console.log(`resource_id:      ${j.resource_id}`);
    console.log(`location_id:      ${j.location_id}`);
    console.log(`company_id:       ${j.company_id ?? "(null)"}`);
    console.log(`status:           ${j.status}`);
    console.log(`kind:             ${j.kind}`);
    console.log(`triggered_by:     ${j.triggered_by}`);
    console.log(`page:             ${j.page}`);
    console.log(`processed_count:  ${j.processed_count}`);
    console.log(`upserted_count:   ${j.upserted_count}`);
    console.log(`failed_count:     ${j.failed_count}`);
    console.log(`attempt_count:    ${j.attempt_count}`);
    console.log(`total_estimate:   ${j.total_estimate ?? "(null)"}`);
    console.log(`cursor:           ${j.cursor ?? "(null)"}`);
    console.log(`lease_token:      ${j.lease_token ?? "(null)"}`);
    console.log(`lease_expires_at: ${j.lease_expires_at ?? "(null)"}`);
    console.log(`next_run_at:      ${j.next_run_at}`);
    console.log(`created_at:       ${j.created_at}`);
    console.log(`started_at:       ${j.started_at ?? "(null)"}`);
    console.log(`completed_at:     ${j.completed_at ?? "(null)"}`);
    console.log(`updated_at:       ${j.updated_at}`);
    console.log(`last_error:`);
    if (j.last_error) {
      console.log(`  ${String(j.last_error).split("\n").join("\n  ")}`);
    } else {
      console.log(`  (none)`);
    }

    // Lease analysis.
    if (j.status === "running") {
      const leaseExpiry = j.lease_expires_at ? new Date(j.lease_expires_at as string) : null;
      const now = new Date();
      if (!leaseExpiry) {
        console.log(`\n  ⚠️  status=running but lease_expires_at is null — inconsistent state`);
      } else if (leaseExpiry < now) {
        const ageSec = Math.round((now.getTime() - leaseExpiry.getTime()) / 1000);
        console.log(`\n  ⚠️  Lease EXPIRED ${ageSec}s ago. Worker died mid-chunk.`);
        console.log(`     Next claimNextJob() will pick this up automatically.`);
      } else {
        const remainingSec = Math.round((leaseExpiry.getTime() - now.getTime()) / 1000);
        console.log(`\n  Lease still held — ${remainingSec}s remaining.`);
      }
    }
  }

  // Try fetching one page from GHL for the most recent job, so we surface
  // the actual API error (if any).
  if (jobs.length > 0) {
    const latest = jobs[0];
    const locationId = latest.location_id as string;
    if (locationId) {
      console.log(`\n\n[diag] Probing GHL API for location ${locationId}...`);
      try {
        const { listContactsFromGhl } = await import("../lib/ghl/api-client");
        const page = await listContactsFromGhl(locationId, {
          companyId: (latest.company_id as string) || undefined,
          limit: 5,
        });
        console.log(`  ✅ GHL returned ${page.contacts.length} contact(s).`);
        console.log(`     total estimate: ${page.total ?? "(not provided)"}`);
        console.log(`     hasMore:        ${page.hasMore}`);
        if (page.contacts.length > 0) {
          console.log(`     first contact:  ${page.contacts[0].firstName ?? ""} ${page.contacts[0].lastName ?? ""} (${page.contacts[0].id})`);
        }
      } catch (err) {
        console.log(`  ❌ GHL probe FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(`\n[diag] Done.`);
}

main().catch((e) => {
  console.error("[diag] FAILED:", e);
  process.exit(1);
});
