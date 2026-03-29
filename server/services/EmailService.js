/**
 * EmailService — transactional email delivery.
 * Primary: MailChannels HTTP API.
 * Fallback: nodemailer (SMTP) when MAIL_CHANNEL_API_KEY is not set.
 *
 * Email calls are non-blocking — a failure logs but never fails the caller.
 */
const nodemailer = require('nodemailer');
const EmailTemplateService = require('./EmailTemplateService');

const FROM_EMAIL = process.env.MAIL_FROM_EMAIL || 'noreply@example.com';
const FROM_NAME = process.env.MAIL_FROM_NAME || 'MCP CuramTools';

// ── MailChannels delivery ─────────────────────────────────────────────────

async function sendViaMailChannels({ to, subject, html, text }) {
  const body = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject,
    content: [
      { type: 'text/plain', value: text },
      { type: 'text/html', value: html },
    ],
  };

  const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.MAIL_CHANNEL_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`MailChannels error ${res.status}: ${detail}`);
  }
}

// ── nodemailer fallback ───────────────────────────────────────────────────

function getSmtpTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.example.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendViaSmtp({ to, subject, html, text }) {
  const transport = getSmtpTransport();
  await transport.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to,
    subject,
    text,
    html,
  });
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Low-level send — accepts pre-composed content.
 */
async function send({ to, subject, html, text }) {
  if (!process.env.MAIL_CHANNEL_API_KEY) {
    console.error('[EmailService] MAIL_CHANNEL_API_KEY is not set — email not sent');
    return;
  }
  try {
    await sendViaMailChannels({ to, subject, html, text });
    console.log(`[EmailService] Sent "${subject}" → ${to}`);
  } catch (err) {
    console.error(`[EmailService] Failed to send to ${to}:`, err.message);
    throw err;
  }
}

/**
 * Send invitation email via the 'invitation' template.
 */
async function sendInvitation(to, activationUrl) {
  const appName = process.env.APP_NAME || 'MCP CuramTools';
  const { subject, html, text } = await EmailTemplateService.render('invitation', {
    activationUrl,
    appName,
    email: to,
  });
  await send({ to, subject, html, text });
}

/**
 * Send password reset email via the 'password_reset' template.
 */
async function sendPasswordReset(to, resetUrl) {
  const appName = process.env.APP_NAME || 'MCP CuramTools';
  const { subject, html, text } = await EmailTemplateService.render('password_reset', {
    resetUrl,
    appName,
    email: to,
  });
  await send({ to, subject, html, text });
}

module.exports = { send, sendInvitation, sendPasswordReset };
