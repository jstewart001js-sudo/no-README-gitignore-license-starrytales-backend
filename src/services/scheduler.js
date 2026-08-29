const cron = require('node-cron');
const { DateTime } = require('luxon');
const pool = require('../../db/pool');
const { generateStory } = require('./claude');
const { sendStoryEmail } = require('./email');

const TARGET_HOUR = 18; // 6 PM
const TARGET_MINUTE = 30; // :30 -> 6:30 PM local time

/**
 * Runs every 15 minutes. For each active, paying subscriber whose LOCAL time
 * currently matches 6:30 PM, generates tonight's story and emails it.
 * A subscriber only ever gets processed once per calendar day, tracked via
 * the `stories.created_at` date check below.
 */
async function runDeliveryTick() {
  let candidates;
  try {
    candidates = await pool.query(`
      SELECT
        c.id AS child_id, c.name AS child_name, c.story_theme,
        u.id AS user_id, u.parent_email, u.timezone
      FROM children c
      JOIN users u ON u.id = c.user_id
      JOIN subscriptions s ON s.user_id = u.id
      WHERE c.active = true
        AND s.status = 'active'
    `);
  } catch (err) {
    console.error('Scheduler: failed to load candidates', err);
    return;
  }

  for (const row of candidates.rows) {
    try {
      const localNow = DateTime.now().setZone(row.timezone);

      // Only proceed if it's currently between 6:30 and 6:44 local time —
      // matches the 15-minute cron cadence below.
      const isDeliveryWindow =
        localNow.hour === TARGET_HOUR && localNow.minute >= TARGET_MINUTE && localNow.minute < TARGET_MINUTE + 15;
      if (!isDeliveryWindow) continue;

      const alreadySentToday = await pool.query(
        `SELECT id FROM stories
         WHERE child_id = $1 AND created_at::date = $2::date
         LIMIT 1`,
        [row.child_id, localNow.toISODate()]
      );
      if (alreadySentToday.rows.length > 0) continue; // idempotency guard

      const story = await generateStory(row.child_name, row.story_theme);

      const inserted = await pool.query(
        `INSERT INTO stories (child_id, title, body, delivery_status)
         VALUES ($1, $2, $3, 'pending') RETURNING id`,
        [row.child_id, story.title, story.body]
      );
      const storyId = inserted.rows[0].id;

      try {
        await sendStoryEmail(row.parent_email, row.child_name, story);
        await pool.query(
          `UPDATE stories SET delivery_status = 'sent', sent_at = now() WHERE id = $1`,
          [storyId]
        );
        console.log(`Sent story to ${row.parent_email} for ${row.child_name}`);
      } catch (sendErr) {
        console.error(`Email send failed for child ${row.child_id}`, sendErr);
        await pool.query(`UPDATE stories SET delivery_status = 'failed' WHERE id = $1`, [storyId]);
      }
    } catch (err) {
      console.error(`Delivery failed for child ${row.child_id}`, err);
      // Continue to the next child rather than letting one failure stop the batch.
    }
  }
}

// Runs at :00, :15, :30, :45 past every hour, every day.
function startScheduler() {
  cron.schedule('*/15 * * * *', () => {
    console.log('Running nightly delivery tick', new Date().toISOString());
    runDeliveryTick();
  });
  console.log('Scheduler started — checking every 15 minutes for 6:30 PM local deliveries.');
}

module.exports = { startScheduler, runDeliveryTick };
