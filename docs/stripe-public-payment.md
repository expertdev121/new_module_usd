# Public Stripe Payment Flow

This repo now includes a public Stripe payment flow that supports both card and ACH payments with Stripe Payment Element.

## Public URLs

- Form: `/stripe-payment-form.html`
- Create PaymentIntent: `/create-payment-intent`
- Publishable key config: `/stripe-config`
- Stripe webhook: `/webhook`

## Required environment variables

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PUBLISHABLE_KEY`
- `GHL_WEBHOOK_URL`

## Local run

1. Add the environment variables above to `.env`.
2. Start the app with `npm run dev` or `pnpm dev`.
3. Open `http://localhost:3000/stripe-payment-form.html`.
4. Expose your local server publicly for Stripe webhooks with Stripe CLI or a tunnel.

## Stripe webhook setup

Point Stripe to:

- Local with Stripe CLI forwarding: `http://localhost:3000/webhook`
- Public deployment: `https://your-domain.com/webhook`

Listen for:

- `payment_intent.succeeded`
- `payment_intent.processing`
- `payment_intent.payment_failed`

## ACH testing notes

- ACH Direct Debit is a delayed-notification payment method.
- In live mode, ACH payments can stay in `processing` for several business days before settling.
- In test mode, use Stripe’s ACH test flows from the official docs for bank account verification and processing behavior.

## Location behavior

Successful payments create manual donations only for location:

- `NikJ6tAcHSe8UCLgYMqM`

The webhook also sends a POST payload to `GHL_WEBHOOK_URL` with:

- `name`
- `email`
- `amount`
- `payment_status`
- `payment_method`
- `stripe_payment_intent_id`
