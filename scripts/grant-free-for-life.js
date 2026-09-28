// Grants one or more accounts a permanent, complimentary subscription --
// no real Stripe object involved, so they can never be charged. Inserts a
// subscriptions row with stripe_subscription_id = NULL and status =
// 'active', which every delivery/eligibility query already treats as a
// normal active subscriber (see db/schema.sql for the convention).
//
// Run with: node scripts/grant-free-for-life.js parent1@example.com parent2@example.com
// Run with DRY_RUN=1 to see who would be granted, without writing anything.

require('dotenv').config();
const pool = require('../db/pool');

const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  const emails = process.argv.slice(2).map((e) => e.trim().toLowerCase());
  if (emails.length === 0) {
    console.error('Usage: node scripts/grant-free-for-life.js email1@example.com [email2@example.com ...]');
    process.exit(1);
  }

  for (const email of emails) {
    const userResult = await pool.query('SELECT id, parent_email FROM users WHERE parent_email = $1', [email]);
    const user = userResult.rows[0];
    if (!user) {
      console.log(`SKIP  ${email} — no account with this email.`);
      continue;
    }

    const existing = await pool.query(
      `SELECT id, stripe_subscription_id FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'trialing')`,
      [user.id]
    );
    if (existing.rows.length > 0) {
      const already = existing.rows[0];
      if (already.stripe_subscription_id === null) {
        console.log(`SKIP  ${email} — already has a free-for-life grant.`);
      } else {
        console.log(`SKIP  ${email} — already has a real active/trialing Stripe subscription (${already.stripe_subscription_id}). Cancel it first if you want to replace it with a free-for-life grant.`);
      }
      continue;
    }

    if (DRY_RUN) {
      console.log(`WOULD GRANT  ${email} — free for life`);
      continue;
    }

    await pool.query(
      `INSERT INTO subscriptions (user_id, stripe_subscription_id, status) VALUES ($1, NULL, 'active')`,
      [user.id]
    );
    console.log(`GRANTED  ${email} — free for life`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Grant crashed:', err);
  process.exit(1);
});
