// One-off cleanup — removes child 2 ("Eben" under StarryTales101@gmail.com),
// a stale test entry from early setup (1 story ever sent) that would
// otherwise keep generating nightly Claude API cost for nobody now that the
// account has free-for-life access. Does NOT touch child_id=1 (the real,
// actively-used Eben under jstewart001.js@gmail.com) or Robbie, also on
// this account, which the owner asked to leave alone.
//
// Run with: node scripts/remove-eben-starrytales101.js

require('dotenv').config();
const pool = require('../db/pool');

const CHILD_ID = 2;
const EXPECTED_NAME = 'Eben';
const EXPECTED_OWNER_EMAIL = 'starrytales101@gmail.com';

async function main() {
  const existing = await pool.query(
    `SELECT c.id, c.name, u.parent_email
     FROM children c JOIN users u ON u.id = c.user_id
     WHERE c.id = $1`,
    [CHILD_ID]
  );

  if (existing.rows.length === 0) {
    console.log(`Child ${CHILD_ID} not found — already removed, nothing to do.`);
    await pool.end();
    return;
  }

  const { name, parent_email: ownerEmail } = existing.rows[0];
  if (name !== EXPECTED_NAME || ownerEmail.toLowerCase() !== EXPECTED_OWNER_EMAIL) {
    console.log(
      `Child ${CHILD_ID} is "${name}" owned by ${ownerEmail}, not "${EXPECTED_NAME}" owned by ${EXPECTED_OWNER_EMAIL} — aborting to be safe. No changes made.`
    );
    await pool.end();
    return;
  }

  await pool.query('DELETE FROM children WHERE id = $1', [CHILD_ID]);
  console.log(`Removed child ${CHILD_ID} ("${name}" under ${ownerEmail}) and their story history.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Cleanup crashed:', err);
  process.exit(1);
});
