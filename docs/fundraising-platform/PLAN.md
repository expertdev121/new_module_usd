# Fundraising / Campaign Platform — Build Plan

Branch: `feat/fundraising-platform`. Requested by Brandy & Sean (GiveSuite). Source:
Granola meetings. Goal: a **GiveButter-style, simple** in-house fundraising platform
**inside DonorHQ** where a user creates a campaign, shares it, and collects money —
built by **extending the existing Crowded "Donation Forms" module**, not from scratch.

## Guiding principles
- **Simple first.** Explicitly less complex than the old "Fundraiser". Wizard: create → launch.
- **Reuse Crowded** for payment collection (default 2.99%, donors can cover fees) and the
  existing public donor page + webhook → `manual_donation` sync + receipts.
- **Everything lands in DonorHQ + GHL**: campaign id on payments, tags mirrored to GHL.
- **Forms live in DonorHQ**, not GHL (GHL = contact/survey forms only).

## Requirements (from Granola) → phase
| # | Requirement | Phase |
|---|---|---|
| Campaign pages: instant create, branding (colors/layout), **progress bar**, story | 1 |
| Hosted, **shareable** public campaign page (nice slug URL) | 1 |
| **Goal** + **donation cap** (stop at target) | 1 |
| Collect money via **Crowded** (reuse), donor covers fees, auto receipt | 1 |
| Campaign id on payment records; sync to DonorHQ + GHL | 1 |
| **Global all-payments view** (across all campaigns) + filter by tag | 2 |
| **Self-serve webhook UI** (user connects a workflow → fires GHL on payment) | 2 |
| Campaign **tags mirrored to GHL** ("Summer 2026") | 2 |
| **Sub-campaigns** (many under one parent) | 3 |
| **Peer-to-peer** (team) campaigns | 3 |
| **Shopping cart** (donate to several at once) | 3 |
| Swappable processor via API keys (Coastal Pay) | 4 |
| "Do-it-for-you" upsell; AskBrandy KB entry | 4 (ops, not code) |

## Architecture / data model
Extend, don't duplicate. Working decision (confirm against Crowded map):
- A **fundraising campaign** = a Crowded form + campaign metadata. Add campaign fields
  (slug, goal_amount, cover image, brand colors, story, status, parent_campaign_id for
  sub-campaigns, team/P2P owner) either as columns on `crowded_forms` or a sibling
  `fundraising_campaign` table 1:1 with a crowded form. Decide after the Crowded map.
- **Raised** = SUM of `manual_donation.amount` grouped by the form/campaign linkage that
  Crowded already writes (crowded_form_id / campaign_id) — powers the progress bar.
- **Public page**: new hosted route (e.g. `/f/[slug]`) rendering branding + story +
  progress bar + donate (reuses the Crowded intent flow). Standalone layout (like
  `/donate/[formId]` — already bypasses the app shell in layout-wrapper).

## Phase 1 deliverables (this branch, first)
1. Schema: campaign metadata (goal, slug, cover, colors, story, status, parent id) — migration `.mjs` (idempotent), matching repo convention.
2. Admin: "Campaigns / Fundraising" create+edit (wizard) and list, reusing the Crowded connection + form-builder pieces.
3. Public hosted campaign page `/f/[slug]` with progress bar + donate button (Crowded intent).
4. Progress/raised aggregation query.
5. Goal cap enforcement (stop accepting at target — website rule).

## Notes
- Granola: platform is "on the back burner as of Aug 25" pending Reach.app decision + backlog
  (Crowded API, add-ons fixes, docs app, webhook UI). Building anyway per direct instruction.
- **Do NOT push.** All work stays on `feat/fundraising-platform` for review.

## Change log (this branch)
- (init) plan doc.
- **Phase 1 (campaign pages + progress + collection) — implemented:**
  - `lib/db/schema-fundraising.ts` — `fundraising_campaign` table.
  - `.apply-fundraising-migration.mjs` — table + indexes + `crowded_forms.fundraising_campaign_id` + `manual_donation(crowded_form_id)` index. **RAN** (additive/idempotent).
  - `lib/fundraising/repo.ts` — slug, unique-slug, CRUD, raised/progress aggregation (sum manual_donation by crowded_form_id, revenue-only).
  - `app/api/admin/fundraising/route.ts` (GET list + POST create) + `[id]/route.ts` (GET/PATCH/DELETE) — guarded by requireCrowdedAdmin.
  - `app/f/[slug]/page.tsx` — public hosted branded campaign page + progress bar + Donate → linked Crowded form.
  - `app/admin/fundraising/{page,new,[id]}.tsx` + `_components/campaign-form.tsx` — list, create wizard, edit, share link, delete.
  - `middleware.ts` (+`/f` bypass), `app/layout-wrapper.tsx` (+`/f` standalone), `components/dashboard/sidebar.tsx` (+ "Fundraising" nav).
  - Payment collection REUSES Crowded end-to-end (intent → hosted checkout → webhook → manual_donation with crowded_form_id → progress).
- **Phase 2 (campaign tags→GHL + self-serve webhooks) — implemented:**
  - `lib/db/schema-fundraising.ts` — added `ghl_tag`, `team_enabled`, `owner_name`, `owner_contact_id`, `processor` columns on `fundraising_campaign`; new `fundraising_webhook` table (url, event, campaign scope, is_active, last_fired_at/last_status).
  - `.apply-fundraising-p234-migration.mjs` — additive columns + webhook table. **RAN** (idempotent).
  - `lib/fundraising/webhooks.ts` — list/create/delete webhooks, `fireDonationWebhooks` (POST to active matching hooks, stamps last_fired/last_status), `handleFundraisingDonation` (mirror campaign `ghl_tag` onto donor's GHL contact + fire webhooks).
  - `lib/crowded/webhook-handlers/payment-succeeded.ts` — best-effort post-donation hook calls `handleFundraisingDonation` on completed/processing.
  - `app/api/admin/fundraising/webhooks/route.ts` (GET/POST) + `[id]/route.ts` (DELETE); `app/admin/fundraising/webhooks/page.tsx` — self-serve webhook UI (add/list/delete, scope to a campaign or all). Sidebar + campaigns-header links added.
- **Phase 3 (sub-campaigns + peer-to-peer teams) — implemented:**
  - Repo: `parentCampaignId`, `getSubCampaigns`/`getPublicSubCampaigns` (progress per child, sorted by raised).
  - `campaign-form.tsx` — "Sub-campaign of" parent selector, "Peer-to-peer team fundraising" toggle + fundraiser/team owner name.
  - `app/f/[slug]/page.tsx` — parent rolls up children's raised/donors into its progress bar + renders a **team leaderboard** linking each child page; owner name shown under title.
  - (Cart = deferred; not requested for this pass.)
- **Phase 4 (swappable processor) — foundation:**
  - `processor` column + selector on the campaign form (Crowded default; additional processors are additive later — no schema change needed).
- **TODO next / deferred:** global all-payments cross-campaign view (existing `/donations` already lists all payments; a fundraising-scoped view can be layered later); shopping cart (Phase 3 nice-to-have); Coastal Pay processor adapter (Phase 4, needs API keys + Crowded map).
