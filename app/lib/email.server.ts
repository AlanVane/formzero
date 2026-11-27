import nodemailer from "nodemailer"
import type { EmailConfig, MailTransport } from "#/types/settings"
import type { SubmissionEmailData } from "#/types/submission"
import { FIELD_LABELS } from "#/lib/field-labels"

type Message = { subject: string; text: string; html: string }

/**
 * Picks how this deployment hands a message to a mail server.
 *
 * `MAIL_TRANSPORT=smtp` forces the SMTP path, which is what local runs set so
 * they can point at a fake SMTP server instead of sending real mail. Otherwise
 * a Worker that carries the Cloudflare send binding uses it, and installations
 * without one fall back to SMTP.
 */
export function mailTransport(env: Env): MailTransport {
  // Typed from wrangler.jsonc and widened by .dev.vars, so read it as text.
  if (String(env.MAIL_TRANSPORT) === "smtp") return "smtp"
  return env.EMAIL ? "cloudflare" : "smtp"
}

/**
 * Builds nodemailer transport options for the stored SMTP settings.
 *
 * Port 465 expects TLS from the first byte; 587 (and 25) start in the clear and
 * upgrade via STARTTLS. nodemailer defaults to `secure: false`, so without this
 * a 465 configuration fails during the handshake with no useful message.
 *
 * The value is derived from the port rather than from the `smtp_secure` column,
 * because that column is written as a constant `1` for every port -- using it
 * would force TLS on 587 and break the case that works today.
 *
 * The auth username is the stored SMTP username when set, and the notification
 * email otherwise: servers like Cloudflare Email Service expect a fixed login
 * (`api_token`) that is unrelated to the mailbox address, while classic
 * provider setups (Gmail, Outlook) authenticate with the address itself.
 */
function transportOptions(config: EmailConfig) {
  if (!config.smtp_host || !config.smtp_port) {
    throw new Error("SMTP is not configured for this deployment")
  }
  return {
    host: config.smtp_host,
    port: config.smtp_port,
    secure: config.smtp_port === 465,
    auth: {
      user: config.smtp_username?.trim() || config.notification_email,
      pass: config.notification_email_password ?? undefined,
    },
  }
}

/**
 * Sends one message and returns the provider's message id.
 *
 * A notification goes from the notification address to itself: that is the one
 * sender every installation has, and Cloudflare accepts a sender on the domain
 * it onboarded for sending.
 */
async function deliver(env: Env, config: EmailConfig, message: Message) {
  const from = config.notification_email
  const to = config.notification_email

  if (mailTransport(env) === "cloudflare" && env.EMAIL) {
    const result = await env.EMAIL.send({ ...message, from, to })
    return result.messageId
  }

  const transporter = nodemailer.createTransport(transportOptions(config))
  const info = await transporter.sendMail({ ...message, from, to })
  return info.messageId
}

/** Turns a provider's raw failure into something the settings page can show. */
function describeError(error: unknown) {
  if (!(error instanceof Error)) return "Failed to send email"

  switch ((error as { code?: string }).code) {
    case "E_SENDER_NOT_VERIFIED":
      return "The sender address is not on a domain onboarded for Cloudflare Email Sending"
    case "E_RECIPIENT_NOT_ALLOWED":
      return "Cloudflare Email Service will not send to this recipient yet; verify it as a destination address"
    case "E_FIELD_MISSING":
      return "The message is missing a field Cloudflare Email Service requires"
  }

  if (error.message.includes("Invalid login")) return "Invalid email or password"
  if (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED")) {
    return "Cannot connect to SMTP server"
  }
  return error.message
}

/**
 * Sends a test email to verify SMTP settings
 */
export async function sendTestEmail(
  env: Env,
  config: EmailConfig
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    const messageId = await deliver(env, config, {
      subject: "FormZero - Test Email",
      text: "This is a test email from FormZero. Your email settings are working correctly!",
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Email</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color: #252525; padding: 32px; text-align: center; border-bottom: 1px solid rgba(0, 0, 0, 0.1);">
              <h1 style="margin: 0; color: #fafafa; font-size: 24px; font-weight: 600; letter-spacing: -0.5px;">
                Test Email
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px 0; color: #252525; font-size: 16px; line-height: 1.6;">
                This is a test email from <strong>FormZero</strong>.
              </p>
              <p style="margin: 0; color: #252525; font-size: 16px; line-height: 1.6;">
                Your email settings are working correctly!
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #fafafa; padding: 24px 32px; text-align: center; border-top: 1px solid #ebebeb;">
              <p style="margin: 0; color: #8e8e8e; font-size: 14px;">
                Sent by <strong style="color: #595959;">FormZero</strong>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `.trim(),
    })

    return { success: true, messageId }
  } catch (error) {
    console.error("Error sending test email:", error)
    return { success: false, error: describeError(error) }
  }
}

/**
 * Sends a notification email when a new form submission is received
 */
export async function sendSubmissionNotification(
  env: Env,
  config: EmailConfig,
  submission: SubmissionEmailData
): Promise<{ success: boolean; error?: string }> {
  try {
    // Format the submission data for email display
    const submissionHtml = formatSubmissionData(submission.data)
    const submissionText = formatSubmissionDataText(submission.data)

    // Format timestamp
    const timestamp = new Date(submission.createdAt).toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    })

    await deliver(env, config, {
      subject: `New Submission for "${submission.formName}"`,
      text: `
FormZero - New Form Submission

You have received a new submission for your form "${submission.formName}".

SUBMISSION DETAILS
==================
Form: ${submission.formName}
Submission ID: ${submission.id}
Received: ${timestamp}

SUBMITTED DATA
==============
${submissionText}

---
This email was automatically sent by FormZero
      `.trim(),
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Form Submission</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color: #252525; padding: 32px; text-align: center; border-bottom: 1px solid rgba(0, 0, 0, 0.1);">
              <h1 style="margin: 0; color: #fafafa; font-size: 24px; font-weight: 600; letter-spacing: -0.5px;">
                New Form Submission
              </h1>
              <p style="margin: 8px 0 0 0; color: #b4b4b4; font-size: 16px;">
                ${submission.formName}
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">

              <!-- Introduction -->
              <p style="margin: 0 0 24px 0; color: #252525; font-size: 16px; line-height: 1.6;">
                You have received a new submission for your form <strong>${submission.formName}</strong>.
              </p>

              <!-- Metadata -->
              <div style="background-color: #fafafa; border-left: 4px solid #252525; padding: 16px; margin-bottom: 32px; border-radius: 6px;">
                <table width="100%" cellpadding="4" cellspacing="0">
                  <tr>
                    <td style="color: #8e8e8e; font-size: 14px; font-weight: 500; padding: 4px 0;">Submission ID:</td>
                    <td style="color: #252525; font-size: 14px; font-family: 'Courier New', monospace; padding: 4px 0;">${submission.id}</td>
                  </tr>
                  <tr>
                    <td style="color: #8e8e8e; font-size: 14px; font-weight: 500; padding: 4px 0;">Received:</td>
                    <td style="color: #252525; font-size: 14px; padding: 4px 0;">${timestamp}</td>
                  </tr>
                </table>
              </div>

              <!-- Submission Data -->
              <h2 style="margin: 0 0 16px 0; color: #252525; font-size: 18px; font-weight: 600;">
                Submitted Data
              </h2>

              ${submissionHtml}

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #fafafa; padding: 24px 32px; text-align: center; border-top: 1px solid #ebebeb;">
              <p style="margin: 0; color: #8e8e8e; font-size: 14px;">
                Sent by <strong style="color: #595959;">FormZero</strong>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `.trim(),
    })

    return { success: true }
  } catch (error) {
    console.error("Error sending notification email:", error)
    return { success: false, error: describeError(error) }
  }
}

/**
 * Formats submission data as HTML table
 */
function formatSubmissionData(data: Record<string, any>): string {
  const entries = Object.entries(data)

  if (entries.length === 0) {
    return '<p style="color: #8e8e8e; font-style: italic;">No data submitted</p>'
  }

  const rows = entries
    .map(([key, value]) => {
      const displayKey =
        FIELD_LABELS.get(key) ?? key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())

      let displayValue = formatValue(value)

      return `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #ebebeb; color: #8e8e8e; font-size: 14px; font-weight: 500; vertical-align: top; width: 35%;">
            ${escapeHtml(displayKey)}
          </td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #ebebeb; color: #252525; font-size: 14px; vertical-align: top;">
            ${displayValue}
          </td>
        </tr>
      `
    })
    .join('')

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #ebebeb; border-radius: 6px; overflow: hidden;">
      ${rows}
    </table>
  `
}

/**
 * Formats submission data as plain text
 */
function formatSubmissionDataText(data: Record<string, any>): string {
  const entries = Object.entries(data)

  if (entries.length === 0) {
    return 'No data submitted'
  }

  return entries
    .map(([key, value]) => {
      const displayKey =
        FIELD_LABELS.get(key) ?? key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())

      return `${displayKey}: ${formatValueText(value)}`
    })
    .join('\n')
}

/**
 * Formats a value for HTML display
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return '<span style="color: #b4b4b4; font-style: italic;">Not provided</span>'
  }

  if (typeof value === 'boolean') {
    return value ? '✓ Yes' : '✗ No'
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '<span style="color: #b4b4b4; font-style: italic;">Empty list</span>'
    }
    return '<ul style="margin: 0; padding-left: 20px;">' +
      value.map(item => `<li>${escapeHtml(String(item))}</li>`).join('') +
      '</ul>'
  }

  if (typeof value === 'object') {
    return '<pre style="margin: 0; padding: 8px; background-color: #fafafa; border-radius: 6px; font-size: 13px; overflow-x: auto; color: #252525;">' +
      escapeHtml(JSON.stringify(value, null, 2)) +
      '</pre>'
  }

  // Check if it looks like a URL
  const stringValue = String(value)
  if (stringValue.match(/^https?:\/\//)) {
    return `<a href="${escapeHtml(stringValue)}" style="color: #252525; text-decoration: underline;">${escapeHtml(stringValue)}</a>`
  }

  // Check if it looks like an email
  if (stringValue.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return `<a href="mailto:${escapeHtml(stringValue)}" style="color: #252525; text-decoration: underline;">${escapeHtml(stringValue)}</a>`
  }

  return escapeHtml(stringValue)
}

/**
 * Formats a value for plain text display
 */
function formatValueText(value: any): string {
  if (value === null || value === undefined) {
    return '(Not provided)'
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '(Empty list)'
    }
    return '\n  - ' + value.map(item => String(item)).join('\n  - ')
  }

  if (typeof value === 'object') {
    return '\n' + JSON.stringify(value, null, 2)
  }

  return String(value)
}

/**
 * Escapes HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}
