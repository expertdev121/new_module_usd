# Payroc Webhook and Subscription Implementation

## Phase 1: Basic Webhook Receiver and Event Storage
- [ ] Update `drizzle/schema.ts` to add `payrocWebhookEvent` table with fields: id, eventId (unique), eventType, data (JSON), receivedAt, processed (boolean), signatureVerified, idempotencyChecked
- [ ] Run database migration to create the new table
- [ ] Implement POST handler in `app/api/webhook/route.ts`:
  - Immediately return HTTP 200 OK
  - Add idempotency check using eventId (skip if already exists)
  - Store raw payload in new table
  - Add TODO comment for signature verification
- [ ] Test webhook endpoint with mock payload

## Phase 2: Advanced Features (After Payroc Info)
- [ ] Implement proper signature verification using secret key from env
- [ ] Create `app/api/payroc/subscription/route.ts` endpoint for POST request to create subscription
  - Use correct eventTypes string from Payroc
  - Include notifications with webhook URL
- [ ] Implement payment processing logic based on stored events (create/update payments using transactionId or reference)
