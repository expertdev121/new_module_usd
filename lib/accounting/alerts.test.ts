// Run: npx tsx --test lib/accounting/alerts.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { checkAlertUrl, redactAlertUrl } from "./alert-url.ts";
import { buildAlertPayload } from "./alert-payload.ts";
import { SettingsBody } from "./schemas.ts";

const GOOD = "https://services.leadconnectorhq.com/hooks/AbC123/webhook-trigger/xyz-789";

test("a GoHighLevel inbound webhook is accepted", () => {
  assert.equal(checkAlertUrl(GOOD), null);
});

test("anything else is refused (the server must never call an arbitrary address)", () => {
  for (const bad of [
    "http://services.leadconnectorhq.com/hooks/a/webhook-trigger/b", // not https
    "https://evil.example.com/hooks/a", // other host
    "https://leadconnectorhq.com.evil.com/hooks/a", // look-alike suffix
    "https://evil-leadconnectorhq.com/hooks/a", // look-alike prefix
    "https://services.leadconnectorhq.com@evil.com/hooks/a", // userinfo trick: real host is evil.com
    "https://user:pw@services.leadconnectorhq.com/hooks/a", // credentials in the URL
    "https://services.leadconnectorhq.com:8443/hooks/a", // odd port
    "https://services.leadconnectorhq.com/api/v1/contacts", // not a webhook path
    "https://localhost/hooks/a",
    "https://169.254.169.254/hooks/a",
    "not a url",
    "",
  ]) {
    assert.notEqual(checkAlertUrl(bad), null, bad);
  }
});

test("the audit trail keeps only the host, never the secret path", () => {
  assert.equal(redactAlertUrl(GOOD), "services.leadconnectorhq.com/…");
  assert.equal(redactAlertUrl(null), null);
  assert.ok(!String(redactAlertUrl(GOOD)).includes("xyz-789"));
});

test("alert message has flat keys, a plain sentence, and the reason", () => {
  const p = buildAlertPayload("accounting_sync_failed", { locationId: "L1", status: "partial", posted: 2, failed: 1, error: "Account is inactive", trigger: "nightly", runId: 42 }, "https://app.example/admin/accounting");
  assert.equal(p.event, "accounting_sync_failed");
  assert.equal(p.location_id, "L1");
  assert.equal(p.failed, 1);
  assert.match(p.message, /could not send 1 deposit to QuickBooks/);
  assert.match(p.message, /Reason: Account is inactive/);
  assert.match(p.message, /https:\/\/app\.example\/admin\/accounting/);
  assert.ok(Object.values(p).every((v) => v === null || typeof v !== "object"), "no nested objects");
});

test("a very long error is cut so the message stays small", () => {
  const p = buildAlertPayload("accounting_sync_failed", { locationId: "L1", status: "failed", posted: 0, failed: 3, error: "x".repeat(5000), trigger: "nightly", runId: 1 }, null);
  assert.ok((p.error ?? "").length <= 300);
  assert.match(p.message, /3 deposits/);
  assert.match(p.message, /Open Accounting in DonorHQ/);
});

test("test alert says it is a test and carries no failure text", () => {
  const p = buildAlertPayload("accounting_alert_test", { locationId: "L1", status: "test", posted: 0, failed: 0, error: null, trigger: "manual", runId: null }, null);
  assert.equal(p.event, "accounting_alert_test");
  assert.match(p.message, /test alert/i);
});

const base = { system: "quickbooks_online", basis: "cash", startDate: "2026-11-01", unmappedAccountId: null, entryType: "deposit", autoSyncEnabled: false };

test("settings: the alert URL is optional, can be cleared, and must be a GoHighLevel webhook", () => {
  const omitted = SettingsBody.parse(base);
  assert.equal(omitted.alertWebhookUrl, undefined); // omitted = keep what is stored
  assert.equal(SettingsBody.parse({ ...base, alertWebhookUrl: "" }).alertWebhookUrl, null);
  assert.equal(SettingsBody.parse({ ...base, alertWebhookUrl: null }).alertWebhookUrl, null);
  assert.equal(SettingsBody.parse({ ...base, alertWebhookUrl: `  ${GOOD}  ` }).alertWebhookUrl, GOOD);
  assert.equal(SettingsBody.safeParse({ ...base, alertWebhookUrl: "https://evil.example.com/hooks/a" }).success, false);
});
