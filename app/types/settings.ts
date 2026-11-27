export type Settings = {
  id: string
  notification_email: string | null
  notification_email_password: string | null
  smtp_username: string | null
  smtp_host: string | null
  smtp_port: number | null
  smtp_secure: number
  updated_at: number
}

/** How one deployment hands a message to a mail server. */
export type MailTransport = "cloudflare" | "smtp"

export type EmailConfig = {
  notification_email: string
  /** NULL on deployments that send through the Cloudflare binding. */
  notification_email_password: string | null
  /** NULL means the notification email doubles as the SMTP login. */
  smtp_username: string | null
  smtp_host: string | null
  smtp_port: number | null
}
