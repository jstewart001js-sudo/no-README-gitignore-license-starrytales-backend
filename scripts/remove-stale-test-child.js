// One-off cleanup — removes child 14 ("Hitler"), a stale test entry created
// before the BLOCKED_NAMES profanity-filter fix (commit 9f51c6c) existed.
// Confirmed by the account owner to be their own test data, not a real
// subscriber's child. Same cascade behavior as DELETE /api/children/:id
// (also removes this child's story history via the stories.child_id FK).
//
// Run with: node scripts/remove-stale-test-child.js

require('dotenv').config();
const pool = require('../db/pool');

const CHILD_ID = 14;

async function main() {
  const existing = await pool.query('SELECT id, name FROM children WHERE id = $1', [CHILD_ID]);
  if (existing.rows.length === 0) {
    console.log(`Child ${CHILD_ID} not found — already removed, nothing to do.`);
    await pool.end();
    return;
  }

  const { name } = existing.rows[0];
  if (name !== 'Hitler') {
    console.log(`Child ${CHILD_ID} is named "${name}", not "Hitler" — aborting to be safe. No changes made.`);
    await pool.end();
    return;
  }

  await pool.query('DELETE FROM children WHERE id = $1', [CHILD_ID]);
  console.log(`Removed child ${CHILD_ID} ("Hitler") and their story history.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Cleanup crashed:', err);
  process.exit(1);
});
