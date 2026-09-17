const express = require('express');
const pool = require('../../db/pool');
const { requireAuth } = require('../middleware/auth');
const { syncSubscriptionQuantity } = require('../services/subscriptionSync');
const { containsProfanity } = require('../utils/profanityFilter');
const { getEffectiveOwnerId } = require('../services/household');

const router = express.Router();
const VALID_THEMES = ['adventure', 'fantasy', 'space', 'underwater', 'animals', 'fairytale', 'mythical'];

router.use(requireAuth);

// POST /api/children
// Body: { name, storyTheme }
// Household members act on their household owner's children, not their own
// account, so pricing/delivery/billing all stay tied to the one owner.
router.post('/', async (req, res) => {
  const { name, storyTheme } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Child's name is required." });
  }
  if (containsProfanity(name)) {
    return res.status(400).json({ error: 'Please choose a different name.' });
  }
  if (!VALID_THEMES.includes(storyTheme)) {
    return res.status(400).json({ error: 'Please choose a valid story theme.' });
  }

  try {
    const ownerId = await getEffectiveOwnerId(req.userId);
    const result = await pool.query(
      `INSERT INTO children (user_id, name, story_theme)
       VALUES ($1, $2, $3)
       RETURNING id, name, story_theme, active, created_at`,
      [ownerId, name.trim(), storyTheme]
    );
    res.status(201).json(result.rows[0]);

    // Pricing is per active child -- bump the Stripe subscription quantity
    // if one already exists. Runs after responding so a Stripe hiccup never
    // blocks adding the child.
    try {
      await syncSubscriptionQuantity(ownerId);
    } catch (syncErr) {
      console.error('Subscription quantity sync error (add child)', syncErr);
    }
  } catch (err) {
    console.error('Create child error', err);
    res.status(500).json({ error: 'Could not save your child right now.' });
  }
});

// GET /api/children
// Lists every child belonging to the caller's household.
router.get('/', async (req, res) => {
  try {
    const ownerId = await getEffectiveOwnerId(req.userId);
    const result = await pool.query(
      `SELECT id, name, story_theme, active, created_at
       FROM children WHERE user_id = $1 ORDER BY created_at ASC`,
      [ownerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List children error', err);
    res.status(500).json({ error: 'Could not load your children.' });
  }
});

// PATCH /api/children/:id
// Body: any of { name, storyTheme, active }  — used to change theme or pause delivery.
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, storyTheme, active } = req.body;

  if (storyTheme && !VALID_THEMES.includes(storyTheme)) {
    return res.status(400).json({ error: 'Please choose a valid story theme.' });
  }
  if (name && containsProfanity(name)) {
    return res.status(400).json({ error: 'Please choose a different name.' });
  }

  try {
    const ownerId = await getEffectiveOwnerId(req.userId);

    // Ownership check first so one household can never edit another's child.
    const owned = await pool.query('SELECT id FROM children WHERE id = $1 AND user_id = $2', [id, ownerId]);
    if (owned.rows.length === 0) {
      return res.status(404).json({ error: 'Child not found.' });
    }

    const result = await pool.query(
      `UPDATE children SET
         name = COALESCE($1, name),
         story_theme = COALESCE($2, story_theme),
         active = COALESCE($3, active)
       WHERE id = $4
       RETURNING id, name, story_theme, active, created_at`,
      [name?.trim() || null, storyTheme || null, active === undefined ? null : active, id]
    );
    res.json(result.rows[0]);

    // Pricing is per active child -- pausing/resuming changes the billed
    // quantity. Runs after responding so a Stripe hiccup never blocks the
    // toggle itself.
    if (active !== undefined) {
      try {
        await syncSubscriptionQuantity(ownerId);
      } catch (syncErr) {
        console.error('Subscription quantity sync error (toggle active)', syncErr);
      }
    }
  } catch (err) {
    console.error('Update child error', err);
    res.status(500).json({ error: 'Could not update your child right now.' });
  }
});

// DELETE /api/children/:id
// Permanently removes a child and their story history (cascades via the
// stories.child_id foreign key). If this leaves the household with no
// active children, syncSubscriptionQuantity cancels the Stripe subscription
// outright rather than leaving it billed for a phantom minimum quantity.
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const ownerId = await getEffectiveOwnerId(req.userId);

    const owned = await pool.query('SELECT id FROM children WHERE id = $1 AND user_id = $2', [id, ownerId]);
    if (owned.rows.length === 0) {
      return res.status(404).json({ error: 'Child not found.' });
    }

    await pool.query('DELETE FROM children WHERE id = $1', [id]);
    res.status(204).end();

    // Runs after responding so a Stripe hiccup never blocks the removal itself.
    try {
      await syncSubscriptionQuantity(ownerId);
    } catch (syncErr) {
      console.error('Subscription quantity sync error (remove child)', syncErr);
    }
  } catch (err) {
    console.error('Delete child error', err);
    res.status(500).json({ error: 'Could not remove this child right now.' });
  }
});

module.exports = router;
