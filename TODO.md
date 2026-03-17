# Year-End Letter PDF Dynamic Fix

## Plan Summary
Make PDF text fully dynamic using modal inputs passed via URL query params.

## Steps
- [x] **Step 1:** Edit `app/api/contacts/send-year-end-letters/route.ts` - Append dynamic params to pdfUrl using URLSearchParams. ✅
- [x] **Step 2:** Edit `app/api/year-end-letters/[filename]/route.ts` - Parse searchParams, replace all hardcoded charity/custom/signature text with dynamic values (with fallbacks). ✅
- [ ] **Step 3:** Test: Use modal to submit with custom values, verify PDF shows dynamic text, webhook unchanged.

## Dependent Files
- app/api/contacts/send-year-end-letters/route.ts
- app/api/year-end-letters/[filename]/route.ts

## Follow-up
- No DB/installs needed.
- Test via app UI modal.
