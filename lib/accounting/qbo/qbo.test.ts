// Run: npx tsx --test lib/accounting/qbo/qbo.test.ts   (tsx resolves the extensionless imports used by app code)
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.QBO_CLIENT_ID = "client-id";
process.env.QBO_CLIENT_SECRET = "client-secret";
process.env.QBO_REDIRECT_URI = "https://app.example.test/api/admin/accounting/connection/callback";
process.env.ACCOUNTING_ENC_KEY = randomBytes(32).toString("base64");
process.env.NEXTAUTH_SECRET = "test-secret";

const { createState, verifyState } = await import("./state.ts");
const { decryptToken, encryptToken } = await import("./crypto.ts");
const { buildQboPayload } = await import("./payload.ts");
const client = await import("./client.ts");
const { FakeQbo } = await import("./fake-qbo.ts");

const ctx = (fake: InstanceType<typeof FakeQbo>) => ({ env: "sandbox" as const, realmId: "123", accessToken: fake.validAccessToken });

// ---------- state ----------
test("state round-trips and binds location and user", () => {
  const s = createState({ locationId: "LOC1", userId: 7 });
  assert.deepEqual(verifyState(s), { locationId: "LOC1", userId: 7 });
});

test("state rejects tampering, expiry, junk", () => {
  const s = createState({ locationId: "LOC1", userId: 7 }, 1_000_000);
  const [body, sig] = s.split(".");
  const forged = Buffer.from(JSON.stringify({ l: "OTHER", u: 7, t: 1_000_000, n: "x" })).toString("base64url");
  assert.equal(verifyState(`${forged}.${sig}`, 1_000_000), null);
  assert.equal(verifyState(`${body}.AAAA`, 1_000_000), null);
  assert.equal(verifyState(s, 1_000_000 + 11 * 60 * 1000), null);
  assert.ok(verifyState(s, 1_000_000 + 5 * 60 * 1000));
  for (const junk of ["", "abc", "a.b.c", "."]) assert.equal(verifyState(junk), null);
});

// ---------- crypto ----------
test("tokens are encrypted, authenticated and round-trip", () => {
  const enc = encryptToken("secret-refresh-token");
  assert.ok(!enc.includes("secret-refresh-token"));
  assert.equal(decryptToken(enc), "secret-refresh-token");
  assert.notEqual(encryptToken("x"), encryptToken("x")); // random IV
  const tampered = Buffer.from(enc, "base64");
  tampered[20] ^= 1;
  assert.throws(() => decryptToken(tampered.toString("base64")));
});

// ---------- payload ----------
const lines = [
  { accountExternalId: "41", classExternalId: "9", debitCents: 0, creditCents: 10050, memo: "General Fund · 2 gifts" },
  { accountExternalId: "42", classExternalId: null, debitCents: 0, creditCents: 4950, memo: "Building Fund · 1 gift" },
  { accountExternalId: "10", classExternalId: null, debitCents: 15000, creditCents: 0, memo: "Deposit · Check · 3 gifts" },
];
const dep = { id: 22, depositDate: "2026-09-04", reference: "SLIP-1", lines };

test("Deposit payload: bank is DepositToAccountRef, credits are coded lines with class", () => {
  const p = buildQboPayload("Deposit", dep);
  assert.equal(p.entity, "Deposit");
  assert.equal(p.docNumber, "DHQ-22");
  const b = p.body as { DepositToAccountRef: { value: string }; Line: Array<{ Amount: number; DepositLineDetail: { AccountRef: { value: string }; ClassRef?: { value: string } } }>; TxnDate: string };
  assert.equal(b.DepositToAccountRef.value, "10");
  assert.equal(b.TxnDate, "2026-09-04");
  assert.deepEqual(b.Line.map((l) => l.Amount), [100.5, 49.5]);
  assert.equal(b.Line[0].DepositLineDetail.ClassRef?.value, "9");
  assert.equal(b.Line[1].DepositLineDetail.ClassRef, undefined);
  assert.ok(p.requestId.length <= 50);
});

test("JournalEntry payload: every line has a posting type, totals balance", () => {
  const p = buildQboPayload("JournalEntry", dep);
  const l = (p.body as { Line: Array<{ Amount: number; JournalEntryLineDetail: { PostingType: string } }> }).Line;
  assert.equal(l.length, 3);
  const sum = (t: string) => l.filter((x) => x.JournalEntryLineDetail.PostingType === t).reduce((s, x) => s + Math.round(x.Amount * 100), 0);
  assert.equal(sum("Debit"), sum("Credit"));
  assert.equal(sum("Debit"), 15000);
});

test("extra debit (e.g. a fee) becomes a negative deposit line", () => {
  const withFee = { ...dep, lines: [...lines.slice(0, 2), { accountExternalId: "77", classExternalId: null, debitCents: 300, creditCents: 0, memo: "Fees" }, { ...lines[2], debitCents: 14700 }] };
  const b = buildQboPayload("Deposit", withFee).body as { DepositToAccountRef: { value: string }; Line: Array<{ Amount: number }> };
  assert.equal(b.DepositToAccountRef.value, "77");
  assert.ok(b.Line.some((x) => x.Amount < 0));
});

test("unbalanced or empty deposits are refused; same content gives the same request id", () => {
  assert.throws(() => buildQboPayload("Deposit", { ...dep, lines: [lines[0], lines[2]] }), /balance/);
  assert.throws(() => buildQboPayload("Deposit", { ...dep, lines: [] }));
  assert.equal(buildQboPayload("Deposit", dep).requestId, buildQboPayload("Deposit", dep).requestId);
  assert.notEqual(buildQboPayload("Deposit", dep).requestId, buildQboPayload("Deposit", { ...dep, depositDate: "2026-09-05" }).requestId);
});

// ---------- client against the fake ----------
test("auth URL carries client id, scope, redirect and state", () => {
  const u = new URL(client.buildAuthUrl("STATE123"));
  assert.equal(u.origin + u.pathname, "https://appcenter.intuit.com/connect/oauth2");
  assert.equal(u.searchParams.get("client_id"), "client-id");
  assert.equal(u.searchParams.get("scope"), "com.intuit.quickbooks.accounting");
  assert.equal(u.searchParams.get("state"), "STATE123");
  assert.equal(u.searchParams.get("redirect_uri"), process.env.QBO_REDIRECT_URI);
});

test("code exchange, then refresh rotates the refresh token", async () => {
  const fake = new FakeQbo();
  client.setQboFetch(fake.fetch);
  const t1 = await client.exchangeCode("good-code");
  assert.equal(t1.refreshToken, "refresh-2");
  const t2 = await client.refreshTokens(t1.refreshToken);
  assert.equal(t2.refreshToken, "refresh-3");
  await assert.rejects(client.refreshTokens("refresh-2"), client.QboAuthError); // the old one is dead
  await assert.rejects(client.exchangeCode("bad-code"), client.QboAuthError);
});

test("queries page through every account, active and inactive", async () => {
  const fake = new FakeQbo();
  for (let i = 0; i < 2300; i++) fake.addAccount({ Name: `A${i}`, Active: i % 2 === 0 });
  client.setQboFetch(fake.fetch);
  const all = await client.queryAll<{ Id: string }>(ctx(fake), "Account");
  assert.equal(all.length, 2300);
  assert.equal(new Set(all.map((a) => a.Id)).size, 2300);
});

test("a 401 means reconnect; a Fault becomes one plain sentence", async () => {
  const fake = new FakeQbo();
  client.setQboFetch(fake.fetch);
  await assert.rejects(client.qboRequest({ ...ctx(fake), accessToken: "stale", path: "companyinfo/123" }), client.QboAuthError);
  fake.failDocs.set("DHQ-5", "Account Period Closed");
  await assert.rejects(
    client.qboRequest({ ...ctx(fake), method: "POST", path: "deposit", body: { DocNumber: "DHQ-5", Line: [] }, requestId: "r1" }),
    (e: unknown) => e instanceof client.QboApiError && e.message.includes("Account Period Closed") && e.status === 400,
  );
  assert.equal(client.faultMessage({ nothing: true }), null);
});

test("rate limits are retried when the POST carries a request id, and are not duplicated", async () => {
  const fake = new FakeQbo();
  const a = fake.addAccount({ Name: "Income" });
  client.setQboFetch(fake.fetch);
  fake.rateLimitCreates = 2;
  const body = { DocNumber: "DHQ-9", TxnDate: "2026-09-04", DepositToAccountRef: { value: a.Id }, Line: [{ Amount: 1, DetailType: "DepositLineDetail", DepositLineDetail: { AccountRef: { value: a.Id } } }] };
  const r = await client.qboRequest<{ Deposit: { Id: string } }>({ ...ctx(fake), method: "POST", path: "deposit", body, requestId: "dhq-9-x" });
  assert.ok(r.Deposit.Id);
  assert.equal(fake.creates(), 1);
  // Same request id again returns the original, creating nothing new.
  const again = await client.qboRequest<{ Deposit: { Id: string } }>({ ...ctx(fake), method: "POST", path: "deposit", body, requestId: "dhq-9-x" });
  assert.equal(again.Deposit.Id, r.Deposit.Id);
  assert.equal(fake.creates(), 1);
  // Without a request id a POST is never retried (it could double-post).
  fake.rateLimitCreates = 1;
  await assert.rejects(client.qboRequest({ ...ctx(fake), method: "POST", path: "deposit", body: { ...body, DocNumber: "DHQ-10" } }), client.QboApiError);
});
