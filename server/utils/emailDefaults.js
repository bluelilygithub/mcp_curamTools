// Default email templates. Seeded once on startup with ON CONFLICT DO NOTHING.
// Admin edits stored in email_templates table are never overwritten.
// Use {{variableName}} placeholders — substituted by EmailTemplateService.render().

const EMAIL_DEFAULTS = [
  {
    slug: 'invitation',
    description: 'Sent when an admin invites a new user to the platform.',
    variables: ['appName', 'activationUrl'],
    subject: 'You have been invited to {{appName}}',
    body_html: `
<p>Hello,</p>
<p>You have been invited to join <strong>{{appName}}</strong>.</p>
<p>Click the link below to accept your invitation and set your password:</p>
<p><a href="{{activationUrl}}">{{activationUrl}}</a></p>
<p>This link expires in 48 hours.</p>
<p>If you did not expect this invitation, you can safely ignore this email.</p>
    `.trim(),
    body_text: `You have been invited to join {{appName}}.\n\nAccept your invitation here:\n{{activationUrl}}\n\nThis link expires in 48 hours.`,
  },
  {
    slug: 'password_reset',
    description: 'Sent when a user requests a password reset.',
    variables: ['appName', 'email', 'resetUrl'],
    subject: 'Reset your {{appName}} password',
    body_html: `
<p>Hello,</p>
<p>We received a request to reset the password for your <strong>{{appName}}</strong> account ({{email}}).</p>
<p>Click the link below to set a new password:</p>
<p><a href="{{resetUrl}}">{{resetUrl}}</a></p>
<p>This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
    `.trim(),
    body_text: `Reset your {{appName}} password.\n\nClick here:\n{{resetUrl}}\n\nThis link expires in 1 hour.`,
  },
];

module.exports = { EMAIL_DEFAULTS };
