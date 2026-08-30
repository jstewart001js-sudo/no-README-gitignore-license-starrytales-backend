// Manual test — run with: node scripts/test-email.js you@example.com "Amara"
// Sends a real email via Resend so you can confirm delivery end-to-end
// before wiring it into the nightly scheduler.

require('dotenv').config();
const { sendStoryEmail } = require('../src/services/email');

async function main() {
  const toEmail = process.argv[2];
  const childName = process.argv[3] || 'Wren';

  if (!toEmail) {
    console.error('Usage: node scripts/test-email.js <to-email> [childName]');
    process.exit(1);
  }

  const story = {
    title: 'The Night the Stars Went Quiet',
    body: `Once upon a time, in a sky full of whispering stars, ${childName} noticed something strange — the stars had stopped twinkling.\n\nSo ${childName} climbed the tallest hill in town, cupped their hands, and called out a gentle hello. One by one, the stars blinked awake, delighted that someone had noticed them.\n\nFrom that night on, ${childName} and the stars were the best of friends, and the sky never went quiet again.`,
  };

  console.log(`Sending test story email to ${toEmail}...\n`);

  try {
    const result = await sendStoryEmail(toEmail, childName, story);
    console.log('Sent! Resend response:', result);
  } catch (err) {
    console.error('Email send failed:', err.message);
    process.exit(1);
  }
}

main();
