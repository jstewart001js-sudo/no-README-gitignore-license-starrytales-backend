const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../../db/pool');
const { requireAuth } = require('../middleware/auth');
const { isHouseholdMember, getEffectiveOwnerId } = require('../services/household');
const { sendHouseholdInviteEmail } = require('../services/email');

const router = express.Router();
const SALT_ROUNDS = 12;
const MAX_MEMBERS = 3;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/household/invite
// Protected, owner-only. Body: { email }
router.post('/invite', requireAuth, async (req, res) => {
  const { email } = req.body;

  if (!email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    if (await isHouseholdMember(req.userId)) {
      return res.status(403).json({ error: 'Only the household owner can send invites.' });
    }

    const ownerResult = await pool.query('SELECT parent_email FROM users WHERE id = $1', [req.userId]);
    const ownerEmail = ownerResult.rows[0].parent_email;

    if (email.toLowerCase() === ownerEmail.toLowerCase()) {
      return res.status(400).json({ error: "That's your own email address." });
    }

    const existingCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM household_members
       WHERE owner_user_id = $1 AND status IN ('invited', 'accepted')`,
      [req.userId]
    );
    if (existingCount.rows[0].count >= MAX_MEMBERS) {
      return res.status(400).json({ error: `You can invite up to ${MAX_MEMBERS} household members.` });
    }

    const alreadyThere = await pool.query(
      'SELECT id, status FROM household_members WHERE owner_user_id = $1 AND email = $2',
      [req.userId, email]
    );
    if (alreadyThere.rows.length > 0) {
      const status = alreadyThere.rows[0].status;
      return res.status(409).json({
        error: status === 'accepted' ? 'That person is already a household member.' : "That person's already been invited.",
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const inserted = await pool.query(
      `INSERT INTO household_members (owner_user_id, email, status, invite_token, invite_token_expires)
       VALUES ($1, $2, 'invited', $3, $4)
       RETURNING id, email, status, created_at`,
      [req.userId, email, token, expires]
    );

    res.status(201).json(inserted.rows[0]);

    const acceptUrl = `${process.env.APP_URL}/household-invite.html?token=${token}`;
    try {
      await sendHouseholdInviteEmail(email, ownerEmail, acceptUrl);
    } catch (emailErr) {
      console.error('Household invite email send error', emailErr);
    }
  } catch (err) {
    console.error('Household invite error', err);
    res.status(500).json({ error: 'Could not send the invite right now.' });
  }
});

// GET /api/household/members
// Protected. Lists the household members belonging to the caller's own
// account (empty for someone who's a member of another household, since
// they don't own one themselves).
router.get('/members', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, status, created_at, accepted_at
       FROM household_members WHERE owner_user_id = $1 ORDER BY created_at ASC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List household members error', err);
    res.status(500).json({ error: 'Could not load household members.' });
  }
});

// DELETE /api/household/members/:id
// Protected, owner-only. Revokes an invite or removes an accepted member.
router.delete('/members/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM household_members WHERE id = $1 AND owner_user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Household member not found.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Remove household member error', err);
    res.status(500).json({ error: 'Could not remove that member.' });
  }
});

// GET /api/household/status
// Protected. Tells the dashboard whether the logged-in user is viewing
// their own account or acting as a member of someone else's household.
router.get('/status', requireAuth, async (req, res) => {
  try {
    const ownerId = await getEffectiveOwnerId(req.userId);
    if (ownerId === req.userId) {
      return res.json({ isMember: false, ownerEmail: null });
    }
    const ownerResult = await pool.query('SELECT parent_email FROM users WHERE id = $1', [ownerId]);
    res.json({ isMember: true, ownerEmail: ownerResult.rows[0]?.parent_email || null });
  } catch (err) {
    console.error('Household status error', err);
    res.status(500).json({ error: 'Could not load household status.' });
  }
});

// GET /api/household/invite-info/:token
// Public. Lets the accept page know what to render -- a "set password" form
// for a brand-new person, or a "confirm your existing password" form for
// someone who already has a StarryTales account under that email.
router.get('/invite-info/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT hm.email, hm.invite_token_expires, hm.status, u.parent_email AS owner_email
       FROM household_members hm
       JOIN users u ON u.id = hm.owner_user_id
       WHERE hm.invite_token = $1`,
      [req.params.token]
    );
    const invite = result.rows[0];

    if (!invite || invite.status !== 'invited' || new Date(invite.invite_token_expires) < new Date()) {
      return res.status(400).json({ error: 'This invite is invalid or has expired.' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE parent_email = $1', [invite.email]);

    res.json({
      email: invite.email,
      ownerEmail: invite.owner_email,
      accountExists: existing.rows.length > 0,
    });
  } catch (err) {
    console.error('Invite info error', err);
    res.status(500).json({ error: 'Could not load this invite.' });
  }
});

// POST /api/household/accept
// Public. Body: { token, password }
// If the invited email already has an account, `password` must match it
// (this links the invite to their existing login instead of overwriting
// it). Otherwise a new account is created with that password.
router.post('/accept', async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'Missing token or password.' });
  }

  try {
    const inviteResult = await pool.query(
      `SELECT id, owner_user_id, email, invite_token_expires, status
       FROM household_members WHERE invite_token = $1`,
      [token]
    );
    const invite = inviteResult.rows[0];

    if (!invite || invite.status !== 'invited' || new Date(invite.invite_token_expires) < new Date()) {
      return res.status(400).json({ error: 'This invite is invalid or has expired.' });
    }

    const existingUserResult = await pool.query('SELECT * FROM users WHERE parent_email = $1', [invite.email]);
    let memberUserId;

    if (existingUserResult.rows.length > 0) {
      const existingUser = existingUserResult.rows[0];
      const valid = await bcrypt.compare(password, existingUser.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Incorrect password for your existing StarryTales account.' });
      }
      memberUserId = existingUser.id;
    } else {
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const newUserResult = await pool.query(
        `INSERT INTO users (parent_email, password_hash) VALUES ($1, $2) RETURNING id`,
        [invite.email, passwordHash]
      );
      memberUserId = newUserResult.rows[0].id;
    }

    await pool.query(
      `UPDATE household_members
       SET status = 'accepted', member_user_id = $1, accepted_at = now(), invite_token = NULL, invite_token_expires = NULL
       WHERE id = $2`,
      [memberUserId, invite.id]
    );

    const jwtToken = jwt.sign({ userId: memberUserId }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token: jwtToken, user: { id: memberUserId, parent_email: invite.email } });
  } catch (err) {
    console.error('Accept household invite error', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
