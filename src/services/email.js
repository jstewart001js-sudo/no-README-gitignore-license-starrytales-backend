require('dotenv').config();
const { Resend } = require('resend');
const { tokenFor } = require('../routes/unsubscribe');

// Swap Resend for Postmark/SendGrid if you prefer — same idea: one function
// that turns a story into an email and sends it.
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_ADDRESS = process.env.EMAIL_FROM || 'StarryTales <stories@starrytales.com>';

// Required on commercial/bulk email (CAN-SPAM) and expected by spam
// filters. Update if the business address changes.
const MAILING_ADDRESS = '45 Macy St, Amesbury, MA 01913';

function buildEmailHtml({ childName, title, body, childId }) {
  const paragraphs = body
    .split('\n')
    .filter((p) => p.trim().length > 0)
    .map((p) => `<p style="margin:0 0 16px; line-height:1.7; color:#3a2f22;">${escapeHtml(p)}</p>`)
    .join('');

  const unsubscribeUrl = unsubscribeUrlFor(childId);

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
    <div style="max-width:520px; margin:16px auto 0; text-align:center; font-size:11px; color:#5a6a8a; line-height:1.6;">
      <p style="margin:0 0 6px;">StarryTales · ${escapeHtml(MAILING_ADDRESS)}</p>
      <p style="margin:0;"><a href="${unsubscribeUrl}" style="color:#8a9bc0;">Pause ${escapeHtml(childName)}'s nightly stories</a></p>
    </div>
  </div>`;
}

function buildStoryTextBody({ childName, title, body, childId }) {
  const unsubscribeUrl = unsubscribeUrlFor(childId);
  return `Tonight's story for ${childName}\n\n${title}\n\n${body}\n\nSweet dreams from all of us at StarryTales.\n\n--\nStarryTales · ${MAILING_ADDRESS}\nPause ${childName}'s nightly stories: ${unsubscribeUrl}`;
}

function unsubscribeUrlFor(childId) {
  return `${process.env.APP_URL}/api/unsubscribe/${childId}?token=${tokenFor(childId)}`;
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
 * @param {number|string} childId - used to build the one-click unsubscribe link
 */
async function sendStoryEmail(toEmail, childName, story, childId) {
  const unsubscribeUrl = unsubscribeUrlFor(childId);

  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: `${childName}'s bedtime story: ${story.title}`,
    html: buildEmailHtml({ childName, title: story.title, body: story.body, childId }),
    text: buildStoryTextBody({ childName, title: story.title, body: story.body, childId }),
    headers: {
      // Lets Gmail/Yahoo/Outlook show their native one-click "Unsubscribe"
      // control next to the sender name, which meaningfully helps inbox
      // placement -- and is required once send volume crosses their bulk-
      // sender thresholds. The mail client POSTs straight to this URL
      // (RFC 8058); see routes/unsubscribe.js for the handler.
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
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
    text: `New waitlist signup: ${email}`,
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
    text: `Reset your password\n\nWe received a request to reset your StarryTales password. This link expires in 1 hour.\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
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
    text: `Welcome to StarryTales!\n\nYour account is ready. Add a child, choose their favorite kind of story, and start your subscription to begin nightly deliveries at 6:30 PM.\n\n${dashboardUrl}\n\nSweet dreams, from all of us at StarryTales.`,
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
    text: `You're invited to a StarryTales household\n\n${ownerEmail} invited you to join their StarryTales household, so you can see and manage the same children's nightly stories. This link expires in 7 days.\n\n${acceptUrl}\n\nIf you weren't expecting this, you can safely ignore this email.`,
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
    text: `A quick apology from StarryTales\n\nHi there,\n\nYou may have noticed tonight's bedtime story arrived late, or not at all. That was on us — a configuration issue in our story-delivery system caused a delay for some families tonight.\n\nWe're still in the beta testing stage, working out exactly these kinds of kinks before a full launch, and we're sorry your family got caught by one. The issue is fixed, and tonight's story has now been delivered.\n\nThank you for your patience as we build this out — it means a lot to have you along for the beta.\n\nSweet dreams from all of us at StarryTales.`,
  });

  if (error) {
    throw new Error(`Apology email failed: ${error.message || error}`);
  }
  return data;
}

/**
 * Invites a friend to try StarryTales on behalf of an existing parent.
 * @param {string} toEmail - the friend's email address
 * @param {string} referrerEmail - the inviting parent's email, for context
 * @param {string} signupUrl - link to index.html#signup carrying the referral token
 */
async function sendReferralInviteEmail(toEmail, referrerEmail, signupUrl) {
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: `${referrerEmail} thinks your family would love StarryTales`,
    html: `
    <div style="background:#0c1526; padding:32px 16px; font-family:Georgia, 'Times New Roman', serif;">
      <div style="max-width:480px; margin:0 auto; background:#faf3e4; border-radius:14px; padding:32px;">
        <h1 style="font-size:22px; margin:0 0 16px; color:#2a2118;">A bedtime story invitation</h1>
        <p style="color:#3a2f22; line-height:1.6; margin:0 0 20px;"><strong>${escapeHtml(referrerEmail)}</strong> thought your family would enjoy StarryTales — a fresh, personalized bedtime story for your child, delivered by email every night at 6:30 PM.</p>
        <p style="margin:0 0 20px;"><a href="${signupUrl}" style="background:#f4c77a; color:#0c1526; padding:12px 24px; border-radius:100px; text-decoration:none; font-weight:bold;">Try StarryTales</a></p>
        <p style="color:#7a6c56; font-size:13px; margin:0;">If you weren't expecting this, you can safely ignore this email.</p>
      </div>
    </div>`,
    text: `A bedtime story invitation\n\n${referrerEmail} thought your family would enjoy StarryTales — a fresh, personalized bedtime story for your child, delivered by email every night at 6:30 PM.\n\n${signupUrl}\n\nIf you weren't expecting this, you can safely ignore this email.`,
  });

  if (error) {
    throw new Error(`Referral invite email failed: ${error.message || error}`);
  }
  return data;
}

/**
 * Lets a parent know their referral converted and they earned a reward.
 * @param {string} toEmail - the referring parent's email address
 */
async function sendReferralRewardEmail(toEmail) {
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: 'You earned a free month on StarryTales!',
    html: `
    <div style="background:#0c1526; padding:32px 16px; font-family:Georgia, 'Times New Roman', serif;">
      <div style="max-width:480px; margin:0 auto; background:#faf3e4; border-radius:14px; padding:32px;">
        <h1 style="font-size:22px; margin:0 0 16px; color:#2a2118;">Thanks for spreading the word! 🌙</h1>
        <p style="color:#3a2f22; line-height:1.7; margin:0 0 16px;">A friend you referred just became a StarryTales subscriber — so we've added a $7.99 credit to your account. It'll automatically apply to your next bill.</p>
        <p style="color:#7a6c56; font-size:13px; margin:0;">Sweet dreams from all of us at StarryTales.</p>
      </div>
    </div>`,
    text: `Thanks for spreading the word!\n\nA friend you referred just became a StarryTales subscriber — so we've added a $7.99 credit to your account. It'll automatically apply to your next bill.\n\nSweet dreams from all of us at StarryTales.`,
  });

  if (error) {
    throw new Error(`Referral reward email failed: ${error.message || error}`);
  }
  return data;
}

/**
 * One-off beta-update announcement: new story themes, the annual plan,
 * and an Instagram follow ask. Sent to a hand-picked list of real
 * subscribers -- see scripts/send-beta-update-email.js.
 * @param {string} toEmail - the account's email address
 */
async function sendBetaUpdateEmail(toEmail) {
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: "New themes, an annual plan, and more at StarryTales",
    html: `
    <div style="background:#0c1526; padding:32px 16px; font-family:Georgia, 'Times New Roman', serif;">
      <div style="max-width:480px; margin:0 auto; background:#faf3e4; border-radius:14px; padding:32px;">
        <h1 style="font-size:22px; margin:0 0 16px; color:#2a2118;">What's new at StarryTales 🌙</h1>
        <p style="color:#3a2f22; line-height:1.7; margin:0 0 16px;">Hi there,</p>
        <p style="color:#3a2f22; line-height:1.7; margin:0 0 16px;">A quick update on what's new since you joined us for the beta:</p>
        <p style="color:#3a2f22; line-height:1.7; margin:0 0 16px;"><strong>Three new story themes</strong> — your child can now become the hero of <strong>Mythical Creatures</strong> (dragons, unicorns, and gentle fairies), <strong>Dinosaur Valley</strong> (gentle giants and misty valleys), or <strong>Super Squad</strong> (kind superpowers and everyday heroics), alongside the original six. Switch anytime from your dashboard.</p>
        <p style="color:#3a2f22; line-height:1.7; margin:0 0 16px;"><strong>An annual plan</strong> — if you'd rather not think about it every month, you can now subscribe annually and save $20/year compared to paying monthly.</p>
        <p style="color:#3a2f22; line-height:1.7; margin:0 0 16px;"><strong>One more thing</strong> — we're now on Instagram! Follow <a href="https://www.instagram.com/starrytales2026" style="color:#8a2f2f;">@starrytales2026</a> for behind-the-scenes updates and to help us shape what comes next.</p>
        <p style="color:#3a2f22; line-height:1.7; margin:0 0 20px;">Thanks for being part of the beta — it genuinely shapes what we build.</p>
        <p style="color:#7a6c56; font-size:13px; margin:0;">Sweet dreams from all of us at StarryTales. 🌙</p>
      </div>
      <div style="max-width:480px; margin:16px auto 0; text-align:center; font-size:11px; color:#5a6a8a; line-height:1.6;">
        <p style="margin:0;">StarryTales · ${escapeHtml(MAILING_ADDRESS)}</p>
        <p style="margin:4px 0 0;">Reply to this email if you'd rather not receive updates like this.</p>
      </div>
    </div>`,
    text: `What's new at StarryTales\n\nHi there,\n\nA quick update on what's new since you joined us for the beta:\n\nThree new story themes — your child can now become the hero of Mythical Creatures (dragons, unicorns, and gentle fairies), Dinosaur Valley (gentle giants and misty valleys), or Super Squad (kind superpowers and everyday heroics), alongside the original six. Switch anytime from your dashboard.\n\nAn annual plan — if you'd rather not think about it every month, you can now subscribe annually and save $20/year compared to paying monthly.\n\nOne more thing — we're now on Instagram! Follow @starrytales2026 (https://www.instagram.com/starrytales2026) for behind-the-scenes updates and to help us shape what comes next.\n\nThanks for being part of the beta — it genuinely shapes what we build.\n\nSweet dreams from all of us at StarryTales.\n\n--\nStarryTales · ${MAILING_ADDRESS}\nReply to this email if you'd rather not receive updates like this.`,
  });

  if (error) {
    throw new Error(`Beta update email failed: ${error.message || error}`);
  }
  return data;
}

module.exports = {
  sendStoryEmail,
  sendServiceApologyEmail,
  sendReferralInviteEmail,
  sendReferralRewardEmail,
  sendBetaUpdateEmail,
  sendWaitlistNotification,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendHouseholdInviteEmail,
};
