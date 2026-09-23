// One-off catch-up run — sends tonight's story to every active child who
// didn't get one, regardless of the 6:30 PM local-time delivery window.
// Use this after fixing an outage that caused the scheduler to skip a night
// (e.g. a bad ANTHROPIC_WORKSPACE_ID on 2026-09-23).
//
// Safe to re-run: skips any child who already has a story row for today's
// local date, same idempotency guard as the real scheduler.
//
// Run with: node scripts/catch-up-deliveries.js
// Run with DRY_RUN=1 to see who WOULD be sent to, without sending anything.

require('dotenv').config();
const { DateTime } = require('luxon');
const pool = require('../db/pool');
const { generateStory } = require('../src/services/claude');
const { sendStoryEmail } = require('../src/services/email');

const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  const candidates = await pool.query(`
    SELECT
      c.id AS child_id, c.name AS child_name, c.story_theme,
      u.parent_email, u.timezone
    FROM children c
    JOIN users u ON u.id = c.user_id
    JOIN subscriptions s ON s.user_id = u.id
    WHERE c.active = true
      AND s.status IN ('active', 'trialing')
  `);

  console.log(`Checking ${candidates.rows.length} active, subscribed children...\n`);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of candidates.rows) {
    const localToday = DateTime.now().setZone(row.timezone).toISODate();

    const alreadySentToday = await pool.query(
      `SELECT id FROM stories WHERE child_id = $1 AND created_at::date = $2::date LIMIT 1`,
      [row.child_id, localToday]
    );
    if (alreadySentToday.rows.length > 0) {
      console.log(`SKIP  child ${row.child_id} (${row.child_name}) — already has a story for ${localToday}`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`WOULD SEND  child ${row.child_id} (${row.child_name}) -> ${row.parent_email}`);
      sent++;
      continue;
    }

    try {
      const recentTitlesResult = await pool.query(
        `SELECT title FROM stories WHERE child_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [row.child_id]
      );
      const recentTitles = recentTitlesResult.rows.map((r) => r.title);

      const story = await generateStory(row.child_name, row.story_theme, recentTitles);

      const inserted = await pool.query(
        `INSERT INTO stories (child_id, title, body, delivery_status)
         VALUES ($1, $2, $3, 'pending') RETURNING id`,
        [row.child_id, story.title, story.body]
      );
      const storyId = inserted.rows[0].id;

      await sendStoryEmail(row.parent_email, row.child_name, story);
      await pool.query(`UPDATE stories SET delivery_status = 'sent', sent_at = now() WHERE id = $1`, [storyId]);

      console.log(`SENT  child ${row.child_id} (${row.child_name}) -> ${row.parent_email} — "${story.title}"`);
      sent++;
    } catch (err) {
      console.error(`FAILED  child ${row.child_id} (${row.child_name}):`, err.message);
      failed++;
    }
  }

  console.log(`\nDone. Sent: ${sent}, skipped (already had tonight's story): ${skipped}, failed: ${failed}`);
  await pool.end();
}

main().catch((err) => {
  console.error('Catch-up run crashed:', err);
  process.exit(1);
});
