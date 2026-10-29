// One-off send — asks early beta testers for written feedback and,
// optionally, a short (<1 min) video, to be sent back to
// Starrytales101@gmail.com. Recipients are real subscribers only (pulled
// from scripts/list-active-subscriber-emails.js output and confirmed with
// the account owner); internal test/beta-alias accounts and the business
// inbox itself are deliberately excluded.
//
// Run with: node scripts/send-beta-feedback-request.js
// Run with DRY_RUN=1 to print the recipient list without sending anything.

require('dotenv').config();
const { sendBetaFeedbackRequestEmail } = require('../src/services/email');

const RECIPIENTS = [
  'a.celata617@gmail.com',
  'fdaffydeb@aol.com',
  'stewartdanielle@yahoo.com',
  'tanyaevans76@gmail.com',
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
      await sendBetaFeedbackRequestEmail(email);
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
