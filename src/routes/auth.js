const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../../db/pool');
const { sendPasswordResetEmail, sendWelcomeEmail } = require('../services/email');

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

    try {
      await sendWelcomeEmail(user.parent_email);
    } catch (emailErr) {
      console.error('Welcome email send error', emailErr);
    }
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

// POST /api/auth/forgot-password
// Body: { parentEmail }
// Always responds the same way whether or not the account exists, so this
// endpoint can't be used to check which emails are registered.
router.post('/forgot-password', async (req, res) => {
  const { parentEmail } = req.body;

  if (!parentEmail) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const result = await pool.query('SELECT id FROM users WHERE parent_email = $1', [parentEmail]);
    const user = result.rows[0];

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await pool.query(
        'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
        [token, expires, user.id]
      );

      const resetUrl = `${process.env.APP_URL}/reset-password.html?token=${token}`;
      try {
        await sendPasswordResetEmail(parentEmail, resetUrl);
      } catch (emailErr) {
        console.error('Password reset email send error', emailErr);
      }
    }

    res.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// POST /api/auth/reset-password
// Body: { token, password }
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'Missing token or password.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, reset_token_expires FROM users WHERE reset_token = $1',
      [token]
    );
    const user = result.rows[0];

    if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [passwordHash, user.id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
