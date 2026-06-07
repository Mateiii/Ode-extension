/**
 * Local Stripe webhook server — receives events forwarded by the Stripe CLI
 * and upgrades the matching Supabase user to premium.
 *
 * Usage (two terminals):
 *   npm run stripe:server          # starts this server on port 4242
 *   npm run stripe:listen          # forwards Stripe events to it
 *
 * Required env vars (already loaded from .env via --env-file):
 *   STRIPE_SECRET_KEY              Stripe secret key  (sk_test_…)
 *   STRIPE_WEBHOOK_SECRET          From `stripe listen` output  (whsec_…)
 *   WXT_SUPABASE_URL               Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY      Service-role key — has admin write access
 *
 * How it works:
 *   1. User clicks "Upgrade" in the extension → new tab opens Stripe Payment
 *      Link with ?client_reference_id=<supabase-user-id>
 *   2. Stripe fires checkout.session.completed to this server.
 *   3. Server reads client_reference_id → updates user_metadata.is_premium
 *      via the Supabase Auth Admin API.
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import http from 'node:http';

// ── Environment ───────────────────────────────────────────────────────────────

const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  WXT_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const missing = [
  !STRIPE_SECRET_KEY         && 'STRIPE_SECRET_KEY',
  !STRIPE_WEBHOOK_SECRET     && 'STRIPE_WEBHOOK_SECRET',
  !WXT_SUPABASE_URL          && 'WXT_SUPABASE_URL',
  !SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
].filter(Boolean);

if (missing.length) {
  console.error(`\n✗ Missing required env vars: ${missing.join(', ')}`);
  console.error('  Add them to .env and restart.\n');
  process.exit(1);
}

// ── Clients ───────────────────────────────────────────────────────────────────

const stripe = new Stripe(STRIPE_SECRET_KEY);

// Service-role key bypasses Row Level Security and grants auth.admin access.
const supabase = createClient(WXT_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session) {
  const userId = session.client_reference_id;

  if (!userId) {
    console.warn('  ⚠ No client_reference_id on session — cannot identify user.');
    console.warn('    Make sure the extension passes ?client_reference_id=<userId>');
    return;
  }

  const email = session.customer_details?.email ?? session.customer_email ?? '(unknown)';
  console.log(`  → Granting premium to user ${userId} (${email})…`);

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { is_premium: true },
  });

  if (error) {
    console.error(`  ✗ Supabase update failed: ${error.message}`);
  } else {
    console.log(`  ✓ user_metadata.is_premium = true`);
  }
}

// Map of Stripe event types → handler functions.
// Add more events here if you need to handle subscription renewals, cancellations, etc.
const EVENT_HANDLERS = {
  'checkout.session.completed': handleCheckoutCompleted,
};

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // Only accept POST /webhook
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  // Buffer the raw body — Stripe requires it for signature verification.
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);
  const sig = req.headers['stripe-signature'];

  // Verify signature
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`⚠ Signature verification failed: ${err.message}`);
    res.writeHead(400);
    res.end(`Webhook Error: ${err.message}`);
    return;
  }

  console.log(`\n← ${event.type}`);

  const handler = EVENT_HANDLERS[event.type];
  if (handler) {
    try {
      await handler(event.data.object);
    } catch (err) {
      console.error(`  ✗ Handler threw: ${err.message}`);
      res.writeHead(500);
      res.end('Internal error');
      return;
    }
  } else {
    console.log('  (no handler registered — skipping)');
  }

  res.writeHead(200);
  res.end('ok');
});

const PORT = process.env.PORT ?? 4242;

server.listen(PORT, () => {
  console.log('\n┌─────────────────────────────────────────────────────┐');
  console.log(`│  Stripe webhook server  →  http://localhost:${PORT}/webhook  │`);
  console.log('└─────────────────────────────────────────────────────┘');
  console.log('\nForward test events with:');
  console.log('  stripe listen --forward-to localhost:4242/webhook\n');
});
