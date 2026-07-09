// The extension never loads the Stripe.js SDK or touches secret keys — it just
// opens the hosted Stripe Payment Link, embedding the Supabase user ID as
// `client_reference_id` so the webhook server can match the payment to the account.
// Required env var: WXT_STRIPE_PAYMENT_LINK (from Stripe dashboard → Payment Links).

const RAW_LINK = import.meta.env.WXT_STRIPE_PAYMENT_LINK as string | undefined;

export const IS_STRIPE_CONFIGURED =
  Boolean(RAW_LINK) &&
  !/^https:\/\/buy\.stripe\.com\/test_xxxx/.test(RAW_LINK ?? '') &&
  !/^https:\/\/buy\.stripe\.com\/live_xxxx/.test(RAW_LINK ?? '');

// Returns false if the link is not configured, so callers can show a fallback message.
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
