const express = require('express');
const { sendBetaFeedbackRequestEmail } = require('../services/email');

// Narrow, shared-secret-gated routes for one-off admin actions that need to
// fire from outside a logged-in session (e.g. a scheduled cloud trigger
// hitting this endpoint at a specific time). Deliberately NOT behind
// requireAuth (no user session exists when this fires) -- protected
// instead by a constant-time comparison against ADMIN_TRIGGER_SECRET,
// which lives only in Render's env vars, never in git.
//
// If this grows beyond one or two of these, it'd be worth a real
// authenticated admin role instead of a shared secret.

const router = express.Router();

function requireAdminSecret(req, res, next) {
  const provided = req.get('x-admin-secret') || '';
  const expected = process.env.ADMIN_TRIGGER_SECRET || '';

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  const { timingSafeEqual } = require('crypto');
  const match =
    expected.length > 0 &&
    providedBuf.length === expectedBuf.length &&
    timingSafeEqual(providedBuf, expectedBuf);

  if (!match) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  next();
}

// POST /api/admin/send-beta-feedback-request
// One-off trigger for scripts/send-beta-feedback-request.js's recipient
// list, callable without Render Shell access. See that script for the
// full reasoning on who's included/excluded.
router.post('/send-beta-feedback-request', requireAdminSecret, async (req, res) => {
  const RECIPIENTS = [
    'a.celata617@gmail.com',
    'fdaffydeb@aol.com',
    'stewartdanielle@yahoo.com',
    'tanyaevans76@gmail.com',
  ];

  const results = [];
  for (const email of RECIPIENTS) {
    try {
      await sendBetaFeedbackRequestEmail(email);
      results.push({ email, ok: true });
    } catch (err) {
      console.error(`Beta feedback request send failed for ${email}:`, err.message);
      results.push({ email, ok: false, error: err.message });
    }
  }

  res.json({ results });
});

module.exports = router;
