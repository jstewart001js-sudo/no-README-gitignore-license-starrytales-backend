// Marks one or more accounts eligible for a 30-day trial (instead of the
// standard 7) the next time they run live checkout -- effectively "1 month
// free" once they enter a real card. See create-checkout-session in
// src/routes/stripe.js, which reads and consumes this flag.
//
// Run with: node scripts/grant-beta-free-month.js parent1@example.com parent2@example.com
// Run with DRY_RUN=1 to see who would be granted, without writing anything.

require('dotenv').config();
const pool = require('../db/pool');

const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  const emails = process.argv.slice(2).map((e) => e.trim());
  if (emails.length === 0) {
    console.error('Usage: node scripts/grant-beta-free-month.js email1@example.com [email2@example.com ...]');
    process.exit(1);
  }

  for (const email of emails) {
    // Case-insensitive match: signup stores parent_email exactly as typed
    // (no normalization), so a search that force-lowercases first can miss
    // a real account stored with different capitalization.
    const userResult = await pool.query(
      'SELECT id, parent_email, beta_free_month_eligible FROM users WHERE LOWER(parent_email) = LOWER($1)',
      [email]
    );
    const user = userResult.rows[0];
    if (!user) {
      console.log(`SKIP  ${email} — no account with this email.`);
      continue;
    }
    if (user.beta_free_month_eligible) {
      console.log(`SKIP  ${user.parent_email} — already eligible for the extended trial.`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`WOULD GRANT  ${user.parent_email} — 30-day trial on next checkout`);
      continue;
    }

    await pool.query('UPDATE users SET beta_free_month_eligible = true WHERE id = $1', [user.id]);
    console.log(`GRANTED  ${user.parent_email} — 30-day trial on next checkout`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Grant crashed:', err);
  process.exit(1);
});
