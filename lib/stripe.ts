/**
 * Extension-side Stripe helpers.
 *
 * The extension never loads the Stripe.js SDK or touches secret keys.
 * All it does is open the hosted Stripe Payment Link in a new tab, embedding
 * the Supabase user ID as `client_reference_id` so the webhook server can
 * match the payment back to the right account.
 *
 * Required env var (add to .env):
 *   WXT_STRIPE_PAYMENT_LINK=https://buy.stripe.com/live_xxxx   (real link)
 *   WXT_STRIPE_PAYMENT_LINK=https://buy.stripe.com/test_xxxx   (test link)
 */

const RAW_LINK = import.meta.env.WXT_STRIPE_PAYMENT_LINK as string | undefined;

// A link is considered configured when it's present and not the placeholder
// value we ship in .env. Baked at build time so AccountPanel can import it
// directly and conditionally render the upgrade button without needing a prop.
export const IS_STRIPE_CONFIGURED =
  Boolean(RAW_LINK) &&
  !/^https:\/\/buy\.stripe\.com\/test_xxxx/.test(RAW_LINK ?? '') &&
  !/^https:\/\/buy\.stripe\.com\/live_xxxx/.test(RAW_LINK ?? '');

/**
 * Opens the Stripe hosted checkout in a new tab.
 *
 * Returns `true` if a tab was opened, `false` if the link is not configured
 * (so callers can show a fallback message).
 *
 * @param userId  Supabase user ID — stored as `client_reference_id` so the
 *                webhook server can look the user up without a database query.
 * @param email   Pre-fills the email field in the Stripe checkout form.
 */
export function openStripeCheckout(userId: string, email?: string): boolean {
  if (!IS_STRIPE_CONFIGURED) {
    console.warn(
      '[Ode] Stripe checkout is not configured.\n' +
      '  1. Create a Payment Link in the Stripe dashboard (Products → Payment Links).\n' +
      '  2. Copy the URL into .env as WXT_STRIPE_PAYMENT_LINK.\n' +
      '  3. Rebuild the extension (npm run dev).',
    );
    return false;
  }

  const url = new URL(RAW_LINK!);
  url.searchParams.set('client_reference_id', userId);
  if (email) url.searchParams.set('prefilled_email', email);

  chrome.tabs.create({ url: url.toString() });
  return true;
}
