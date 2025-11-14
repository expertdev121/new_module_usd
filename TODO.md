# TODO: Create Send-Pledge API

## Steps to Complete
- [x] Create new API endpoint at `app/api/send-pledge/route.ts`
  - Implement POST handler to accept pledgeId and type='pledge'
  - Add schema validation for input
  - Fetch pledge data from database
  - Fetch associated contact data
  - Send contact and pledge details to webhook based on location ID
  - Handle errors and responses similar to send-receipt
- [x] Test the new API endpoint
- [x] (Optional) Integrate into pledge creation process if needed
