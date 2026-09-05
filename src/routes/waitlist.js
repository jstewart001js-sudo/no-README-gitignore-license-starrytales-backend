const express = require('express');
const { sendWaitlistNotification } = require('../services/email');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/waitlist
// Public. Body: { email }
// Notifies the StarryTales inbox of interest — no account is created.
router.post('/', async (req, res) => {
  const { email } = req.body;

  if (!email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    await sendWaitlistNotification(email);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Waitlist notification error', err);
    res.status(500).json({ error: 'Could not join the waitlist right now.' });
  }
});

module.exports = router;
