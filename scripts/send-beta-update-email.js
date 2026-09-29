// One-off send — the "new themes, annual plan, and Instagram" beta update,
// to a hand-picked, explicitly-approved list of real subscribers only
// (test/beta-alias accounts and the internal business inbox are
// deliberately excluded; see the conversation this was drafted in for the
// full reasoning).
//
// Run with: node scripts/send-beta-update-email.js
// Run with DRY_RUN=1 to print the recipient list without sending anything.

require('dotenv').config();
const { sendBetaUpdateEmail } = require('../src/services/email');

const RECIPIENTS = [
  'fdaffydeb@aol.com',
  'stewartdanielle@yahoo.com',
  'a.celata617@gmail.com',
  'jstewart001.js@gmail.com',
];

const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  console.log(`${DRY_RUN ? 'DRY RUN — would send' : 'Sending'} to ${RECIPIENTS.length} recipient(s):\n`);

  for (const email of RECIPIENTS) {
    if (DRY_RUN) {
      console.log(`WOULD SEND -> ${email}`);
      continue;
    }
    try {
      await sendBetaUpdateEmail(email);
      console.log(`SENT -> ${email}`);
    } catch (err) {
      console.error(`FAILED -> ${email}:`, err.message);
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Send run crashed:', err);
  process.exit(1);
});
