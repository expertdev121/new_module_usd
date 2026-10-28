# Stripe payout import: design (not built)

Status: design only. Nothing here changes code, the database, or Stripe. All Stripe calls described are read-only.

## Why

The consultant's advice (forwarded by Brandy) for version one: checks/cash plus one processor, one summarized QuickBooks Deposit per real bank deposit, with income lines per fund and a negative processing-fee line, so the total equals the bank-feed amount. Block posting if a fund is unmapped or the payout does not balance.

## What the live data says (read-only survey, 2026-10-28)

- About 101k gifts look online (card, Stripe, PayPal), but only 8 carry a Stripe payment id (`pi_`) and 202 a charge id (`ch_`). 85k carry no id at all. Almost all of them are historical imports (operator scripts, Razoredge). **Only gifts dated on or after an org's start date ever sync, so those imports are out of scope.**
- Recent online volume is small: 160 to 330 gifts a month across all orgs (May to Oct 2026). Most recent ones came from operator imports in 2 orgs, not live capture.
- Gifts captured live with a Stripe id: **4**, all from the Fundraising Campaigns Stripe checkout (`import_source = stripe_fundraising`, `reference_number = pi_...`), in one org.
- Stripe connections in the database: **1**, active, **test mode**, none live.
- Other online gifts arrive through GHL (about 1,050 total, carrying GHL ids, not Stripe ids) or the GHL "Stripe sync" webhook (stores no id at all). They cannot be matched to a Stripe payout.

Conclusion: a payout import would serve only orgs that collect through the Fundraising Stripe checkout with their own Stripe key. Today that is one test org. Building the full import now would be building for nobody yet.

## Options

**A. Stripe payout import (API).** Read each paid payout from the org's own Stripe account, match its charges to DonorHQ gifts by `pi_` id, post one deposit with fee and refund lines. Exact, automatic, but only works for gifts that carry a Stripe id.

**B. Manual card deposit with a typed fee (recommended first).** Let the bookkeeper build a deposit from selected card gifts and type the payout's fee amount from the Stripe dashboard. DonorHQ posts income per fund, a negative fee line to the mapped fee account, and checks the total against the bank amount she types. Works for any processor and any gift origin (GHL, imports, PayPal). No Stripe keys, no API, no new tables: `deposits.fees` and `source_map.fee_account_id` already exist.

**C. Both.** B now, A later for orgs that go live on Stripe checkout.

## Option A in detail

### Reads (per org, with the org's own key from `stripe_connections`, decrypted server-side)
1. `GET /v1/payouts?status=paid&arrival_date[gte]=<start date>` (paginated).
2. For each payout not yet imported: `GET /v1/balance_transactions?payout=po_...&limit=100&expand[]=data.source` (paginated). Each row has `type` (charge, payment, refund, stripe_fee, adjustment, dispute, payout), `amount`, `fee`, `net`, and the source charge, which links to its `payment_intent`.
3. Balance check: the sum of `net` over the payout's rows must equal the payout amount. If not, block and show the difference.

### Matching
- Charge to gift: `manual_donation.reference_number = payment_intent id`, same location.
- Any charge with no matching gift: block the whole payout ("Payout includes a payment DonorHQ does not know: pi_...") and let the bookkeeper resolve it. Never guess.
- Gift already in another deposit: block (the existing one-deposit-per-gift rule).

### Entry
- Credit income per fund from the gross of matched gifts (existing fund map).
- Debit `fees` as a negative line to the source's fee account (`source_map.fee_account_id`); refunds as negative income lines against the original gift's fund.
- Debit the bank account mapped to the Stripe source. Total equals the payout amount.
- `deposits.source = 'stripe'`, `external_ref = po_...` (the unique index `deposits_source_ref_unique` already stops a payout importing twice).

### Writes
- Local only: a new deposit row in the normal `open` state, so the bookkeeper previews, closes and posts it with the existing flow. Nothing is written to Stripe. Posting to QuickBooks stays one deposit, with request-id protection.

### Needed from each org
- A Stripe key that can read payouts, balance transactions and charges. A full secret key works; a restricted key needs Payouts (read), Balance (read) and Charges/PaymentIntents (read). The connect screen should test this and say plainly what is missing.
- Live-mode key. The one connection today is test mode and would import test payouts, so the importer must refuse a test-mode connection for a live QuickBooks company.

### Edge cases to handle
- Donor-covered fees: the fundraising checkout stores the charged amount as the gift and notes the net in free text. The importer must not double count the covered fee.
- Refunds and disputes in a later payout than the original gift.
- Payout date versus gift date: with cash basis the deposit date is the payout arrival date, so income can fall in a later month than the gift. The consultant suggests a processor clearing account if gift-date recognition matters. This is a decision for the bookkeeper.
- Non-USD charges: block.
- Stripe rate limits and pagination: page through with a request cap and resume next run.
- Key later revoked: mark the connection `needs_reconnect`, show a banner, stop importing.

### Size
Roughly 3 to 4 working days with tests against a Stripe test account, plus a fee/clearing account setting and a screen for imported payouts. No migration is required unless we add a clearing-account setting.

## Option B in detail (small)
- Allow `card` (and `paypal`) as a deposit source in the deposit builder.
- Add two fields on the deposit dialog: **fee** and **bank amount received**.
- On close, require `gross - fees - refunds = bank amount`, and require a mapped fee account when fees > 0.
- Roughly 1 day plus tests and a browser check.

## Recommendation
1. Build **B** first. It covers every online gift regardless of processor and needs no keys.
2. Defer **A** until at least one org collects live donations through the Fundraising Stripe checkout.
3. Do not try to import payouts for historical or GHL-sourced gifts.

## Questions for Nikhil
1. Which processors do real clients use today for online gifts (Stripe directly, GHL's processor, PayPal)?
2. Is any org about to go live on the Fundraising Stripe checkout? If yes, A moves up.
3. Does the bookkeeper want income on the gift date or the payout date (clearing account or not)?
4. Is it acceptable for the bookkeeper to type the fee amount for now (option B)?
