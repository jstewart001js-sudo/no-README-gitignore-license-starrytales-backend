// One-off read-only report — lists every parent email with a currently
// active/trialing subscription, for use as a mailing list (e.g. the beta
// feedback-request email). Does not send anything or modify any data.
//
// Run with: node scripts/list-active-subscriber-emails.js
// (needs production DATABASE_URL in the environment -- e.g. run from
// Render's Shell tab for the starrytales-backend service)

require('dotenv').config();
const pool = require('../db/pool');

async function main() {
  const result = await pool.query(
    `SELECT DISTINCT u.parent_email, s.status
     FROM users u
     JOIN subscriptions s ON s.user_id = u.id
     WHERE s.status IN ('active', 'trialing')
     ORDER BY u.parent_email`
  );

  console.log(`${result.rows.length} subscriber(s) with an active/trialing subscription:\n`);
  for (const row of result.rows) {
    console.log(`${row.parent_email}  (${row.status})`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Query failed:', err);
  process.exit(1);
});
