# Campaign Merge Functionality Implementation

## Overview
Add campaign merge functionality to the Campaign Management section that allows merging multiple campaigns into one target campaign, updating related manual donations.

## Tasks Completed
- [x] Added `useMergeCampaigns` hook to `lib/query/useCampaigns.ts`
- [x] Created merge page component at `app/admin/campaigns/merge/page.tsx`
- [x] API route already exists at `app/api/campaigns/merge/route.ts` (handles POST requests and updates manual donations)

## Key Features Implemented
- Select multiple source campaigns to merge
- Choose a target campaign to keep
- Warning about permanent deletion of source campaigns
- Automatic update of manual donations to point to target campaign
- Proper error handling and user feedback
- Form validation and state management

## Technical Details
- Uses existing API endpoint that handles database transactions
- Updates `manual_donation.campaignId` for all donations associated with source campaigns
- Deletes source campaigns after successful merge
- Invalidates React Query cache to refresh campaign list
- Responsive UI with proper loading states

## Testing
- [ ] Test the merge functionality with sample campaigns
- [ ] Verify manual donations are properly reassigned
- [ ] Check error handling for edge cases
- [ ] Ensure UI updates correctly after merge

## Notes
- The API route was already implemented and handles the core merge logic
- Manual donations are automatically updated as part of the merge process
- Source campaigns are permanently deleted after successful merge
