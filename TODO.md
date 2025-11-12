# TODO: Fix Contacts Page Search Functionality

## Tasks
- [x] Modify search logic in `app/api/contacts/route.ts` to trim and normalize search input for case-insensitive matching
- [ ] Test the search functionality to ensure 'A' and 'a' are treated the same and inputs are trimmed

## Details
- Current search uses `ilike` which should be case-insensitive, but to ensure robustness, normalize search input by trimming and lowercasing
- Apply `lower()` to database fields in search query for consistent case-insensitive matching
- Update search where clause to handle trimmed and normalized search term
