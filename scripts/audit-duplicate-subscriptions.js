// Read-only audit — finds users with more than one subscriptions row, and
// checks each row's stripe_subscription_id against Stripe's actual current
// status (the source of truth), since our local `status` column only
// updates when a webhook fires.
//
// Makes NO writes to the database or to Stripe. Safe to run any time.
//
// Run with: node scripts/audit-duplicate-subscriptions.js

require('dotenv').config();
const Stripe = require('stripe');
const pool = require('../db/pool');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

async function main() {
  const result = await pool.query(`
    SELECT u.id AS user_id, u.parent_email, s.id AS sub_row_id,
           s.stripe_subscription_id, s.status AS local_status,
           s.created_at, s.updated_at
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE u.id IN (
      SELECT user_id FROM subscriptions GROUP BY user_id HAVING COUNT(*) > 1
    )
    ORDER BY u.id, s.created_at
  `);

  if (result.rows.length === 0) {
    console.log('No users with more than one subscriptions row. Nothing to audit.');
    await pool.end();
    return;
  }

  const byUser = new Map();
  for (const row of result.rows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push(row);
  }

  console.log(`Found ${byUser.size} user(s) with multiple subscription rows:\n`);

  for (const [userId, rows] of byUser) {
    console.log(`User ${userId} (${rows[0].parent_email}) — ${rows.length} rows:`);

    for (const row of rows) {
      let stripeStatus = 'ERROR fetching';
      if (row.stripe_subscription_id) {
        try {
          const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
          stripeStatus = sub.status;
        } catch (err) {
          stripeStatus = `ERROR (${err.message})`;
        }
      } else {
        stripeStatus = 'n/a (no stripe_subscription_id on this row)';
      }

      const mismatch = stripeStatus !== row.local_status ? '  <-- MISMATCH vs local DB' : '';
      console.log(
        `  row ${row.sub_row_id}  stripe_id=${row.stripe_subscription_id || 'none'}  ` +
          `local_status=${row.local_status}  stripe_status=${stripeStatus}  ` +
          `created=${row.created_at.toISOString()}${mismatch}`
      );
    }
    console.log('');
  }

  console.log('This script made no changes. Review the list above before deciding what to clean up.');
  await pool.end();
}

main().catch((err) => {
  console.error('Audit crashed:', err);
  process.exit(1);
});
