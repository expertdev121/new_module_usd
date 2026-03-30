# Task Refinement: Consolidate Add User into Manage Users + Hide Add User sidebar link ✅

## Original Task Status:
- Profile option ✅ Added to sidebar

## Steps completed:
- [x] Create TODO-refinement.md
- [x] Step 1: Removed "/admin/add-user" nav item from sidebar.tsx regular admin array
- [x] Step 2: Added inline toggleable "Add New User" form to app/admin/users/page.tsx (email/password/role, POST /api/admin/add-user, toast feedback, auto-refresh table)
- [x] Step 3: Updated main TODO.md below
- [x] Step 4: Changes applied successfully (verified diffs)

## Test Instructions:
1. `pnpm dev`
2. Login as admin → Sidebar → Manage Users
3. Click "Add New User" → Fill form → Submit → Verify user appears in table
4. Toggle form cancel works

**All refinements complete. Original task + feedback fully addressed.**


