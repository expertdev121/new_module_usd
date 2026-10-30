// Run: npx tsx --test lib/accounting/alert-confirm.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { CONFIRM_TTL_MS, createConfirmToken, maskEmail, verifyConfirmToken } from "./alert-confirm.ts";
import { buildAlertPayload } from "./alert-payload.ts";
import { createState, verifyState } from "./qbo/state.ts";

process.env.NEXTAUTH_SECRET = "test-secret-for-confirm-links";
const claim = { locationId: "LOC1", email: "Ann@Org.org" };
const NOW = 1_800_000_000_000;

test("a confirm link round-trips and lower-cases the address", () => {
  const t = createConfirmToken(claim, NOW);
  assert.deepEqual(verifyConfirmToken(t, NOW + 1000), { locationId: "LOC1", email: "ann@org.org" });
});

test("it expires after 7 days and is not accepted from the future", () => {
  const t = createConfirmToken(claim, NOW);
  assert.ok(verifyConfirmToken(t, NOW + CONFIRM_TTL_MS - 1000));
  assert.equal(verifyConfirmToken(t, NOW + CONFIRM_TTL_MS + 1000), null);
  assert.equal(verifyConfirmToken(createConfirmToken(claim, NOW + 10 * 60_000), NOW), null);
});

test("tampering is refused: other address, other organization, wrong signature, garbage", () => {
  const t = createConfirmToken(claim, NOW);
  const [body, sig] = t.split(".");
  const swap = (patch: object) => {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return `${Buffer.from(JSON.stringify({ ...p, ...patch })).toString("base64url")}.${sig}`;
  };
  assert.equal(verifyConfirmToken(swap({ e: "evil@x.org" }), NOW), null);
  assert.equal(verifyConfirmToken(swap({ l: "OTHER" }), NOW), null);
  assert.equal(verifyConfirmToken(`${body}.${sig.slice(0, -2)}AA`, NOW), null);
  for (const bad of ["", "abc", "a.b.c", "x".repeat(2000), `${body}.`]) assert.equal(verifyConfirmToken(bad, NOW), null);
});

test("a link signed with another secret, or for another purpose, is refused", () => {
  const body = Buffer.from(JSON.stringify({ p: "alert-email", l: "LOC1", e: "ann@org.org", t: NOW })).toString("base64url");
  const forged = `${body}.${createHmac("sha256", "some-other-secret").update(body).digest("base64url")}`;
  const withRawSecret = `${body}.${createHmac("sha256", process.env.NEXTAUTH_SECRET as string).update(body).digest("base64url")}`;
  assert.equal(verifyConfirmToken(withRawSecret, NOW), null); // signed with the plain app secret, as other tokens are
  assert.equal(verifyConfirmToken(forged, NOW), null);
  // a QuickBooks OAuth state token signed with the SAME secret must not work as a confirm link (different purpose)
  assert.equal(verifyConfirmToken(createState({ locationId: "LOC1", userId: 1 }), Date.now()), null);
  // and a confirm link must not work as an OAuth state
  assert.equal(verifyState(createConfirmToken(claim, Date.now())), null);
});

test("the address is masked on the public page", () => {
  assert.equal(maskEmail("ann@org.org"), "a**@org.org");
  assert.equal(maskEmail("bobby@org.org"), "b****@org.org");
  assert.equal(maskEmail("nonsense"), "your address");
});

test("unconfirmed address: test email carries the confirm wording and link text", () => {
  const info = { locationId: "LOC1", status: "test", posted: 0, failed: 0, error: null, trigger: "manual", runId: null };
  const p = buildAlertPayload("accounting_alert_test", info, "https://app.example/accounting-confirm?t=abc", "ann@org.org", { confirm: true });
  assert.equal(p.link, "https://app.example/accounting-confirm?t=abc");
  assert.equal(p.link_text, "Confirm you received this email");
  assert.match(p.message, /confirm you received it/);
  const confirmed = buildAlertPayload("accounting_alert_test", info, "https://app.example/admin/accounting", "ann@org.org");
  assert.equal(confirmed.link_text, "Open DonorHQ Accounting");
  assert.doesNotMatch(confirmed.message, /confirm/i);
});
