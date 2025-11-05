# Refactor Contacts Search Bar

## Task: Update /contacts page search to match input with name, email, and phone number

### Steps:
1. Modify search logic in `app/api/contacts/route.ts` to search the entire input string against name (firstName, lastName, displayName), email, and phone fields without splitting into terms.
2. Update comments to reflect the new search behavior.
3. Test the search functionality to ensure it works for full names, emails, and phone numbers.

### Files to Edit:
- `app/api/contacts/route.ts`: Update the searchWhereClause logic.

### Followup Steps:
- [] Test searching by full name, email, and phone number.
- [] Ensure case-insensitive matching works.
- [] Verify no performance issues with the new search logic.
