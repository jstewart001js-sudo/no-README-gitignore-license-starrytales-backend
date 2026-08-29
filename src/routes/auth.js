const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../../db/pool');

const router = express.Router();
const SALT_ROUNDS = 12;

// POST /api/auth/signup
// Creates a parent account. Called from the "Begin the story" form.
// Body: { parentEmail, password, timezone }
router.post('/signup', async (req, res) => {
  const { parentEmail, password, timezone } = req.body;

  if (!parentEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE parent_email = $1', [parentEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (parent_email, password_hash, timezone)
       VALUES ($1, $2, $3)
       RETURNING id, parent_email, timezone`,
      [parentEmail, passwordHash, timezone || 'America/New_York']
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Signup error', err);
    res.status(500).json({ error: 'Something went wrong creating your account.' });
  }
});

// POST /api/auth/login
// Body: { parentEmail, password }
router.post('/login', async (req, res) => {
  const { parentEmail, password } = req.body;

  if (!parentEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE parent_email = $1', [parentEmail]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: { id: user.id, parent_email: user.parent_email, timezone: user.timezone },
    });
  } catch (err) {
    console.error('Login error', err);
    res.status(500).json({ error: 'Something went wrong logging you in.' });
  }
});

module.exports = router;
