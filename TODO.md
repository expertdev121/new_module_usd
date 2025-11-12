# TODO: Stop Automatic Webhook Sending and Add Manual Send Receipt Button

## Tasks
- [x] Remove automatic webhook sending from app/api/webhook/payment/route.ts
- [x] Remove automatic webhook sending from app/api/manual-donations/route.ts
- [ ] Add "Send Receipt" button to payments table in components/payments/payments-client.tsx
- [ ] Create API endpoint for manual receipt sending
- [ ] Update UI to handle manual receipt sending
- [ ] Test the changes

## Details
- Stop automatic sending when payment/manual donation is created
- Add button in payments table to trigger receipt sending on click
- Ensure button only appears for completed payments with email
