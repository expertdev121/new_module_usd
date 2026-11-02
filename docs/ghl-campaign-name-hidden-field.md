# SOP: Send a donation and its campaign from GoHighLevel to DonorHQ

**Audience:** Givesuite support / account managers setting up a client subaccount.
**Time:** about 15 minutes per form.
**Loom walkthrough:** _(add link after recording)_

## What this does

Every time a donation is paid through a GHL form or payment link, a GHL workflow sends it to DonorHQ. DonorHQ finds (or creates) the donor, finds (or creates) the campaign with the name you send, and records the donation under that campaign. Without `campaign_name` the webhook rejects the donation.

## Before you start

- The client's GHL subaccount is connected to DonorHQ (Givesuite app installed).
- You can edit Forms and Automation > Workflows in that subaccount.
- Decide the campaign name for each form. Names match **exactly** per client, including capitalisation (`Building Fund` and `building fund` become two campaigns), so keep each name identical every time.

## Step 1: Add a hidden `campaign_name` field to the form

1. Open **Sites > Forms > Builder** and edit the donation form.
2. Add a **Hidden Field** element from the left panel (Quick Add > Hidden Field).
3. Set the field name to `campaign_name` and map it to a contact custom field also called `campaign_name` (create it under Settings > Custom Fields if it doesn't exist, type: Single Line).
4. Set the hidden field's default value to the campaign, e.g. `Building Fund`.
5. Save the form.

One form carries one fixed campaign. For several campaigns, clone the form and change the default value in each copy.

Payment links (not forms) don't need this: their product name is used as the campaign when they are backfilled, and the workflow can send the product name as `campaign_name`.

## Step 2: Build the workflow

1. **Automation > Workflows > Create workflow > Start from scratch.** Name it `DonorHQ - donation sync`.
2. **Trigger:** _Payment received_ (successful payments only). Add a filter for the form or product if the workflow should only cover one form.
3. **Action:** _Webhook_.
   - Method: `POST`
   - URL: `https://donorhq.givesuite.com/api/webhook/ghl/donation`
   - Headers: none needed.
4. Under **Custom Data**, add these rows (key on the left, value on the right). For each value use the GHL merge-field picker (the `{}` icon) and choose the matching field:

| Key | Value | Required |
|---|---|---|
| `location_id` | `{{location.id}}` | yes |
| `contact_id` | `{{contact.id}}` | yes (or `email`) |
| `email` | `{{contact.email}}` | yes if no `contact_id` |
| `first_name` | `{{contact.first_name}}` | recommended |
| `last_name` | `{{contact.last_name}}` | recommended |
| `donation_amount` | picker: **Payment > Payment Received > Total Amount** | yes |
| `transaction_id` | picker: the transaction ID under **Payment > Payment Received** | strongly recommended: stops duplicates on retry |
| `campaign_name` | for form payments, the hidden field (`{{contact.campaign_name}}`); for product payments, the product name from **Payment > Payment Received**, or fixed text such as `Building Fund Donation` | yes |
| `payment_type` | payment method, e.g. card | optional |
| `currency` | payment currency, defaults to USD | optional |
| `received_date` | payment date `YYYY-MM-DD`, defaults to today | optional |

5. Save and **Publish** the workflow.

### Example: PTI's "Building fund donations" workflow

PTI already has this workflow. It has about 18 "Payment received" triggers, each filtered by "Global product is in 'Building Fund…'", followed by Add Tag, an internal notification, a Google Sheets row and an email. Its Google Sheets step already uses the amount merge field (**Payment > Payment Received > Total Amount**) and the contact merge fields (**Contact > Full Name**).

To connect it to DonorHQ, add one **Webhook** action after the Email step (it runs for every trigger) with the URL and Custom Data rows above. No new triggers are needed.

## Step 3: Test with a real $1 payment

1. Submit the form with a small live payment (test-mode payments are ignored on purpose).
2. In the workflow, open **Execution logs** and confirm the webhook step shows HTTP `201`.
3. In DonorHQ, open the donor and confirm the donation shows with the campaign. Check Campaigns for the new campaign.
4. Refund or void the $1 and delete the test donation in DonorHQ if needed.

## Sample request (what the workflow sends)

```json
{
  "location_id": "92T9l8F6sMASmiOWLMP5",
  "contact_id": "BnOLJh0RaXcTtiSfQJzg",
  "email": "donor@example.com",
  "first_name": "Jane",
  "last_name": "Donor",
  "donation_amount": 360,
  "transaction_id": "6ae6ac227a3a864b10a5fc2c",
  "campaign_name": "Building Fund",
  "payment_type": "card",
  "currency": "USD",
  "received_date": "2026-11-02"
}
```

You can test the endpoint without GHL:

```bash
curl -X POST https://donorhq.givesuite.com/api/webhook/ghl/donation \
  -H "Content-Type: application/json" \
  -d '{"location_id":"<LOCATION_ID>","email":"test@example.com","first_name":"Test","last_name":"Donor","donation_amount":1,"transaction_id":"sop-test-001","campaign_name":"SOP Test Campaign"}'
```

Use your own location ID, then delete the test donation afterwards.

## Responses

| HTTP | Code | Meaning |
|---|---|---|
| 201 | `DONATION_CREATED` | Donation recorded. |
| 200 | `DONATION_ALREADY_EXISTS` | Same `location_id` + `transaction_id` was already received. Safe, nothing duplicated. |
| 200 | `skipped: test_payment` | Test-mode payment, ignored on purpose. |
| 400 | `MISSING_CAMPAIGN_NAME` | `campaign_name` is empty. Check the hidden field default and the mapping. |
| 400 | `MISSING_LOCATION_ID` / `MISSING_CONTACT_IDENTIFIER` / `INVALID_AMOUNT` | A required row is missing or empty in Custom Data. |

## Troubleshooting

- **400 MISSING_CAMPAIGN_NAME:** the merge field came through empty. Re-check that the hidden field maps to the `campaign_name` custom field and that the form was submitted after you added it.
- **Donation missing in DonorHQ:** open the workflow execution log and read the webhook response body.
- **Two campaigns that should be one:** the names differ by spacing or spelling. Use one name per campaign across forms.

## Notes

- Contacts are matched by GHL `contact_id`, then email, inside the same subaccount. A new contact is created if neither matches.
- Existing donations pulled in earlier do not get a campaign from this workflow. They are filled in by a one-time backfill.
