# Payroc Refactor Plan

## Tasks
- [x] Create new public page at `app/payroc-public/page.tsx` for the payment form without auth
- [x] Update `middleware.ts` to exclude `/payroc-public` from auth matcher
- [x] Modify `components/forms/payroc-payment-form.tsx` to add first name, last name, email, and editable amount fields
- [x] Update `app/api/payroc/route.ts` to handle additional fields in paymentData metadata
