# Fix Pagination in Admin Reports

## Overview
Implement proper SQL-level pagination for admin reports that currently use inefficient JavaScript array slicing. Only donor-contribution has correct SQL pagination.

## Reports to Fix
- [ ] donor-segmentation/route.ts
- [ ] financial-accounting/route.ts
- [ ] giving-trends/route.ts
- [ ] lybunt-sybunt/route.ts

## Implementation Steps
For each report:
1. Add ORDER BY clause to the main querySQL
2. Add LIMIT and OFFSET to the querySQL
3. Remove JavaScript array slicing (rows.slice)
4. Ensure total count is calculated correctly
5. Test pagination works properly

## Current Status
- donor-contribution: ✅ SQL pagination implemented
- Others: ❌ JavaScript slicing (inefficient)
