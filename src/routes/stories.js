const express = require('express');
const { DateTime } = require('luxon');
const pool = require('../../db/pool');
const { requireAuth } = require('../middleware/auth');
const { getEffectiveOwnerId } = require('../services/household');
const { generateStory } = require('../services/claude');
const { sendStoryEmail } = require('../services/email');

const router = express.Router();
router.use(requireAuth);

// GET /api/children/:childId/stories
// Returns story history so anyone in the household can revisit past nights' tales.
router.get('/:childId/stories', async (req, res) => {
  const { childId } = req.params;

  try {
    const ownerId = await getEffectiveOwnerId(req.userId);

    // Ownership check: the child must belong to the caller's household.
    const owned = await pool.query('SELECT id FROM children WHERE id = $1 AND user_id = $2', [childId, ownerId]);
    if (owned.rows.length === 0) {
      return res.status(404).json({ error: 'Child not found.' });
    }

    const result = await pool.query(
      `SELECT id, title, body, delivery_status, sent_at, created_at
       FROM stories WHERE child_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [childId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List stories error', err);
    res.status(500).json({ error: 'Could not load stories right now.' });
  }
});

// POST /api/children/:childId/send-now
// Lets a parent trigger a child's story immediately instead of waiting for
// the 6:30 PM local delivery window. If today's story already exists (sent
// by the scheduler or a previous send-now call), that same story is resent
// rather than generating a second one for the day.
router.post('/:childId/send-now', async (req, res) => {
  const { childId } = req.params;

  try {
    const ownerId = await getEffectiveOwnerId(req.userId);

    const childResult = await pool.query(
      `SELECT c.id, c.name, c.story_theme, c.active, u.parent_email, u.timezone
       FROM children c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = $1 AND c.user_id = $2`,
      [childId, ownerId]
    );
    if (childResult.rows.length === 0) {
      return res.status(404).json({ error: 'Child not found.' });
    }
    const child = childResult.rows[0];

    if (!child.active) {
      return res.status(400).json({ error: `${child.name}'s delivery is paused. Resume it first.` });
    }

    const subResult = await pool.query(
      `SELECT id FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'trialing') LIMIT 1`,
      [ownerId]
    );
    if (subResult.rows.length === 0) {
      return res.status(402).json({ error: 'An active subscription is required to send stories.' });
    }

    const localToday = DateTime.now().setZone(child.timezone).toISODate();
    const existing = await pool.query(
      `SELECT id, title, body FROM stories
       WHERE child_id = $1 AND created_at::date = $2::date
       ORDER BY created_at DESC LIMIT 1`,
      [childId, localToday]
    );

    let story, storyId;
    if (existing.rows.length > 0) {
      story = existing.rows[0];
      storyId = story.id;
    } else {
      const recentTitlesResult = await pool.query(
        `SELECT title FROM stories WHERE child_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [childId]
      );
      const recentTitles = recentTitlesResult.rows.map((r) => r.title);
      story = await generateStory(child.name, child.story_theme, recentTitles);

      const inserted = await pool.query(
        `INSERT INTO stories (child_id, title, body, delivery_status)
         VALUES ($1, $2, $3, 'pending') RETURNING id`,
        [childId, story.title, story.body]
      );
      storyId = inserted.rows[0].id;
    }

    try {
      await sendStoryEmail(child.parent_email, child.name, story);
      await pool.query(`UPDATE stories SET delivery_status = 'sent', sent_at = now() WHERE id = $1`, [storyId]);
      res.json({ ok: true, title: story.title });
    } catch (sendErr) {
      await pool.query(`UPDATE stories SET delivery_status = 'failed' WHERE id = $1`, [storyId]);
      console.error('Send-now email failed', sendErr);
      res.status(502).json({ error: 'The story was generated but the email failed to send. Try again in a moment.' });
    }
  } catch (err) {
    console.error('Send-now error', err);
    res.status(500).json({ error: 'Could not send the story right now.' });
  }
});

module.exports = router;
