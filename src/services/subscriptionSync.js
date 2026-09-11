const Stripe = require('stripe');
const pool = require('../../db/pool');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Pricing is per active child. Call this after adding, removing, or toggling
 * a child's active/paused state so the subscriber's Stripe subscription
 * quantity (and therefore their bill) stays in sync with how many children
 * are actually active. A no-op if the account has no active/trialing
 * subscription yet -- checkout sets the correct quantity at signup time.
 * Stripe requires quantity >= 1 on a subscription item, so when zero
 * children are left active, this cancels the subscription outright instead.
 */
async function syncSubscriptionQuantity(userId) {
  const subResult = await pool.query(
    `SELECT stripe_subscription_id FROM subscriptions
     WHERE user_id = $1 AND status IN ('active', 'trialing')
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  const subscriptionId = subResult.rows[0]?.stripe_subscription_id;
  if (!subscriptionId) return;

  const countResult = await pool.query(
    'SELECT COUNT(*)::int AS count FROM children WHERE user_id = $1 AND active = true',
    [userId]
  );
  const quantity = countResult.rows[0].count;

  if (quantity === 0) {
    await stripe.subscriptions.cancel(subscriptionId);
    await pool.query(
      `UPDATE subscriptions SET status = 'canceled', updated_at = now() WHERE stripe_subscription_id = $1`,
      [subscriptionId]
    );
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const item = subscription.items.data[0];

  if (item.quantity !== quantity) {
    await stripe.subscriptionItems.update(item.id, {
      quantity,
      proration_behavior: 'create_prorations',
    });
  }
}

module.exports = { syncSubscriptionQuantity };
