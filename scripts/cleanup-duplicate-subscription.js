// One-off cleanup for the duplicate subscription rows found on user 5
// (jstewart001.js+startest2@gmail.com) on 2026-09-27: two Stripe
// subscriptions were both live at once because a second checkout was run
// without cancelling the first. subscriptionSync.js already treats the
// most-recently-created active/trialing row as canonical, so the OLDER one
// (sub_1UBEEAGAGfUguPndWlB9NQic) is the orphaned one to cancel; the newer
// one (sub_1UCQ0IGAGfUguPnduHeqzCpO) stays, with its local status synced to
// Stripe's real current value (it was stuck on stale 'trialing').
//
// Safe to re-run: checks Stripe's current status before cancelling, and
// only cancels if it isn't already canceled.
//
// Run with: node scripts/cleanup-duplicate-subscription.js
// Run with DRY_RUN=1 to see what would happen without changing anything.

require('dotenv').config();
const Stripe = require('stripe');
const pool = require('../db/pool');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const DRY_RUN = process.env.DRY_RUN === '1';

const CANCEL_SUBSCRIPTION_ID = 'sub_1UBEEAGAGfUguPndWlB9NQic'; // row 1 — orphaned
const KEEP_SUBSCRIPTION_ID = 'sub_1UCQ0IGAGfUguPnduHeqzCpO'; // row 3 — canonical

async function main() {
  // --- Step 1: cancel the orphaned subscription in Stripe (if not already) ---
  const toCancel = await stripe.subscriptions.retrieve(CANCEL_SUBSCRIPTION_ID);
  console.log(`${CANCEL_SUBSCRIPTION_ID} — current Stripe status: ${toCancel.status}`);

  if (toCancel.status === 'canceled') {
    console.log('  Already canceled in Stripe, skipping cancellation.');
  } else if (DRY_RUN) {
    console.log('  DRY RUN — would cancel this subscription in Stripe.');
  } else {
    await stripe.subscriptions.cancel(CANCEL_SUBSCRIPTION_ID);
    console.log('  Canceled in Stripe.');
  }

  // --- Step 2: sync the local DB row for the canceled subscription ---
  if (DRY_RUN) {
    console.log(`  DRY RUN — would set local status = 'canceled' for ${CANCEL_SUBSCRIPTION_ID}`);
  } else {
    await pool.query(
      `UPDATE subscriptions SET status = 'canceled', updated_at = now() WHERE stripe_subscription_id = $1`,
      [CANCEL_SUBSCRIPTION_ID]
    );
    console.log(`  Local DB row updated to status = 'canceled'.`);
  }

  // --- Step 3: sync the local DB row for the surviving subscription to match Stripe's real status ---
  const toKeep = await stripe.subscriptions.retrieve(KEEP_SUBSCRIPTION_ID);
  console.log(`\n${KEEP_SUBSCRIPTION_ID} — current Stripe status: ${toKeep.status}`);

  if (DRY_RUN) {
    console.log(`  DRY RUN — would set local status = '${toKeep.status}' for ${KEEP_SUBSCRIPTION_ID}`);
  } else {
    await pool.query(
      `UPDATE subscriptions SET status = $1, updated_at = now() WHERE stripe_subscription_id = $2`,
      [toKeep.status, KEEP_SUBSCRIPTION_ID]
    );
    console.log(`  Local DB row updated to status = '${toKeep.status}'.`);
  }

  console.log('\nDone.');
  await pool.end();
}

main().catch((err) => {
  console.error('Cleanup crashed:', err);
  process.exit(1);
});
