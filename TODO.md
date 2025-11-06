# TODO: Fix Merge Contacts Target Display Issue

- [x] Modify `handleSetAsTarget` in `app/admin/merge-contacts/page.tsx` to find the contact directly from `contacts` array instead of using `targetContact` useMemo.
- [x] Test the merge contacts page to ensure the display name shows correctly on first click.
- [x] Modify Merge Configuration to show individual contact data (pledges and payments) instead of combined totals.
- [ ] Add detailed pledge, payment, and manual donation details for each contact in the confirmation dialog.
