/**
 * Drive the backfill queue from your local machine — same code path as the
 * Vercel cron worker, just running on your laptop. Useful for:
 *   - One-shot completion when you don't have a cron pinger set up
 *   - Debugging chunk failures with full stack traces
 *   - Catching up after orphaned leases
 *
 *   node --env-file=.env --import tsx scripts/drain-backfill.ts
 */
import { processNextChunk } from "../lib/ghl/backfill";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  console.log("[drain] Starting local drain of backfill queue...\n");

  let totalChunks = 0;
  let totalContacts = 0;
  let totalUpserted = 0;

  // Loop until the queue says "no_jobs" or we hit too many iterations.
  for (let i = 0; i < 500; i++) {
    const result = await processNextChunk();
    if (result.status === "no_jobs") {
      console.log(`\n[drain] Queue empty after ${totalChunks} chunk(s).`);
      break;
    }
    totalChunks++;
    totalContacts += result.processed ?? 0;
    totalUpserted += result.upserted ?? 0;
    const tag =
      result.status === "completed"
        ? "✅ DONE"
        : result.status === "failed"
          ? "❌ FAIL"
          : "→";
    console.log(
      `[drain] ${tag} chunk ${totalChunks}  job=${result.jobId?.slice(0, 8)}  processed=${result.processed}  upserted=${result.upserted}  hasMore=${result.hasMore ?? "—"}${result.error ? `  error=${result.error}` : ""}`,
    );
    // Small pause so we don't hammer GHL.
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n[drain] Summary:`);
  console.log(`  chunks processed: ${totalChunks}`);
  console.log(`  contacts processed: ${totalContacts}`);
  console.log(`  contacts upserted: ${totalUpserted}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[drain] FAILED:", e);
    process.exit(1);
  });
