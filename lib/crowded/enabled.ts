/**
 * Master ON/OFF switch for the entire Crowded integration.
 *
 * The team has PAUSED Crowded (not removed it). Nothing was deleted — every
 * piece of the integration (sidebar entry, admin pages, connect flow, public
 * donation forms, the payment-intent route and the webhook receiver) is
 * gated behind this single flag.
 *
 * To re-enable Crowded later:
 *   1. Flip this to `true`.
 *   2. Un-comment the "Crowded" item in components/dashboard/sidebar.tsx.
 * That's it — all the feature code is intact.
 */
export const CROWDED_ENABLED = false;
