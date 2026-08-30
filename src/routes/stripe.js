const express = require('express');
const Stripe = require('stripe');
const pool = require('../../db/pool');
const { requireAuth } = require('../middleware/auth');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

// POST /api/stripe/create-checkout-session
// Protected. Creates (or reuses) a Stripe customer for the logged-in parent,
// then returns a Checkout URL for the $7.99/month plan.
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.parent_email });
      customerId = customer.id;
      await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, user.id]);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }], // the $7.99/mo Price created in Stripe dashboard
      success_url: `${process.env.APP_URL}/dashboard.html?checkout=success`,
      cancel_url: `${process.env.APP_URL}/dashboard.html?checkout=cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Create checkout session error', err);
    res.status(500).json({ error: 'Could not start checkout.' });
  }
});

// POST /api/stripe/create-portal-session
// Protected. Sends the parent to Stripe's hosted portal to update card /
// cancel — avoids building that UI yourself.
router.post('/create-portal-session', requireAuth, async (req, res) => {
  try {
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
      case 'customer.subscription.updated':
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

module.exports = { router, handleWebhook };
