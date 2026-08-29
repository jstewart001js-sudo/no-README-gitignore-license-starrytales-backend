const express = require('express');
const pool = require('../../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const VALID_THEMES = ['adventure', 'fantasy', 'space', 'underwater', 'animals', 'fairytale'];

router.use(requireAuth);

// POST /api/children
// Body: { name, storyTheme }
router.post('/', async (req, res) => {
  const { name, storyTheme } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Child's name is required." });
  }
  if (!VALID_THEMES.includes(storyTheme)) {
    return res.status(400).json({ error: 'Please choose a valid story theme.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO children (user_id, name, story_theme)
       VALUES ($1, $2, $3)
       RETURNING id, name, story_theme, active, created_at`,
      [req.userId, name.trim(), storyTheme]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create child error', err);
    res.status(500).json({ error: 'Could not save your child right now.' });
  }
});

// GET /api/children
// Lists every child belonging to the logged-in parent.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, story_theme, active, created_at
       FROM children WHERE user_id = $1 ORDER BY created_at ASC`,
      [req.userId]
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

  try {
    // Ownership check first so one parent can never edit another parent's child.
    const owned = await pool.query('SELECT id FROM children WHERE id = $1 AND user_id = $2', [id, req.userId]);
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
  } catch (err) {
    console.error('Update child error', err);
    res.status(500).json({ error: 'Could not update your child right now.' });
  }
});

module.exports = router;
