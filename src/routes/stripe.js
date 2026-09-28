const express = require('express');
const Stripe = require('stripe');
const pool = require('../../db/pool');
const { requireAuth } = require('../middleware/auth');
const { isHouseholdMember } = require('../services/household');
const { sendReferralRewardEmail } = require('../services/email');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

const REFERRAL_REWARD_CENTS = 799; // $7.99 -- one child-month, flat, regardless of the referrer's plan/quantity
const REFERRAL_REWARD_CAP_PER_YEAR = 6;

// POST /api/stripe/create-checkout-session
// Protected. Body: { plan } where plan is 'monthly' (default) or 'annual'.
// Creates (or reuses) a Stripe customer for the logged-in parent, then
// returns a Checkout URL for the chosen plan, billed for however many
// active children they currently have (minimum 1).
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  try {
    if (await isHouseholdMember(req.userId)) {
      return res.status(403).json({ error: 'Only the household owner can manage billing.' });
    }

    const plan = req.body.plan === 'annual' ? 'annual' : 'monthly';
    const priceId = plan === 'annual' ? process.env.STRIPE_PRICE_ID_ANNUAL : process.env.STRIPE_PRICE_ID;

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.parent_email });
      customerId = customer.id;
      await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, user.id]);
    }

    const childCountResult = await pool.query(
      'SELECT COUNT(*)::int AS count FROM children WHERE user_id = $1 AND active = true',
      [user.id]
    );
    const quantity = Math.max(childCountResult.rows[0].count, 1);

    // Beta testers hand-picked via scripts/grant-beta-free-month.js get a
    // 30-day trial instead of the standard 7 -- effectively "1 month free"
    // before their card is ever actually charged. The grant is consumed
    // (cleared) here, at session creation, not on successful payment --
    // simplest semantics for a small, hand-onboarded list; if someone
    // abandons checkout, re-run the grant script for just that person.
    const trialDays = user.beta_free_month_eligible ? 30 : 7;
    if (user.beta_free_month_eligible) {
      await pool.query('UPDATE users SET beta_free_month_eligible = false WHERE id = $1', [user.id]);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity }], // $7.99/mo or $75.99/yr per active child
      subscription_data: { trial_period_days: trialDays },
      success_url: `${process.env.APP_URL}/dashboard.html?checkout=success`,
      cancel_url: `${process.env.APP_URL}/dashboard.html?checkout=cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Create checkout session error', err);
    res.status(500).json({ error: 'Could not start checkout.' });
  }
});

// GET /api/stripe/status
// Protected. Tells the dashboard whether to show "Start subscription" or
// "Manage billing" -- and, for a complimentary (free-for-life) account,
// neither. hasBilling reflects whether the CURRENT active/trialing
// subscription row is backed by a real Stripe subscription (as opposed to
// a free-for-life grant, stripe_subscription_id = NULL) -- not whether
// users.stripe_customer_id happens to be set, since that can persist from
// a since-canceled real subscription (e.g. an account converted to
// free-for-life via scripts/convert-to-free-for-life.js).
router.get('/status', requireAuth, async (req, res) => {
  try {
    if (await isHouseholdMember(req.userId)) {
      return res.status(403).json({ error: 'Only the account owner has billing status.' });
    }

    const subResult = await pool.query(
      `SELECT stripe_subscription_id FROM subscriptions
       WHERE user_id = $1 AND status IN ('active', 'trialing')
       ORDER BY created_at DESC LIMIT 1`,
      [req.userId]
    );
    const sub = subResult.rows[0];

    res.json({
      hasSubscription: !!sub,
      hasBilling: !!(sub && sub.stripe_subscription_id),
    });
  } catch (err) {
    console.error('Subscription status error', err);
    res.status(500).json({ error: 'Could not load subscription status.' });
  }
});

// POST /api/stripe/create-portal-session
// Protected. Sends the parent to Stripe's hosted portal to update card /
// cancel — avoids building that UI yourself.
router.post('/create-portal-session', requireAuth, async (req, res) => {
  try {
    if (await isHouseholdMember(req.userId)) {
      return res.status(403).json({ error: 'Only the household owner can manage billing.' });
    }

    const userResult = await pool.query('SELECT stripe_customer_id FROM users WHERE id = $1', [req.userId]);
    const customerId = userResult.rows[0]?.stripe_customer_id;
    if (!customerId) return res.status(400).json({ error: 'No billing account on file yet.' });

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.APP_URL}/dashboard.html`,
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    console.error('Create portal session error', err);
    res.status(500).json({ error: 'Could not open billing portal.' });
  }
});

// POST /api/stripe/webhook
// Public, but signature-verified. Stripe calls this on every subscription
// event. NOTE: this route needs the raw request body — see server.js, where
// it's mounted BEFORE the express.json() body parser.
async function handleWebhook(req, res) {
  const signature = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await upsertSubscriptionForCustomer(session.customer, session.subscription);
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const previousStatus = event.data.previous_attributes?.status;
        await upsertSubscriptionRecord(sub);
        // Every checkout starts with a 7-day trial (see create-checkout-session
        // above), so trialing -> active is the reliable signal that this
        // subscriber's first real payment just succeeded -- as opposed to
        // status merely being 'active' on its own, which trial subscriptions
        // never are until that happens.
        if (previousStatus === 'trialing' && sub.status === 'active') {
          await applyReferralRewardIfEligible(sub.customer);
        }
        break;
      }
      case 'customer.subscription.created': {
        const sub = event.data.object;
        await upsertSubscriptionRecord(sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await pool.query(
          `UPDATE subscriptions SET status = 'canceled', updated_at = now() WHERE stripe_subscription_id = $1`,
          [sub.id]
        );
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await pool.query(
          `UPDATE subscriptions SET status = 'past_due', updated_at = now() WHERE stripe_subscription_id = $1`,
          [invoice.subscription]
        );
        break;
      }
      default:
        // Unhandled event types are fine to ignore.
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handling error', err);
    res.status(500).send('Webhook handler failed.');
  }
}

async function upsertSubscriptionForCustomer(stripeCustomerId, stripeSubscriptionId) {
  const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  await upsertSubscriptionRecord(sub);
}

async function upsertSubscriptionRecord(sub) {
  const userResult = await pool.query('SELECT id FROM users WHERE stripe_customer_id = $1', [sub.customer]);
  const user = userResult.rows[0];
  if (!user) {
    console.error('No local user found for Stripe customer', sub.customer);
    return;
  }

  const periodEnd = new Date(sub.current_period_end * 1000);

  await pool.query(
    `INSERT INTO subscriptions (user_id, stripe_subscription_id, status, current_period_end)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (stripe_subscription_id)
     DO UPDATE SET status = $3, current_period_end = $4, updated_at = now()`,
    [user.id, sub.id, sub.status, periodEnd]
  );
}

// Applies the referral reward for a referred account's first paid
// conversion, if one is owed. Safe to call more than once for the same
// event (Stripe may redeliver webhooks): the atomic claim below means only
// one call can ever move a referral out of 'signed_up', so a duplicate
// delivery arriving after the first has finished is a no-op.
async function applyReferralRewardIfEligible(stripeCustomerId) {
  const userResult = await pool.query('SELECT id FROM users WHERE stripe_customer_id = $1', [stripeCustomerId]);
  const referredUser = userResult.rows[0];
  if (!referredUser) return;

  const referralResult = await pool.query(
    `SELECT id, referrer_user_id FROM referrals WHERE referred_user_id = $1 AND status = 'signed_up' LIMIT 1`,
    [referredUser.id]
  );
  const referral = referralResult.rows[0];
  if (!referral) return; // not a referred signup, or already handled

  const claim = await pool.query(
    `UPDATE referrals SET status = 'processing' WHERE id = $1 AND status = 'signed_up' RETURNING id`,
    [referral.id]
  );
  if (claim.rows.length === 0) return; // another delivery of this event already claimed it

  try {
    const rewardCountResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM referrals
       WHERE referrer_user_id = $1 AND status = 'rewarded' AND reward_applied_at > now() - interval '365 days'`,
      [referral.referrer_user_id]
    );
    if (rewardCountResult.rows[0].count >= REFERRAL_REWARD_CAP_PER_YEAR) {
      await pool.query(`UPDATE referrals SET status = 'capped' WHERE id = $1`, [referral.id]);
      return;
    }

    const referrerResult = await pool.query(
      'SELECT parent_email, stripe_customer_id FROM users WHERE id = $1',
      [referral.referrer_user_id]
    );
    const referrer = referrerResult.rows[0];
    if (!referrer) {
      await pool.query(`UPDATE referrals SET status = 'signed_up' WHERE id = $1`, [referral.id]);
      return;
    }

    let referrerCustomerId = referrer.stripe_customer_id;
    if (!referrerCustomerId) {
      const customer = await stripe.customers.create({ email: referrer.parent_email });
      referrerCustomerId = customer.id;
      await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [
        referrerCustomerId,
        referral.referrer_user_id,
      ]);
    }

    await stripe.customers.createBalanceTransaction(referrerCustomerId, {
      amount: -REFERRAL_REWARD_CENTS,
      currency: 'usd',
      description: 'Referral reward — free month credit',
    });

    await pool.query(`UPDATE referrals SET status = 'rewarded', reward_applied_at = now() WHERE id = $1`, [
      referral.id,
    ]);

    try {
      await sendReferralRewardEmail(referrer.parent_email);
    } catch (emailErr) {
      console.error('Referral reward email error', emailErr);
    }
  } catch (err) {
    console.error('Referral reward processing error', err);
    // Revert the claim so a future webhook retry can pick this back up.
    await pool.query(`UPDATE referrals SET status = 'signed_up' WHERE id = $1`, [referral.id]).catch(() => {});
  }
}

module.exports = { router, handleWebhook };
