/**
 * YLA transient-contact re-link: pushes DonorHQ contacts that have no
 * ghl_contact_id and no duplicate match onto GHL via /contacts/upsert,
 * then writes the resolved ghlContactId back to DonorHQ.
 *
 * Usage:
 *   node .yla-link-exec.mjs                 # dry run
 *   node .yla-link-exec.mjs --apply
 */
import { neon } from "@neondatabase/serverless";
import fs from "fs";

const envText = fs.readFileSync(new URL("./.env", import.meta.url), "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const sql = neon(process.env.DATABASE_URL);
const APPLY = process.argv.includes("--apply");
const LOC = "THqkrbnBD2Eim1tdklWp";
const API_BASE = process.env.GHL_API_BASE_URL;
const API_VERSION = process.env.GHL_API_VERSION;

async function getAccessToken() {
  const [row] = await sql`SELECT access_token, refresh_token, expires_at, company_id FROM ghl_oauth_tokens WHERE resource_id = ${LOC} AND resource_type = 'Location'`;
  if (!row) throw new Error("No location token row found");
  const msLeft = new Date(row.expires_at).getTime() - Date.now();
  if (msLeft > 60 * 60 * 1000) return row.access_token;

  const body = new URLSearchParams({
    client_id: process.env.GHL_CLIENT_ID,
    client_secret: process.env.GHL_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
  });
  const resp = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error(`token refresh failed: HTTP ${resp.status} ${await resp.text()}`);
  const fresh = await resp.json();
  const newExpiresAt = new Date(Date.now() + fresh.expires_in * 1000);
  await sql`UPDATE ghl_oauth_tokens SET access_token = ${fresh.access_token}, refresh_token = ${fresh.refresh_token}, expires_at = ${newExpiresAt.toISOString()}, updated_at = now() WHERE resource_id = ${LOC} AND resource_type = 'Location'`;
  return fresh.access_token;
}

async function upsertGhlContact(token, contact) {
  const body = {
    locationId: LOC,
    firstName: contact.first_name || undefined,
    lastName: contact.last_name || undefined,
    email: contact.email || undefined,
    phone: contact.phone || undefined,
  };
  const resp = await fetch(`${API_BASE}/contacts/upsert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: API_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  const payload = await resp.json();
  const ghlContactId = payload.contact?.id;
  if (!ghlContactId) throw new Error(`no contact.id in response: ${JSON.stringify(payload).slice(0, 300)}`);
  return ghlContactId;
}

const contacts = JSON.parse(fs.readFileSync(".tmp-yla/transient.json", "utf8"));
const linkable = contacts.filter((c) => c.email || c.phone);
const unlinkable = contacts.filter((c) => !c.email && !c.phone);
console.log(`${contacts.length} candidates: ${linkable.length} linkable, ${unlinkable.length} have no email/phone (cannot sync)`);
console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

const results = [];
if (APPLY) {
  const token = await getAccessToken();
  for (const c of linkable) {
    try {
      const ghlContactId = await upsertGhlContact(token, c);
      await sql`UPDATE contact SET ghl_contact_id = ${ghlContactId}, last_ghl_sync_at = now(), sync_source = 'donorhq_outbound', updated_at = now() WHERE id = ${c.id}`;
      results.push({ id: c.id, status: "linked", ghl_contact_id: ghlContactId });
    } catch (err) {
      results.push({ id: c.id, status: "error", error: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
    }
  }
} else {
  for (const c of linkable) results.push({ id: c.id, status: "would_link" });
}

fs.writeFileSync(
  ".tmp-yla/link-report.csv",
  ["donorhq_id,status,ghl_contact_id,error", ...results.map((r) => `"${r.id}","${r.status}","${r.ghl_contact_id || ""}","${(r.error || "").replace(/"/g, "'")}"`)].join("\n"),
);
const ok = results.filter((r) => r.status === "linked" || r.status === "would_link").length;
const failed = results.filter((r) => r.status === "error").length;
console.log(`Result: ${ok} ${APPLY ? "linked" : "would link"}, ${failed} errors.`);
if (failed) console.log(results.filter((r) => r.status === "error").map((r) => `  id=${r.id}: ${r.error}`).join("\n"));
