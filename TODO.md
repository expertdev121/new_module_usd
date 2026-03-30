# Task: Add option for changing password and username in sidebar ✅

## Steps completed:
- [x] Create TODO.md with approved plan steps
- [x] Step 1: Add User icon import to components/dashboard/sidebar.tsx
- [x] Step 2: Add Profile navigation item to getNavigationItems() for both user roles (path: "/admin/profile", label: "Profile", icon: User)
- [x] **Feedback refinement 1:** Remove "Add User" sidebar link, consolidate into Manage Users page with toggleable inline form (email/password/role, /api/admin/add-user)
- [x] **Feedback refinement 2:** Profile password change - Require current password (server verify with bcrypt), Eye/EyeOff toggle all fields, improved validation/error msgs

## Status:
**Complete including refinements.** 
- Profile ✅ Sidebar
- User management ✅ Consolidated (sidebar clean, add form in Manage Users)

## Test:
`pnpm dev` → Login admin → Profile (change username/password) ✅ → Manage Users (add new user via form) ✅

## Final Changes:
| File | Update |
|------|--------|
| sidebar.tsx | +Profile, -Add User |
| app/admin/users/page.tsx | +Toggle "Add New User" form |



