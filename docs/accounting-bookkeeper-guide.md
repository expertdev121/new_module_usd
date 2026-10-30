# DonorHQ Accounting: guide for the bookkeeper

DonorHQ turns the donations you record into bank deposits and sends each deposit to QuickBooks Online (or gives you a file to import). This guide covers the first release: **cash-basis, US dollars, gifts recorded in DonorHQ** (cash, check, ACH, bank transfer, other, and card or PayPal payouts, which you group by payout and enter the fee for yourself). DonorHQ does not read your Stripe or PayPal account yet.

Find it at **Settings > Accounting**.

## One-time setup (about 20 minutes)

1. **General tab.** Pick QuickBooks Online (or CSV file), keep Cash basis, and set the **Start date**. Only gifts dated on or after it are ever sent. You cannot create a deposit until a start date is set. Choose the account for anything unmapped, and whether to post as a Deposit (recommended) or a Journal Entry.
2. **QuickBooks tab.** Click Connect and sign in to QuickBooks as an admin. Then Refresh lists so DonorHQ sees your chart of accounts and classes.
3. **Chart of accounts tab.** Make sure the accounts you will use are active. (CSV users: import your chart here.)
4. **Funds tab.** Each campaign is a fund. Map each one to an income account (and a class, if you use classes).
5. **Payment sources tab.** Map each payment method (check, cash, ACH, card, PayPal...) to the bank or undeposited-funds account it lands in. For Card and PayPal, also pick a **Fee account** (an expense account such as Merchant Processing Fees).

## Every deposit

1. **Undeposited funds tab:** gifts waiting to be banked. Tick the gifts that went into one bank deposit (same source, same bank slip).
2. Create the deposit; set the date and bank reference. Check the total matches the bank slip.
3. **Close** the deposit when it is final. Closing locks in a snapshot of the gifts.
4. Send it:
   - **QuickBooks:** the deposit posts on the nightly sync (6:00 UTC) or press **Sync now** on the QuickBooks tab.
   - **File:** the **Export** tab creates a QuickBooks journal-entry CSV; export files can be downloaded again later.

**Card and PayPal payouts:** group the gifts that were in one payout. In the deposit, enter the **processing fee** from the processor's payout report and press Save fee. To close, type the **amount that reached your bank** (read it from your bank statement, it is never pre-filled). DonorHQ checks that gifts minus fee equals that amount and refuses to close if not. The entry then debits the bank for the net amount and your fee account for the fee, and QuickBooks gets one deposit with a negative fee line, so it matches the bank-feed transaction. Refunds and disputes are not handled yet: leave those gifts out and record them in QuickBooks.

You can reopen a deposit that has not been sent, or void it. Check the QuickBooks tab's sync log to see what posted and what failed.

## If something looks wrong

- **A gift changed after the deposit was closed.** DonorHQ shows a banner. If the deposit was not sent yet, it is blocked until you reopen and fix it. If it was already sent, it is flagged: correct it in QuickBooks yourself (DonorHQ will not change a posted entry).
- **A post failed.** The sync log shows the reason in plain words. Fix the cause (usually an inactive account or class), then retry that deposit.
- **"WAS posted... do not enter it again".** The entry reached QuickBooks but DonorHQ could not confirm it. Look in QuickBooks first; do not re-enter by hand.
- **Connection lost.** QuickBooks refused the sign-in. Press Reconnect; nothing is lost.
- **Failure emails.** In Settings > Accounting > General, type up to 3 email addresses under "Email me if the nightly sync fails", press Save, then Send test email. Open the test email (check spam) and press "Confirm you received this email". Only confirmed addresses get alerts: one email, at most once every 20 hours, if the nightly sync fails. Without it, check the sync log and the deposit banners.
- **Voiding a deposit that was already sent** does not remove it from QuickBooks yet. Delete or reverse it in QuickBooks.

## Not in this release

Automatic Stripe or PayPal payout import (fees are typed in for now), refunds and disputes, pledges and accrual basis, split gifts, non-USD gifts.
