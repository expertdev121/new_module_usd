1# Manual Donation Editing Implementation

## Pending Tasks
- [x] Create `app/api/manual-donations/[id]/route.ts` with GET and PUT handlers for fetching and updating single manual donations
- [x] Add `useManualDonationDetailQuery` to `lib/query/manual-donations/useManualDonationQuery.ts` and change update method from PATCH to PUT
- [x] Update `components/forms/manual-payment-dialog.tsx` to accept `isEditing` and `manualDonation` props, change title to "Edit Manual Donation" when editing
- [x] Update `components/forms/manual-payment-form.tsx` button text to "Update Manual Donation" when `isEditing` is true

## Followup Steps
- [ ] Verify API routes work correctly (GET and PUT)
- [ ] Test form pre-filling with fetched data
- [ ] Test form submission for both create and update scenarios
- [ ] Ensure dialog title and button text update properly based on editing state
