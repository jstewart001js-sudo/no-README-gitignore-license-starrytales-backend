const express = require('express');
const pool = require('../../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/children/:childId/stories
// Returns story history so a parent can revisit past nights' tales.
router.get('/:childId/stories', async (req, res) => {
  const { childId } = req.params;

  try {
    // Ownership check: the child must belong to the logged-in parent.
    const owned = await pool.query('SELECT id FROM children WHERE id = $1 AND user_id = $2', [childId, req.userId]);
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

module.exports = router;
