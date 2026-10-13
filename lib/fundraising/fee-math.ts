/**
 * "Donor covers the fees" gross-up for Stripe Checkout donations.
 *
 * Standard US Stripe card rate: 2.9% + $0.30. To make the campaign net
 * exactly `baseCents` after Stripe takes its cut, we solve for the gross
 * charge amount: gross = (base + fixedFeeCents) / (1 - percentFee).
 */
const STRIPE_PERCENT_FEE = 0.029;
const STRIPE_FIXED_FEE_CENTS = 30;

/** Returns the amount (in cents) to actually charge so the campaign nets `baseCents`. */
export function grossUpForFees(baseCents: number): number {
  const gross = (baseCents + STRIPE_FIXED_FEE_CENTS) / (1 - STRIPE_PERCENT_FEE);
  return Math.round(gross);
}
