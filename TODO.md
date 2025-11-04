# TODO: Standardize Date Inputs Across Codebase

## Overview
Replace all `<Input type="date" />` with the custom `<DateInput />` component for better UX with calendar popover.

## Files to Edit
- [ ] components/forms/student-role.tsx (2 instances) - Add DateInput import, replace Input type="date" with DateInput, preserve custom onChange
- [ ] components/forms/payment-plan-dialog.tsx (3 instances) - Add DateInput import, replace Input type="date" with DateInput, preserve custom onChange
- [ ] components/forms/payment-form.tsx (3 instances) - Add DateInput import, replace Input type="date" with DateInput, preserve custom onChange
- [ ] components/forms/payment-dialog.tsx (3 instances) - Add DateInput import, replace Input type="date" with DateInput, preserve custom onChange
- [ ] components/forms/contact-role-form.tsx (2 instances) - Add DateInput import, replace Input type="date" with DateInput, preserve custom onChange
- [ ] app/contacts/[contactId]/payments/__components/edit-payment.tsx (3 instances) - Add DateInput import, replace Input type="date" with DateInput, preserve custom onChange
- [ ] app/admin/log-reports/page.tsx (2 instances) - Add DateInput import, replace Input type="date" with DateInput, preserve custom onChange

## Followup Steps
- [ ] Test forms to ensure date inputs work correctly
- [ ] Check for validation issues
