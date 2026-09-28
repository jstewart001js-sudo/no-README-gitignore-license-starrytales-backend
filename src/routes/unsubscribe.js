const express = require('express');
const crypto = require('crypto');
const pool = require('../../db/pool');
const { syncSubscriptionQuantity } = require('../services/subscriptionSync');

const router = express.Router();

// Public routes (no login) -- the whole point of an unsubscribe link is
// that it works without asking the recipient to sign in. The token proves
// the request is legitimate instead: an HMAC of the child's id keyed by
// JWT_SECRET, so it can't be guessed or forged, and needs no extra storage
// or migration.
function tokenFor(childId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(`unsub:${childId}`).digest('hex').slice(0, 32);
}

function isValidToken(childId, token) {
  if (!token) return false;
  const expected = tokenFor(childId);
  return expected.length === token.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

function page(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>StarryTales</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta name="theme-color" content="#0c1526">
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/app.css">
</head>
<body>
  <div class="card">
    <h1>StarryTales</h1>
    <p class="sub">${message}</p>
    <p class="foot-link"><a href="/dashboard.html">Go to your dashboard</a></p>
  </div>
</body>
</html>`;
}

function confirmPage(childId, token, childName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>StarryTales</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta name="theme-color" content="#0c1526">
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/app.css">
</head>
<body>
  <div class="card">
    <h1>Pause ${childName}'s stories?</h1>
    <p class="sub">This stops tonight's and future nightly emails for ${childName}. You can resume anytime from your dashboard.</p>
    <form method="POST" action="/api/unsubscribe/${childId}?token=${token}">
      <button type="submit">Pause stories</button>
    </form>
  </div>
</body>
</html>`;
}

// GET /api/unsubscribe/:childId?token=...
// Shows a confirmation page -- a GET must stay safe/idempotent (mail
// security scanners sometimes prefetch links), so this never pauses
// anything on its own. The visible link in story emails points here.
router.get('/:childId', async (req, res) => {
  const { childId } = req.params;
  const { token } = req.query;

  if (!isValidToken(childId, token)) {
    return res.status(400).send(page('This unsubscribe link is invalid.'));
  }

  try {
    const result = await pool.query('SELECT name, active FROM children WHERE id = $1', [childId]);
    const child = result.rows[0];
    if (!child) {
      return res.status(404).send(page('This child could not be found — they may have already been removed.'));
    }
    if (!child.active) {
      return res.send(page(`${child.name}'s stories are already paused.`));
    }

    res.send(confirmPage(childId, token, child.name));
  } catch (err) {
    console.error('Unsubscribe confirm-page error', err);
    res.status(500).send(page('Something went wrong loading this page. Please try again in a moment.'));
  }
});

// POST /api/unsubscribe/:childId?token=...
// Actually pauses delivery. This is what a mail client's native one-click
// "Unsubscribe" button calls directly via the List-Unsubscribe-Post header
// (RFC 8058), and also what the confirmation page's button submits to.
router.post('/:childId', async (req, res) => {
  const { childId } = req.params;
  const token = req.query.token || req.body.token;

  if (!isValidToken(childId, token)) {
    return res.status(400).send(page('This unsubscribe link is invalid.'));
  }

  try {
    const result = await pool.query(`UPDATE children SET active = false WHERE id = $1 RETURNING user_id, name`, [
      childId,
    ]);
    const child = result.rows[0];
    if (!child) {
      return res.status(404).send(page('This child could not be found — they may have already been removed.'));
    }

    try {
      await syncSubscriptionQuantity(child.user_id);
    } catch (syncErr) {
      console.error('Subscription quantity sync error (unsubscribe)', syncErr);
    }

    res.send(page(`${child.name}'s nightly stories have been paused. You can resume anytime from your dashboard.`));
  } catch (err) {
    console.error('Unsubscribe error', err);
    res.status(500).send(page('Something went wrong pausing this child\'s stories. Please try again in a moment.'));
  }
});

module.exports = { router, tokenFor };
