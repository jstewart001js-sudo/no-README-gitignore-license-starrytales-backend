// Read-only investigation — two "Eben" story-delivery log lines showed up
// for different parent emails on 2026-09-28 (StarryTales101@gmail.com and
// jstewart001.js@gmail.com). This prints every child named "Eben" with its
// owning account, plus any household_members relationship between those
// accounts, so we can tell whether this is two coincidentally-named test
// children or an actual household-linking bug. Makes no writes.
//
// Run with: node scripts/investigate-duplicate-eben.js

require('dotenv').config();
const pool = require('../db/pool');

async function main() {
  const children = await pool.query(
    `SELECT c.id AS child_id, c.name, c.story_theme, c.active, c.created_at,
            u.id AS user_id, u.parent_email
     FROM children c
     JOIN users u ON u.id = c.user_id
     WHERE c.name ILIKE 'eben'
     ORDER BY c.created_at`
  );

  console.log(`Found ${children.rows.length} child(ren) named "Eben":\n`);
  for (const row of children.rows) {
    console.log(
      `  child_id=${row.child_id}  user_id=${row.user_id}  owner=${row.parent_email}  ` +
        `theme=${row.story_theme}  active=${row.active}  created=${row.created_at.toISOString()}`
    );
  }

  if (children.rows.length < 2) {
    console.log('\nFewer than 2 found — nothing to compare.');
    await pool.end();
    return;
  }

  console.log('\nStory counts per child_id:');
  for (const row of children.rows) {
    const storyCount = await pool.query('SELECT COUNT(*)::int AS count FROM stories WHERE child_id = $1', [
      row.child_id,
    ]);
    console.log(`  child_id=${row.child_id} (${row.parent_email}) — ${storyCount.rows[0].count} stories`);
  }

  const userIds = [...new Set(children.rows.map((r) => r.user_id))];
  console.log(`\nDistinct owning user_ids: ${userIds.join(', ')}`);

  const relationship = await pool.query(
    `SELECT id, owner_user_id, member_user_id, email, status
     FROM household_members
     WHERE owner_user_id = ANY($1) OR member_user_id = ANY($1)`,
    [userIds]
  );
  console.log(`\nHousehold relationships touching these accounts: ${relationship.rows.length}`);
  for (const row of relationship.rows) {
    console.log(
      `  id=${row.id} owner_user_id=${row.owner_user_id} member_user_id=${row.member_user_id} ` +
        `email=${row.email} status=${row.status}`
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Investigation crashed:', err);
  process.exit(1);
});
