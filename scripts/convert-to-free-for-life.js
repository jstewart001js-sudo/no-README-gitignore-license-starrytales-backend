// Converts an account with a real, paying Stripe subscription into a
// complimentary free-for-life account: cancels their current Stripe
// subscription (if not already canceled), marks that row canceled locally,
// then grants the free-for-life row (same convention as
// grant-free-for-life.js -- stripe_subscription_id = NULL, status =
// 'active', so they can never be charged again).
//
// Safe to re-run: checks Stripe's current status before cancelling, and
// won't grant a second free-for-life row if one already exists.
//
// Run with: node scripts/convert-to-free-for-life.js parent@example.com
// Run with DRY_RUN=1 to see what would happen without changing anything.

require('dotenv').config();
const Stripe = require('stripe');
const pool = require('../db/pool');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  const email = (process.argv[2] || '').trim();
  if (!email) {
    console.error('Usage: node scripts/convert-to-free-for-life.js parent@example.com');
    process.exit(1);
  }

  const userResult = await pool.query('SELECT id, parent_email FROM users WHERE LOWER(parent_email) = LOWER($1)', [
    email,
  ]);
  const user = userResult.rows[0];
  if (!user) {
    console.log(`No account found for ${email}.`);
    await pool.end();
    return;
  }

  const existing = await pool.query(
    `SELECT id, stripe_subscription_id FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'trialing')`,
    [user.id]
  );

  const freeForLifeAlready = existing.rows.find((row) => row.stripe_subscription_id === null);
  if (freeForLifeAlready) {
    console.log(`${user.parent_email} already has a free-for-life grant. Nothing to do.`);
    await pool.end();
    return;
  }

  const realSub = existing.rows.find((row) => row.stripe_subscription_id !== null);
  if (realSub) {
    const stripeSub = await stripe.subscriptions.retrieve(realSub.stripe_subscription_id);
    console.log(`${realSub.stripe_subscription_id} — current Stripe status: ${stripeSub.status}`);

    if (stripeSub.status === 'canceled') {
      console.log('  Already canceled in Stripe, skipping cancellation.');
    } else if (DRY_RUN) {
      console.log('  DRY RUN — would cancel this subscription in Stripe.');
    } else {
      await stripe.subscriptions.cancel(realSub.stripe_subscription_id);
      console.log('  Canceled in Stripe.');
    }

    if (DRY_RUN) {
      console.log(`  DRY RUN — would set local status = 'canceled' for ${realSub.stripe_subscription_id}`);
    } else {
      await pool.query(`UPDATE subscriptions SET status = 'canceled', updated_at = now() WHERE id = $1`, [
        realSub.id,
      ]);
      console.log(`  Local DB row updated to status = 'canceled'.`);
    }
  } else {
    console.log(`${user.parent_email} has no existing active/trialing subscription.`);
  }

  if (DRY_RUN) {
    console.log(`\nDRY RUN — would grant ${user.parent_email} free for life.`);
  } else {
    await pool.query(`INSERT INTO subscriptions (user_id, stripe_subscription_id, status) VALUES ($1, NULL, 'active')`, [
      user.id,
    ]);
    console.log(`\nGRANTED ${user.parent_email} — free for life.`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Conversion crashed:', err);
  process.exit(1);
});
