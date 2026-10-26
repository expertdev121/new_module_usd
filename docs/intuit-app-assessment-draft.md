# Intuit production app assessment: draft answers

Draft for Rutuja to copy into Intuit's questionnaire. Based on what the code does today.
Items marked **[YOU]** need a fact only you or Nikhil know. Items marked **[CHECK]** should be confirmed against the live form wording before answering.

## App details

| Question | Answer |
|---|---|
| App name | DonorHQ Accounting |
| App category | Accounting / Nonprofit donation management |
| Regulated industry | No |
| Privacy policy URL | **[YOU]** public URL |
| EULA / terms URL | **[YOU]** public URL |
| Host domain | **[YOU]** the production DonorHQ domain (the one in Vercel) |
| Launch URL | `https://<domain>/admin/accounting` |
| Redirect URI | `https://<domain>/api/admin/accounting/connection/callback` (must match the QBO_REDIRECT_URI env var exactly) |
| Disconnect URL | `https://<domain>/admin/accounting` (QuickBooks tab, "Disconnect" button) (confirmed: the button exists; it revokes the token and keeps mappings and history) |
| Hosting | App on Vercel (**[YOU]** region), database on Neon Postgres, Azure Germany West Central |

## App information

- **How built:** Next.js web app (server-side). All QuickBooks calls are made from the server, never from the browser.
- **Public or private:** Private to DonorHQ customers (nonprofits), connected one organization at a time.
- **Who connects:** The organization's admin (and their bookkeeper) in QuickBooks Online.
- **Purpose:** Posts each bank deposit of donations as one Deposit (or Journal Entry) in the customer's QuickBooks, so the bookkeeper does not retype it.

## Authorization

- OAuth 2.0 authorization code flow; scope is `com.intuit.quickbooks.accounting` only.
- `state` is a signed value (HMAC) tied to the organization and user, valid 10 minutes. A wrong or expired state is refused (CSRF protection).
- Access token is refreshed only when it is expiring or rejected, not on every call.
- Refresh tokens rotate; the new one is stored in the same step (compare-and-swap) so the old one is never reused.
- `invalid_grant` or a 401 is treated as "connection lost": the app stops syncing that organization and shows a "Reconnect QuickBooks" message.
- Connect, disconnect and reconnect were tested against a real Intuit sandbox company.
- Tokens are encrypted at rest (AES-256-GCM, key in a server environment variable).
- We do not use the OAuth Playground.
- Discovery document: **[CHECK]** the code uses fixed endpoints (authorize, token, revoke). Intuit asks whether you use the discovery document; answer honestly "no, endpoints are configured".

## API usage

- Accounting API: **Yes**. Payments API: **No**. Payroll: **No**.
- Calls per deposit: about 2 reads (company/lookup) and 1 write. Lists of accounts and classes are read only when an admin presses "Refresh lists" or connects.
- Writes use `requestid`, so a retried post cannot create a duplicate.
- Entities used: Deposit, JournalEntry, Account (read), Class (read), CompanyInfo (read).
- Minor version: 75 (pinned in `lib/accounting/qbo/config.ts`).
- Webhooks: No. Change Data Capture: No.
- QuickBooks Online versions tested: Simple Start / Plus sandbox, US company **[YOU confirm]**. Not tested: multi-currency, class tracking against real QuickBooks (sandbox had it off).

## Error handling

- QuickBooks Fault messages are turned into a plain sentence and stored on the sync log row for that deposit.
- `intuit_tid` from the response header is stored with the error (in the sync log message and the server log) after the change in this commit.
- The sync log screen shows every run and every deposit result with its error, so the customer can see what failed.
- In-app support: failed deposits show a message and a Retry button. **[YOU]** a support email/contact to give customers.
- Automatic retry only for 429/502/503/504, up to 2 retries, and only when safe (reads, or writes with a requestid).

## Security

- Client ID and secret live only in server environment variables (Vercel), never in code or the browser. **Do this first:** the database password was found hardcoded in the repo; the credentials branch removes it and the password should be rotated.
- **[YOU]** MFA on Intuit developer account, Vercel, GitHub, Neon.
- **[YOU]** Breach history (answer truthfully), security contact/team.
- CAPTCHA / WebSockets: not used by this feature.
- Data sharing: QuickBooks data is used only to post that customer's deposits and is not shared with anyone else or used for other customers.
- Each organization can only see and sync its own data (every query is scoped by location).

## Before you submit

1. Fill every **[YOU]** item. 2. Confirm the Disconnect button and minor version. 3. Make sure a public privacy policy and terms page are live. 4. India eligibility for production keys and any platform fee is unconfirmed: the questionnaire flow will show it.
