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

/**
 * Notifies the StarryTales inbox of a new waitlist signup.
 * @param {string} email - the interested visitor's email address
 */
async function sendWaitlistNotification(email) {
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: 'starrytales101@gmail.com',
    subject: 'New StarryTales waitlist signup',
    html: `<p>New waitlist signup: <strong>${escapeHtml(email)}</strong></p>`,
  });

  if (error) {
    throw new Error(`Waitlist email failed: ${error.message || error}`);
  }
  return data;
}

/**
 * Sends a password reset link to a parent's inbox.
 * @param {string} toEmail - the account's email address
 * @param {string} resetUrl - link to reset-password.html with the token
 */
async function sendPasswordResetEmail(toEmail, resetUrl) {
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: 'Reset your StarryTales password',
    html: `
    <div style="background:#0c1526; padding:32px 16px; font-family:Georgia, 'Times New Roman', serif;">
      <div style="max-width:480px; margin:0 auto; background:#faf3e4; border-radius:14px; padding:32px;">
        <h1 style="font-size:22px; margin:0 0 16px; color:#2a2118;">Reset your password</h1>
        <p style="color:#3a2f22; line-height:1.6; margin:0 0 20px;">We received a request to reset your StarryTales password. This link expires in 1 hour.</p>
        <p style="margin:0 0 20px;"><a href="${resetUrl}" style="background:#f4c77a; color:#0c1526; padding:12px 24px; border-radius:100px; text-decoration:none; font-weight:bold;">Reset password</a></p>
        <p style="color:#7a6c56; font-size:13px; margin:0;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    </div>`,
  });

  if (error) {
    throw new Error(`Password reset email failed: ${error.message || error}`);
  }
  return data;
}

/**
 * Sends a welcome email right after a parent creates their account.
 * @param {string} toEmail - the new account's email address
 */
async function sendWelcomeEmail(toEmail) {
  const dashboardUrl = `${process.env.APP_URL}/dashboard.html`;
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: 'Welcome to StarryTales!',
    html: `
    <div style="background:#0c1526; padding:32px 16px; font-family:Georgia, 'Times New Roman', serif;">
      <div style="max-width:480px; margin:0 auto; background:#faf3e4; border-radius:14px; padding:32px;">
        <h1 style="font-size:24px; margin:0 0 16px; color:#2a2118;">Welcome to StarryTales! 🌙</h1>
        <p style="color:#3a2f22; line-height:1.7; margin:0 0 16px;">Your account is ready. Add a child, choose their favorite kind of story, and start your subscription to begin nightly deliveries at 6:30 PM.</p>
        <p style="margin:0 0 20px;"><a href="${dashboardUrl}" style="background:#f4c77a; color:#0c1526; padding:12px 24px; border-radius:100px; text-decoration:none; font-weight:bold;">Go to your dashboard</a></p>
        <p style="color:#7a6c56; font-size:13px; margin:0;">Sweet dreams, from all of us at StarryTales.</p>
      </div>
    </div>`,
  });

  if (error) {
    throw new Error(`Welcome email failed: ${error.message || error}`);
  }
  return data;
}

/**
 * Invites another adult to join a household's StarryTales dashboard.
 * @param {string} toEmail - the invitee's email address
 * @param {string} ownerEmail - the inviting account's email, for context
 * @param {string} acceptUrl - link to household-invite.html with the token
 */
async function sendHouseholdInviteEmail(toEmail, ownerEmail, acceptUrl) {
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: `${ownerEmail} invited you to their StarryTales household`,
    html: `
    <div style="background:#0c1526; padding:32px 16px; font-family:Georgia, 'Times New Roman', serif;">
      <div style="max-width:480px; margin:0 auto; background:#faf3e4; border-radius:14px; padding:32px;">
        <h1 style="font-size:22px; margin:0 0 16px; color:#2a2118;">You're invited to a StarryTales household</h1>
        <p style="color:#3a2f22; line-height:1.6; margin:0 0 20px;"><strong>${escapeHtml(ownerEmail)}</strong> invited you to join their StarryTales household, so you can see and manage the same children's nightly stories. This link expires in 7 days.</p>
        <p style="margin:0 0 20px;"><a href="${acceptUrl}" style="background:#f4c77a; color:#0c1526; padding:12px 24px; border-radius:100px; text-decoration:none; font-weight:bold;">Accept invite</a></p>
        <p style="color:#7a6c56; font-size:13px; margin:0;">If you weren't expecting this, you can safely ignore this email.</p>
      </div>
    </div>`,
  });

  if (error) {
    throw new Error(`Household invite email failed: ${error.message || error}`);
  }
  return data;
}

/**
 * Sends a one-off apology for the 2026-09-23 delivery delay during beta.
 * @param {string} toEmail - the account's email address
 */
async function sendServiceApologyEmail(toEmail) {
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: 'A quick note about tonight\'s story delay',
    html: `
    <div style="background:#0c1526; padding:32px 16px; font-family:Georgia, 'Times New Roman', serif;">
      <div style="max-width:480px; margin:0 auto; background:#faf3e4; border-radius:14px; padding:32px;">
        <h1 style="font-size:22px; margin:0 0 16px; color:#2a2118;">A quick apology from StarryTales</h1>
        <p style="color:#3a2f22; line-height:1.7; margin:0 0 16px;">Hi there,</p>
        <p style="color:#3a2f22; line-height:1.7; margin:0 0 16px;">You may have noticed tonight's bedtime story arrived late, or not at all. That was on us — a configuration issue in our story-delivery system caused a delay for some families tonight.</p>
        <p style="color:#3a2f22; line-height:1.7; margin:0 0 16px;">We're still in the beta testing stage, working out exactly these kinds of kinks before a full launch, and we're sorry your family got caught by one. The issue is fixed, and tonight's story has now been delivered.</p>
        <p style="color:#3a2f22; line-height:1.7; margin:0 0 20px;">Thank you for your patience as we build this out — it means a lot to have you along for the beta.</p>
        <p style="color:#7a6c56; font-size:13px; margin:0;">Sweet dreams from all of us at StarryTales. 🌙</p>
      </div>
    </div>`,
  });

  if (error) {
    throw new Error(`Apology email failed: ${error.message || error}`);
  }
  return data;
}

module.exports = {
  sendStoryEmail,
  sendServiceApologyEmail,
  sendWaitlistNotification,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendHouseholdInviteEmail,
};
