# TODO: Add Pagination and Search to Manage Users

## API Updates
- [x] Update `app/api/admin/users/route.ts` to support query parameters: `page`, `limit`, `search`
- [x] Implement pagination using offset and limit
- [x] Add search functionality (filter by email, case-insensitive)
- [x] Return paginated results with total count

## Frontend Updates
- [x] Update `app/admin/users/page.tsx` to add state for page, limit, search
- [x] Modify `fetchUsers` to pass query params to API
- [x] Add search input field above the table
- [x] Add pagination controls (Previous/Next buttons, page numbers) below the table

## Testing and Verification
- [x] Test API with query params
- [x] Verify frontend pagination and search work correctly
- [x] Ensure UI is user-friendly and responsive
