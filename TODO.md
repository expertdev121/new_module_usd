# Audit Log Category Name Display Fix

## Status: In Progress

### Step 1: [PENDING] Create TODO.md (Current)
- Create this file with all steps.

### Step 2: [PENDING] Edit app/admin/log-reports/page.tsx
- Update formatDetails function to handle category actions:
  ```
  if (action.startsWith('category_') && details?.name) {
    return `Category "${details.name}" #${details.entityId}`;
  }
  ```
- Preserve all existing logic.

### Step 3: [PENDING] Test the change
- Navigate to /admin/log-reports
- Filter by action containing 'category_create' or search for category #67
- Verify name displays as "Category 'NAME' #67"
- Check other actions still work (MERGE_CONTACTS, etc.)

### Step 4: [PENDING] Verify CSV export
- Export logs with category_create entries
- Confirm details JSON includes name

## Completion Criteria
- [ ] Category names appear in log table for category_create/update/delete
- [ ] No regressions in other log formatting
- [ ] CSV export works correctly

