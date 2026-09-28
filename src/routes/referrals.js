const express = require('express');
const crypto = require('crypto');
const pool = require('../../db/pool');
const { requireAuth } = require('../middleware/auth');
const { isHouseholdMember } = require('../services/household');
const { sendReferralInviteEmail } = require('../services/email');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.use(requireAuth);

// POST /api/referrals
// Body: { email }
// Referrals are tied to the household owner, not individual members, since
// the reward is a credit against the owner's billing (same restriction as
// the Stripe routes).
router.post('/', async (req, res) => {
  const normalizedEmail = (req.body.email || '').trim().toLowerCase();

  if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    if (await isHouseholdMember(req.userId)) {
      return res.status(403).json({ error: 'Only the account owner can send referrals.' });
    }

    const userResult = await pool.query('SELECT parent_email FROM users WHERE id = $1', [req.userId]);
    const referrer = userResult.rows[0];
    if (!referrer) return res.status(404).json({ error: 'Account not found.' });

    if (normalizedEmail === referrer.parent_email.toLowerCase()) {
      return res.status(400).json({ error: "You can't refer yourself." });
    }

    // Case-insensitive: signup stores parent_email exactly as typed (no
    // normalization), so an exact match against a lowercased search term
    // could miss an existing account stored with different capitalization.
    const existingUser = await pool.query('SELECT id FROM users WHERE LOWER(parent_email) = $1', [normalizedEmail]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'That email already has a StarryTales account.' });
    }

    const existingReferral = await pool.query(
      `SELECT id FROM referrals WHERE referrer_user_id = $1 AND referred_email = $2 AND status IN ('pending', 'signed_up')`,
      [req.userId, normalizedEmail]
    );
    if (existingReferral.rows.length > 0) {
      return res.status(400).json({ error: "You've already referred this email." });
    }

    const token = crypto.randomBytes(24).toString('hex');
    await pool.query(
      `INSERT INTO referrals (referrer_user_id, referred_email, referral_token)
       VALUES ($1, $2, $3)`,
      [req.userId, normalizedEmail, token]
    );

    const signupUrl = `${process.env.APP_URL}/index.html?ref=${token}#signup`;
    await sendReferralInviteEmail(normalizedEmail, referrer.parent_email, signupUrl);

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Create referral error', err);
    res.status(500).json({ error: 'Could not send the referral right now.' });
  }
});

// GET /api/referrals
// Lists the caller's own referrals and their statuses.
router.get('/', async (req, res) => {
  try {
    if (await isHouseholdMember(req.userId)) {
      return res.status(403).json({ error: 'Only the account owner can view referrals.' });
    }

    const result = await pool.query(
      `SELECT id, referred_email, status, created_at, reward_applied_at
       FROM referrals WHERE referrer_user_id = $1 ORDER BY created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List referrals error', err);
    res.status(500).json({ error: 'Could not load your referrals.' });
  }
});

module.exports = router;
