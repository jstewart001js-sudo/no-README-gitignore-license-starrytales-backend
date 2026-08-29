require('dotenv').config();
const { Resend } = require('resend');

// Swap Resend for Postmark/SendGrid if you prefer — same idea: one function
// that turns a story into an email and sends it.
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_ADDRESS = process.env.EMAIL_FROM || 'StarryTales <stories@starrytales.com>';

function buildEmailHtml({ childName, title, body }) {
  const paragraphs = body
    .split('\n')
    .filter((p) => p.trim().length > 0)
    .map((p) => `<p style="margin:0 0 16px; line-height:1.7; color:#3a2f22;">${escapeHtml(p)}</p>`)
    .join('');

  return `
  <div style="background:#0c1526; padding:32px 16px; font-family:Georgia, 'Times New Roman', serif;">
    <div style="max-width:520px; margin:0 auto; background:#faf3e4; border-radius:14px; padding:36px 32px;">
      <p style="font-size:12px; letter-spacing:0.1em; text-transform:uppercase; color:#e8927a; font-weight:bold; margin:0 0 12px;">
        Tonight's story for ${escapeHtml(childName)}
      </p>
      <h1 style="font-size:26px; margin:0 0 20px; color:#2a2118;">${escapeHtml(title)}</h1>
      ${paragraphs}
      <p style="margin-top:28px; font-size:13px; color:#7a6c56;">Sweet dreams from all of us at StarryTales. 🌙</p>
    </div>
  </div>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sends tonight's story to a parent's inbox.
 * @param {string} toEmail - parent's email address
 * @param {string} childName
 * @param {{ title: string, body: string }} story
 */
async function sendStoryEmail(toEmail, childName, story) {
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: `${childName}'s bedtime story: ${story.title}`,
    html: buildEmailHtml({ childName, title: story.title, body: story.body }),
  });

  if (error) {
    throw new Error(`Email send failed: ${error.message || error}`);
  }
  return data;
}

module.exports = { sendStoryEmail };
