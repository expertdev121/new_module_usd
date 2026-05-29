# Donor HQ Chatbot User Help Guide

Use this document as the knowledge source for a user-facing chatbot. The chatbot should answer questions from admins and users about how to use Donor HQ. Keep answers practical, short, and step-by-step.

Do not answer like a developer unless the user asks for technical help. Most users need directions such as where to click, what fields mean, why something is missing, and what to check before doing important actions.

## Chatbot Answer Style

When a user asks a question:

1. Give the direct answer first.
2. Mention the page or menu path.
3. Give short steps.
4. Warn users when an action cannot be undone.
5. Mention permissions if the user may not have access.
6. Ask for clarification only if the question could mean more than one workflow.

Example answer style:

User: How do I create a campaign?

Answer: Go to Manage Campaigns, click New Campaign, enter the campaign name, optional description, choose a status, then save. If you do not see Manage Campaigns, your user role may not have admin access.

## Basic Navigation

Main sections admins usually use:

- Dashboard Home: high-level totals, charts, trends, and exports.
- Financial Module: contacts, donor details, pledges, payments, manual donations, payment plans, and financial history.
- Reports: donor, campaign, accounting, pledge, and transaction reports.
- Manage Campaigns: create, edit, delete, and merge campaigns.
- Manage Users: user account management.
- Merge Contacts: combine duplicate contact records.
- Manage Categories: categories, category items, and category groups.
- Payment Methods: configure payment methods and details.
- Manage Tags: manage tags used on contacts, pledges, and payments.
- Solicitors: manage solicitors and assignments.
- Accounts: manage donation/accounting accounts.
- Manual Donation Upload: import donations from CSV.
- Audit Log: review user/admin activity.

If a user cannot see one of these menu items, they may not have the correct role. Many admin tools require an admin account.

## Roles And Access

There are two access levels this guide covers:

- Admin: manages their organization/location data including contacts, campaigns, pledges, payments, donations, reports, and settings.
- Contact/user: can view limited contact-related information.

Important rule:

Admins see only records connected to their location. If a contact, campaign, or report result is missing, the first thing to check is whether the record belongs to the same location as the admin.

## What Is A Location

A location is your organization's account or branch within the system. Each admin is connected to one location and can only see data that belongs to that location.

This is why contacts, campaigns, pledges, payments, and reports are all filtered to your location. If a record is missing, the first thing to check is whether it belongs to your current location.

If you manage multiple locations, you may need to log in as the correct admin for each one.

## What Is A GHL Contact ID

GHL Contact ID is the unique identifier assigned to a contact by GoHighLevel (GHL). It is the most reliable way to match contacts during imports, webhooks, and syncs.

When importing donations from CSV or when a payment comes in through GHL, the system uses the GHL Contact ID to find the correct contact record. If the GHL Contact ID is missing or wrong, the system may create a duplicate contact or fail to find the existing one.

If a contact does not have a GHL Contact ID, you can add it manually by editing the contact record.

## What Is A Display Name

Display name is the name shown for a contact in reports, receipts, and exports. It is usually a formatted or preferred version of the contact's full name.

When to use it:

- Use display name when the contact prefers a different name than their legal first and last name.
- Use it for households, couples, or organizations where the display name should represent the full entity rather than one person.

Example: A contact named John Smith might have a display name of "John and Jane Smith" if they donate as a couple.

If the display name is blank, the system may fall back to the contact's first and last name.

## How Contacts And Donations Are Created Through GHL Workflows

Some contacts and donations are created automatically. This happens when a GHL workflow inside Givesuite is triggered, such as when a donor submits a form or completes a payment.

When this happens:

- A contact record is created or matched automatically using the GHL Contact ID or email.
- A manual donation or payment record is created and linked to that contact.
- You do not need to manually create these records.

If a contact or donation appears that nobody created manually, it most likely came through a GHL workflow.

If the record looks incorrect:

- Check the contact's GHL Contact ID.
- Review the donation amount and date.
- Edit the contact or donation if any fields need correction.
- If a duplicate contact was created, use Merge Contacts to combine the records.

## How To Create A Campaign

Page:

- Manage Campaigns

Steps:

1. Open the left menu.
2. Click Manage Campaigns.
3. Click New Campaign.
4. Enter the Campaign Name. This is required.
5. Add a Description if needed.
6. Choose a Status:
   - Active: campaign is currently in use.
   - Inactive: campaign is not currently active.
   - Completed: campaign has ended.
7. Click the save/create button.

Notes:

- Campaigns belong to the admin's current location.
- If the campaign does not appear, refresh the page or check whether you are logged in as the correct admin/location.

## How To Edit A Campaign

Page:

- Manage Campaigns

Steps:

1. Open Manage Campaigns.
2. Search for the campaign if needed.
3. Open the campaign actions menu.
4. Choose Edit.
5. Update the name, description, or status.
6. Save the changes.

Use this when:

- A campaign name is misspelled.
- The description needs cleanup.
- The campaign status needs to change from active to completed or inactive.

## How To Delete A Campaign

Page:

- Manage Campaigns

Steps:

1. Open Manage Campaigns.
2. Find the campaign.
3. Open the campaign actions menu.
4. Choose Delete.
5. Confirm the delete action.

Warning:

Deleting should be used carefully. If the campaign has donation history, consider merging it into the correct campaign instead of deleting.

## How To Merge Campaigns

Page:

- Manage Campaigns > Merge Campaigns

Use this when:

- The same campaign was created twice.
- Donations are split across duplicate campaign names.
- You want all manual donations from several campaigns moved into one campaign.

Steps:

1. Open Manage Campaigns.
2. Click Merge Campaigns.
3. In Source Campaigns, select the campaigns you want to merge.
4. In Target Campaign, choose which selected campaign should remain.
5. Review the merge summary.
6. Click Merge Campaigns.

Important warning:

- Campaign merging is irreversible.
- Source campaigns are permanently deleted.
- Manual donations connected to source campaigns are reassigned to the target campaign.
- The target campaign is the one that remains after the merge.

If the target campaign does not appear:

- You must first select it as one of the source campaigns. The target can only be chosen from the selected source campaigns.

## How To Search Contacts

Page:

- Financial Module

Steps:

1. Open Financial Module.
2. Use the search box in the contacts table.
3. Search by name, display name, email, phone, GHL Contact ID, contact ID, or tag.
4. Open the contact record to view details.

If a contact is missing:

- Check spelling.
- Try searching by email or GHL Contact ID.
- Confirm the contact belongs to your location.
- If duplicate contacts exist, use Merge Contacts.

## How To Create A Contact

Page:

- Financial Module > New Contact

Steps:

1. Open Financial Module.
2. Click New Contact.
3. Fill in contact details such as name, email, phone, address, and other available fields.
4. Save the contact.

Tips:

- Use a real email when possible because contact matching and imports may use email.
- Avoid creating a new contact before searching for existing matches.

## How To Edit A Contact

Page:

- Financial Module > open contact

Steps:

1. Open Financial Module.
2. Search for and open the contact.
3. Click the Edit or pencil icon on the contact record.
4. Update the fields you need such as name, email, phone, address, display name, or GHL Contact ID.
5. Save the changes.

Tips:

- Changing the email may affect future contact matching and imports.
- Changing the GHL Contact ID should only be done if you are sure of the correct value.

## How To Delete A Contact

Page:

- Financial Module > open contact

Warning:

Deleting a contact is permanent. All related pledges, payments, and donation history may also be affected. Consider merging instead of deleting when possible.

Steps:

1. Open Financial Module.
2. Search for and open the contact.
3. Open the contact actions menu.
4. Choose Delete.
5. Confirm the delete action.

Before deleting:

- Check whether the contact has any pledges, payments, or manual donations.
- If the contact is a duplicate, use Merge Contacts instead.

## How To View A Contact's Financial History

Page:

- Financial Module > open a contact

Steps:

1. Open Financial Module.
2. Search for the contact.
3. Open the contact record.
4. Use the contact tabs/pages to view overview, financial summary, pledges, payments, manual donations, payment plans, campaigns, categories, tags, and relationships.

The financial summary may include:

- Total pledged.
- Total paid.
- Current balance.
- Recent payment date.
- Pledge history.
- Payment history.
- Manual donations.

## How To Merge Duplicate Contacts

Page:

- Merge Contacts

Use this when:

- One donor has multiple contact records.
- Payments or pledges are split across duplicate contacts.
- A duplicate was created by import, webhook, or manual entry.

Steps:

1. Open Merge Contacts.
2. Search for the contacts.
3. Select at least two contacts.
4. Choose one contact as the Target.
5. Review or edit the final Display Name, Email, and GHL Contact ID.
6. Review the selected contacts and financial totals.
7. Click Merge Contacts.
8. Review the confirmation dialog carefully.
9. Confirm the merge.

Important warning:

- This action cannot be undone.
- Source contacts are permanently deleted.
- All related data is moved to the target contact.
- Related data can include pledges, payments, and manual donations.

How to choose the target contact:

- Keep the record with the best or most current name, email, and GHL Contact ID.
- If one record has the correct GHL Contact ID, usually choose that one as the target.
- If one record has the correct email, make sure the final email field uses that email.

If the merge button is disabled:

- Make sure at least two contacts are selected.
- Make sure one selected contact is set as the target.

## How To Handle Duplicate Contacts

Recommended process:

1. Search for the donor in Financial Module.
2. Compare names, emails, phone numbers, GHL Contact IDs, pledges, payments, and manual donations.
3. If they are the same person, go to Merge Contacts.
4. Select all duplicate records.
5. Choose the best record as the target.
6. Confirm final name, email, and GHL Contact ID.
7. Merge only when you are sure.

Do not merge contacts if:

- They are different people with the same last name.
- One is a business/foundation and one is a person, unless the team intentionally wants one record.
- You are not sure which record should remain.

Suggested chatbot response if user is unsure:

Before merging, compare email, phone, address, GHL Contact ID, and donation history. If those details do not clearly match, do not merge yet.

## How To Create A Pledge

Page:

- Financial Module > open contact > Pledges

Steps:

1. Open Financial Module.
2. Search for and open the contact.
3. Go to the Pledges section.
4. Click the button to add/create a pledge.
5. Enter pledge date and amount.
6. Choose currency.
7. Add category, relationship, campaign code, notes, or tags if needed.
8. Save the pledge.

Notes:

- A pledge tracks a promised amount.
- Payments can later be applied against the pledge.
- Pledge balance starts as the full pledge amount and decreases as payments are recorded.

## How To Edit A Pledge

Page:

- Financial Module > open contact > Pledges

Steps:

1. Open the contact.
2. Go to the Pledges section.
3. Find the pledge.
4. Click Edit or choose Edit from the pledge actions menu.
5. Update the fields such as date, amount, currency, category, campaign, notes, or tags.
6. Save the changes.

Notes:

- Changing the pledge amount will affect the outstanding balance.
- Do not reduce the pledge amount below what has already been paid.

## How To Delete A Pledge

Page:

- Financial Module > open contact > Pledges

Warning:

Deleting a pledge is permanent. Any payments linked to that pledge may become unlinked.

Steps:

1. Open the contact.
2. Go to the Pledges section.
3. Find the pledge.
4. Open the pledge actions menu.
5. Choose Delete.
6. Confirm the delete.

Before deleting:

- Check whether any payments are already recorded against the pledge.
- If payments exist, review whether those payments need to be reassigned or deleted first.

## How To Record A Payment Toward A Pledge

Page:

- Financial Module > open contact > Payments or Pledges

Steps:

1. Open the contact.
2. Go to Payments or open the pledge.
3. Choose add/create payment.
4. Enter the amount.
5. Select currency and exchange rate if needed.
6. Enter payment date and received date.
7. Select payment method and method detail.
8. Add reference number, check number, receipt number, account, solicitor, tags, or notes if needed.
9. Save the payment.

What happens after saving:

- The pledge paid amount and balance update.
- The payment appears in the contact's financial history.
- Receipt data may be sent to the configured receipt workflow.
- The action may appear in the audit log.

## How To Edit A Payment

Page:

- Financial Module > open contact > Payments

Steps:

1. Open the contact.
2. Go to the Payments section.
3. Find the payment.
4. Click Edit or choose Edit from the payment actions menu.
5. Update the fields such as amount, date, payment method, reference number, or notes.
6. Save the changes.

Notes:

- Changing the amount will affect the pledge balance if the payment is linked to a pledge.
- Changing the payment date affects how it appears in reports.

## How To Delete A Payment

Page:

- Financial Module > open contact > Payments

Warning:

Deleting a payment is permanent. The pledge balance will be adjusted if the payment was linked to a pledge.

Steps:

1. Open the contact.
2. Go to the Payments section.
3. Find the payment.
4. Open the payment actions menu.
5. Choose Delete.
6. Confirm the delete.

## How To Add A Manual Donation

Page:

- Financial Module > open contact > manual donation/payment option

Use this when:

- The donation is not tied to a pledge.
- You need to enter a one-time donation directly for a contact.

Steps:

1. Open the contact.
2. Choose the manual donation option.
3. Enter donation amount.
4. Choose currency.
5. Enter received/payment date.
6. Select payment method.
7. Add category, category item, account, campaign, solicitor, receipt, or notes if needed.
8. Save the donation.

Notes:

- Manual donations count toward donor totals.
- Manual donations can be connected to campaigns and categories.
- Manual donations can generate receipt data.

## How To Edit A Manual Donation

Page:

- Financial Module > open contact > Manual Donations

Steps:

1. Open the contact.
2. Go to the Manual Donations section.
3. Find the donation.
4. Click Edit or choose Edit from the donation actions menu.
5. Update the fields such as amount, date, payment method, campaign, category, or notes.
6. Save the changes.

## How To Delete A Manual Donation

Page:

- Financial Module > open contact > Manual Donations

Warning:

Deleting a manual donation is permanent. The donor's total giving will be adjusted.

Steps:

1. Open the contact.
2. Go to the Manual Donations section.
3. Find the donation.
4. Open the donation actions menu.
5. Choose Delete.
6. Confirm the delete.

## Difference Between A Payment And A Manual Donation

A payment is tied to a pledge. It reduces the pledge balance and tracks how much of a promised amount has been fulfilled.

A manual donation is a standalone gift. It is not tied to any pledge. Use it when a donor gives a one-time gift that was not part of a formal pledge.

Use a payment when:

- A pledge already exists and the donor is paying toward it.
- You want to update the outstanding pledge balance.

Use a manual donation when:

- There is no pledge.
- The gift is a one-time or standalone donation.
- You are importing historical gifts that were not part of a pledge.

Both payments and manual donations count toward the donor's total giving and can be connected to campaigns, categories, and accounts.

## How To Upload Manual Donations From CSV

Page:

- Manual Donation Upload

Use this when:

- You have many manual donations in a spreadsheet.
- You want to import donations instead of entering them one by one.

Steps:

1. Open Manual Donation Upload.
2. Optional: click Download Template to get the expected format.
3. Upload a CSV file.
4. Review the row and column count.
5. Map CSV columns to donation fields.
6. Make sure required fields are mapped.
7. Preview the mapped rows.
8. Click Import Rows.
9. Review the result for created rows and failed rows.

Required fields:

- Amount.
- Received Date.
- Payment Method.
- At least one contact lookup field:
  - GHL Contact ID, or
  - Email.

Optional fields:

- Account Name.
- Category Name.
- Category Item Name.
- Campaign Name.
- Payment Status.
- Reference Number.
- Check Number.
- Notes.

Defaults handled by the upload:

- Currency is USD.
- Amount USD matches the amount.
- Exchange rate is 1.
- Payment date comes from received date.
- Payment status defaults to completed if not mapped.

Important upload tips:

- Each row must match an existing contact by GHL Contact ID or email.
- Account, category, category item, and campaign names are matched or created for the current location.
- A CSV column cannot be mapped to more than one donation field.
- If required mappings are missing, the import button will stay disabled.

## How To Handle Duplicate Rows In A CSV Upload

Before uploading:

1. Sort the spreadsheet by email, GHL Contact ID, amount, and received date.
2. Look for repeated rows.
3. Remove exact duplicate rows if they are accidental.
4. Keep repeated donations only if they are truly separate gifts.

During upload:

- If the app reports failed rows, review the row number and error.
- Fix the CSV and upload again.
- Do not re-upload successful rows unless you are sure duplicates will not be created.

After upload:

- Search a few imported contacts.
- Check their manual donations.
- Confirm totals look correct.

If duplicates were already imported:

- Use contact records and donation history to identify the duplicates.
- If duplicate contacts were created, use Merge Contacts.
- If duplicate donation entries were created, an admin may need to delete or correct the duplicate donation records.

## What Is A Payment Plan

A payment plan is a scheduled series of payments connected to a pledge. It breaks a pledge into smaller installment amounts that are expected on specific dates.

Use a payment plan when:

- A donor commits to paying in installments.
- You want to track expected payment dates.
- You need to monitor which installments have been paid and which are still outstanding.

## How To Create A Payment Plan

Page:

- Financial Module > open contact > Payment Plans

Steps:

1. Open the contact.
2. Go to the Payment Plans section.
3. Click the button to add or create a payment plan.
4. Select the linked pledge if required.
5. Enter the plan details such as total amount, currency, start date, frequency, and number of installments.
6. Choose the distribution type if available:
   - Fixed: all installments are equal amounts.
   - Custom: installment amounts can vary.
7. Save the payment plan.

After saving:

- The system generates the installment schedule.
- Each installment shows the expected date and amount.
- As payments are received, installments are marked as paid.

## How To View Payment Plan Installments

Page:

- Financial Module > open contact > Payment Plans

Steps:

1. Open the contact.
2. Go to Payment Plans.
3. Open the payment plan.
4. View the installment schedule showing each installment date, amount, and status.

Installment statuses:

- Pending: not yet paid.
- Paid: payment has been recorded.
- Overdue: past the expected date and not yet paid.
- Cancelled: installment was cancelled.

## How To Use The Dashboard

Page:

- Dashboard Home

Use it for:

- Total contacts.
- Total pledged.
- Total actual payments.
- Active plans.
- Pledge/payment trends.
- Payment method breakdown.
- Pledge status.
- Top donors.
- Recent activity.
- Contact analytics.
- Campaign performance.

Steps:

1. Open Dashboard Home.
2. Choose a date range if needed.
3. Switch between tabs: Overview, Pledges, Payments, Contacts, Campaigns.
4. Use CSV or PDF export if available.

If dashboard totals look wrong:

- Check the date filter.
- Confirm payments are marked completed.
- Confirm the contact/campaign belongs to your location.
- Check whether the amount is in USD or original currency.

## Reports Overview

Page:

- Reports

Available report areas:

- Donor Contribution Reports.
- Campaign & Fundraising Reports.
- Financial & Accounting Reports.
- LYBUNT & SYBUNT Reports.
- Outstanding Pledges Reports.
- Upcoming Expected Payments Reports.
- Contacts Donations Report.
- Category-wise Payments Report.
- Quickbook Report.

Most reports:

- Show a preview table.
- Support pagination.
- Can be downloaded as CSV.
- Some can also be downloaded as PDF.
- Are filtered to the admin's location.

## Donor Contribution Reports

Page:

- Reports > Donor Contribution Reports

Use this report to:

- See donors grouped by giving level.
- Find donors above a selected total contribution amount.
- Review donor engagement for a date range.

Available filters:

- All Amounts.
- $500 and Above.
- $1,000 and Above.
- $5,000 and Above.
- $10,000 and Above.
- Date range.

Steps:

1. Open Reports.
2. Click Donor Contribution Reports.
3. Choose the giving level filter.
4. Select a date range if needed.
5. Review the preview table.
6. Download CSV if needed.

## Campaign & Fundraising Reports

Page:

- Reports > Campaign & Fundraising Reports

Use this report to:

- Review fundraising by campaign/event.
- Filter results to one or more campaigns.
- Export event-specific fundraising data.

Steps:

1. Open Reports.
2. Click Campaign & Fundraising Reports.
3. Select campaigns if you want to filter.
4. Review the preview table.
5. Download CSV or PDF.

If no campaign is selected:

- The report may show all campaign fundraising data for the location.

## Financial & Accounting Reports

Page:

- Reports > Financial & Accounting Reports

Use this report to:

- Review event-based year-end giving.
- Filter by campaign.
- Filter by year.
- Export accounting-friendly data.

Steps:

1. Open Reports.
2. Click Financial & Accounting Reports.
3. Select one or more campaigns if needed.
4. Enter a year if needed.
5. Review the preview table.
6. Download CSV or PDF.

## LYBUNT And SYBUNT Reports

Page:

- Reports > LYBUNT & SYBUNT Reports

Definitions:

- LYBUNT means "Last Year But Unfortunately Not This Year."
- SYBUNT means "Some Year But Unfortunately Not This Year."

Use this report to:

- Find donors who gave last year but not this year.
- Find donors who gave in a previous year but not this year.
- Prepare donor follow-up lists.

Steps:

1. Open Reports.
2. Click LYBUNT & SYBUNT Reports.
3. Switch between the LYBUNT and SYBUNT tabs.
4. Review the donor list.
5. Download CSV or PDF.

## Outstanding Pledges Report

Page:

- Reports > Outstanding Pledges Reports

Use this report to:

- See pledges that still have a balance.
- Review amount pledged, amount paid, and amount remaining.
- Follow up on unpaid or partially paid pledges.

Steps:

1. Open Reports.
2. Click Outstanding Pledges Reports.
3. Review the preview table.
4. Download CSV if needed.

If no data appears:

- There may be no pledges with outstanding balances for your location.

## Upcoming Expected Payments Report

Page:

- Reports > Upcoming Expected Payments Reports

Use this report to:

- View expected upcoming payments.
- Review pledges with outstanding balances where previous payments were made by card.
- Plan payment follow-up.

Steps:

1. Open Reports.
2. Click Upcoming Expected Payments Reports.
3. Review the preview table.
4. Download CSV or PDF.

## Contacts Donations Report

Page:

- Reports > Contacts Donations Report

Use this report to:

- View contacts with addresses.
- See total donations.
- See most recent donation date and amount.

Filters:

- Search.
- Date range.
- Giving level:
  - All Amounts.
  - $500 and Above.
  - $1,000 and Above.
  - $5,000 and Above.
  - $10,000 and Above.
- Sort options.

Steps:

1. Open Reports.
2. Click Contacts Donations Report.
3. Search or choose filters if needed.
4. Review the table.
5. Download CSV or PDF if available.

## Category-wise Payments Report

Page:

- Reports > Category-wise Payments Report

Use this report to:

- View received payments grouped or filtered by category.
- Review category-specific giving.

Steps:

1. Open Reports.
2. Click Category-wise Payments Report.
3. Choose a category or leave it as all.
4. Review the preview table.
5. Download CSV if needed.

## Quickbook Report

Page:

- Reports > Quickbook Report

Use this report to:

- Export transaction data for accounting.
- Review GHL Contact ID, email, display name, first/last name, campaign, received date, amount, method, and category.

Filters:

- Date range.
- Contact names.
- Campaigns.

Steps:

1. Open Reports.
2. Click Quickbook Report.
3. Choose a date range if needed.
4. Select contact names if needed.
5. Select campaigns if needed.
6. Click Filter.
7. Review the preview table.
8. Download CSV or PDF.

To clear filters:

- Click Clear.

## How To Manage Categories

Page:

- Manage Categories

Use categories to classify donations and pledges.

Common actions:

- Create category.
- Edit category.
- Delete category.
- Manage category items.

Tips:

- Use consistent category names so reports stay clean.
- If an import creates a category name you did not expect, check the CSV spelling.

## What Is A Category And Category Item

A category is a broad classification used to group donations and pledges.

Examples of categories: General Fund, Building Fund, Education.

A category item is a specific sub-type within a category.

Example: if the category is Education, a category item could be Scholarship or Tuition Assistance.

When recording a payment or manual donation, you can choose a category and optionally a category item to make reporting more specific.

If you do not need sub-types, you can use categories alone without category items.

## How To Manage Tags

Page:

- Manage Tags

Use tags to label contacts, pledges, or payments for easier searching and filtering.

Steps:

1. Open Manage Tags.
2. Create or edit a tag.
3. Mark whether the tag should be available for payments or pledges if those options appear.
4. Use tags on contact, pledge, or payment records.

## How To Add Or Remove A Tag On A Contact

Page:

- Financial Module > open contact

Steps:

1. Open the contact record.
2. Find the Tags section on the contact.
3. Click to add a tag and choose from the available tags.
4. To remove a tag, click the tag or the remove option next to it.

Notes:

- Tags must exist in Manage Tags before they can be added to a contact.
- If a tag is not available, ask an admin to create it in Manage Tags first.

## How To Manage Payment Methods

Page:

- Payment Methods

Use this section to configure payment method options and method details.

Examples:

- Cash.
- Check.
- Credit card.
- ACH.
- Bill pay.

Tips:

- Keep payment method names consistent.
- Use method details for extra breakdowns when needed.

## How To Manage Accounts

Page:

- Accounts

Use accounts to assign donations or payments to the correct accounting account.

Tips:

- Choose the correct account when recording payments or manual donations.
- Imports can match or create account names for the current location.

## How To Manage Solicitors

Page:

- Solicitors

Use this section for people responsible for fundraising or donor follow-up.

Common tasks:

- Add solicitors.
- Assign solicitors to payments/donations.
- Review solicitor-related payment activity.
- Manage bonus calculations if used by the organization.

## How To Manage Users

Page:

- Manage Users

Access:

- Admins can manage users within their location.

## How To Create A User

Steps:

1. Open Manage Users.
2. Click the button to add or invite a new user.
3. Enter the user's name and email.
4. Assign a role:
   - Admin: can manage location data.
   - User/Contact: limited view access.
5. Save or send the invitation.

## How To Change A User's Role

Steps:

1. Open Manage Users.
2. Find the user.
3. Open the user actions or edit option.
4. Change the role.
5. Save.

Notes:

- Changing a role takes effect immediately.
- Downgrading a user from admin means they will lose access to admin features right away.

## How To Deactivate Or Delete A User

Steps:

1. Open Manage Users.
2. Find the user.
3. Open the user actions menu.
4. Choose Deactivate or Delete depending on the options available.
5. Confirm the action.

Warning:

- Deactivating a user prevents login but keeps their record.
- Deleting a user may be permanent.

## Login Issues And Account Access

If you cannot log in, are locked out, or need your account set up, contact Brandy at brandy@givesuite.com for help.

## How To Update Your Password Or Profile

If you are logged in and want to update your password or profile information:

1. Click your profile or account icon in the top right corner of the app.
2. Open Profile or Account Settings.
3. Update your name, email, or password as needed.
4. Save the changes.

If you are locked out and cannot access the profile page, contact Brandy at brandy@givesuite.com.

## How To Use Audit Logs

Page:

- Audit Log or Log Reports

Use audit logs to answer:

- Who created a pledge?
- Who updated a payment?
- Who changed a donation?
- What admin action happened recently?

Steps:

1. Open Audit Log or Log Reports.
2. Search/filter if available.
3. Review the action, user, date, and affected record.
4. Export logs if needed.

## Why A User Cannot See Data

Common reasons:

- The user is not logged in.
- The user does not have admin access.
- The record belongs to a different location.
- A date filter is hiding the data.
- A report filter is too narrow.
- The payment status is not completed.
- The contact was merged into another contact.
- The campaign was merged into another campaign.

Suggested answer:

Check your role, location, filters, and date range first. If the record may have been merged, search for the target contact or target campaign.

## Why Report Totals May Look Different

Common reasons:

- One report includes only completed payments.
- Another report includes pledges, not actual payments.
- A date filter is applied.
- A campaign/category filter is applied.
- Manual donations and pledge payments may be counted differently depending on the report.
- Amounts may be shown in USD after conversion.
- The user is viewing only their location's data.

Suggested answer:

First confirm whether the report is based on pledges, payments, manual donations, or all donations. Then check date range, status, location, campaign, category, and currency.

## Receipts

To send a receipt, open the payment record in the payments table. You will see a Send Receipt button. Click it and a custom receipt will be sent to that donor.

## Public Payment Forms

Some donation/payment forms may be embedded outside the app, such as in a website or GHL funnel.

If a public form is not working:

1. Confirm the page URL is correct.
2. Confirm the payment provider is configured.
3. Confirm webhooks are active.
4. Check whether the form is using the current domain.
5. Ask an admin/developer to check integration settings.

## Common Chatbot Questions And Answers

Question: How do I create a campaign?

Answer: Go to Manage Campaigns, click New Campaign, enter the campaign name, optional description, choose active/inactive/completed, then save.

Question: How do I merge duplicate contacts?

Answer: Go to Merge Contacts, search for the duplicate contacts, select at least two, choose the target contact to keep, confirm the final name/email/GHL Contact ID, review the financial totals, then confirm the merge. This cannot be undone.

Question: How do I handle duplicate donations from an upload?

Answer: First check whether the duplicate is a duplicate row or a real repeated gift. If it is accidental, avoid re-uploading successful rows. If duplicates were already imported, review the contact's manual donations and have an admin delete or correct the duplicate entries.

Question: Why can't I see a campaign?

Answer: Campaigns are usually limited to your location. Check that you are logged in as the correct admin, clear search filters, and confirm the campaign was not merged or deleted.

Question: Which report should I use for donor totals?

Answer: Use Donor Contribution Reports for giving level lists. Use Contacts Donations Report if you need contact details, addresses, total donations, and most recent donation information.

Question: Which report should I use for accounting export?

Answer: Use Quickbook Report for transaction-style accounting export. It includes contact, campaign, received date, amount, method, and category details.

Question: Which report shows unpaid pledges?

Answer: Use Outstanding Pledges Reports. It shows pledges with remaining balances.

Question: What is LYBUNT?

Answer: LYBUNT means donors who gave last year but not this year.

Question: What is SYBUNT?

Answer: SYBUNT means donors who gave in some previous year but not this year.

Question: How do I import manual donations?

Answer: Go to Manual Donation Upload, upload a CSV, map amount, received date, payment method, and either GHL Contact ID or email, preview the data, then click Import Rows.

Question: Why is the import button disabled?

Answer: Required fields may not be mapped. Map amount, received date, payment method, and either GHL Contact ID or email. Also make sure no CSV column is mapped more than once.

Question: How do I merge campaigns?

Answer: Go to Manage Campaigns, click Merge Campaigns, select the source campaigns, choose the selected campaign that should remain as the target, review the summary, then merge. This is irreversible and source campaigns are deleted.

Question: Why do dashboard totals not match a report?

Answer: Check date range, payment status, report type, campaign/category filters, location, and whether the report uses pledges, payments, manual donations, or all donations.

Question: Where do I find all transactions for QuickBooks?

Answer: Go to Reports, open Quickbook Report, set date/contact/campaign filters if needed, click Filter, then download CSV or PDF.

Question: How do I find who changed a record?

Answer: Open Audit Log or Log Reports and look for the related contact, pledge, payment, donation, or admin action.

Question: What is the difference between a payment and a manual donation?

Answer: A payment is tied to a pledge and reduces the pledge balance. A manual donation is a standalone gift with no pledge attached. Use a payment when you are collecting on a promise. Use a manual donation when there is no pledge.

Question: What is a payment plan?

Answer: A payment plan breaks a pledge into scheduled installments. Each installment has an expected date and amount. As payments come in, installments are marked paid. You can find and create payment plans inside the contact record under Payment Plans.

Question: What is a payment plan vs a pledge?

Answer: A pledge is the donor's promise to give a total amount. A payment plan is the schedule of how that pledge will be paid in smaller installments over time. A pledge can exist without a payment plan, but a payment plan is always linked to a pledge.

Question: How do I correct a payment amount?

Answer: Open the contact, go to the Payments section, find the payment, click Edit, update the amount, then save. If the payment is linked to a pledge, the pledge balance will update automatically.

Question: How do I change a user's role?

Answer: Open Manage Users, find the user, click Edit or the actions menu, change the role, then save. Role changes take effect immediately.

Question: How do I add a tag to a contact?

Answer: Open the contact record, find the Tags section, click to add a tag, and choose from the available tags. If the tag does not appear, an admin needs to create it first in Manage Tags.

Question: Can I undo a merge?

Answer: No. Contact merges and campaign merges are permanent and cannot be undone. Always review the selected records and the target carefully before confirming a merge.

Question: What is a location?

Answer: A location is your organization's account or branch. All your data including contacts, campaigns, pledges, payments, and reports are tied to your location. If a record is missing, check that it belongs to your current location.

Question: What is a GHL Contact ID?

Answer: GHL Contact ID is the unique identifier from GoHighLevel used to match contacts during imports and syncs. It is the most reliable way to link incoming payment data to the correct contact record.

Question: What is a display name?

Answer: Display name is the preferred or formatted name shown for a contact in reports and receipts. Use it for couples, households, or organizations where the display name should represent more than one person. Example: "John and Jane Smith" instead of just "John Smith".

Question: What is a category item?

Answer: A category item is a sub-type within a category. For example, if the category is Education, a category item could be Scholarship. When recording a donation, you can choose a category and optionally a category item for more specific reporting.

Question: I cannot log in, what do I do?

Answer: Contact Brandy at brandy@givesuite.com for help with login access.

Question: How do I update my password?

Answer: Click your profile or account icon in the top right corner, open Profile or Account Settings, update your password, then save.

Question: Why did a contact or donation appear that nobody created manually?

Answer: It was likely created automatically through a GHL workflow inside Givesuite. When a donor submits a form or completes a payment through a GHL workflow, the system automatically creates or matches the contact and records the donation. If the record looks incorrect, you can edit it or merge duplicate contacts if needed.

## Safety Rules For Chatbot Answers

Always warn before these actions:

- Merge contacts.
- Merge campaigns.
- Delete campaigns.
- Delete contacts.
- Delete pledges.
- Delete payments or donations.
- Delete manual donations.
- Deactivate or delete users.
- Upload a large CSV.

Use this wording:

This action may be permanent. Review the selected records carefully before confirming.

When the user asks for financial totals:

- Mention that totals may depend on date range, payment status, campaign/category filters, location, and whether manual donations are included.

When the user asks why something is missing:

- Ask them to check role, location, search terms, filters, date range, and whether a merge happened.

