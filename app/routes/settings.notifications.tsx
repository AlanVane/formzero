import { requireAuth } from "~/lib/require-auth.server"
import { mailTransport } from "~/lib/email.server"
import type { Route } from "./+types/settings.notifications"
import { data } from "react-router"

export async function loader({ context, request }: Route.LoaderArgs) {
  const database = context.cloudflare.env.DB

  // Fetch global settings
  const settings = await database
    .prepare("SELECT * FROM settings WHERE id = 'global'")
    .first()

  return data({
    settings: settings || null,
    // The dialog hides the SMTP fields when Cloudflare sends on this
    // deployment's behalf; the same switch decides validation below.
    cloudflareSending: mailTransport(context.cloudflare.env) === "cloudflare",
  })
}

export async function action({ request, context }: Route.ActionArgs) {
  const database = context.cloudflare.env.DB

  await requireAuth(request, database)

  // Handle DELETE request - clear settings
  if (request.method === "DELETE") {
    try {
      await database
        .prepare("DELETE FROM settings WHERE id = 'global'")
        .run()

      return data({ success: true }, { status: 200 })
    } catch (error) {
      console.error("Error clearing settings:", error)
      return data(
        { success: false, error: "Failed to clear settings" },
        { status: 500 }
      )
    }
  }

  // Handle POST request - save settings
  if (request.method !== "POST") {
    return data(
      { success: false, error: "Method not allowed" },
      { status: 405 }
    )
  }

  try {
    // Parse form data
    const formData = await request.formData()
    const notification_email = formData.get("notification_email") as string
    const field = (name: string) =>
      ((formData.get(name) as string | null) ?? "").trim() || null
    const notification_email_password = field("notification_email_password")
    const smtp_host = field("smtp_host")
    const smtp_port = field("smtp_port")
    const smtp_username = field("smtp_username")

    // Validate required fields. The Cloudflare binding sends without SMTP
    // credentials, so only the receiving address is required there.
    const usesCloudflare = mailTransport(context.cloudflare.env) === "cloudflare"
    const isComplete =
      Boolean(notification_email) &&
      (usesCloudflare ||
        Boolean(notification_email_password && smtp_host && smtp_port))

    if (!isComplete) {
      return data(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Cloudflare mode stores no SMTP credentials: the binding carries the
    // authority to send, and a mailbox password or bearer token sitting in D1
    // would only be a liability.
    const storedPassword = usesCloudflare ? null : notification_email_password
    const storedHost = usesCloudflare ? null : smtp_host
    const storedPort = usesCloudflare
      ? null
      : smtp_port
        ? parseInt(smtp_port, 10)
        : null
    const storedUsername = usesCloudflare ? null : smtp_username

    // Check if global settings already exist
    const existingSettings = await database
      .prepare("SELECT id FROM settings WHERE id = 'global'")
      .first()

    const updatedAt = Date.now()

    if (existingSettings) {
      // Update existing settings
      await database
        .prepare(`
          UPDATE settings
          SET notification_email = ?,
              notification_email_password = ?,
              smtp_host = ?,
              smtp_port = ?,
              smtp_username = ?,
              smtp_secure = 1,
              updated_at = ?
          WHERE id = 'global'
        `)
        .bind(
          notification_email,
          storedPassword,
          storedHost,
          storedPort,
          storedUsername,
          updatedAt
        )
        .run()
    } else {
      // Create new global settings
      await database
        .prepare(`
          INSERT INTO settings (
            id,
            notification_email,
            notification_email_password,
            smtp_host,
            smtp_port,
            smtp_username,
            smtp_secure,
            updated_at
          ) VALUES ('global', ?, ?, ?, ?, ?, 1, ?)
        `)
        .bind(
          notification_email,
          storedPassword,
          storedHost,
          storedPort,
          storedUsername,
          updatedAt
        )
        .run()
    }

    return data({ success: true }, { status: 200 })
  } catch (error) {
    console.error("Error saving settings:", error)
    return data(
      { success: false, error: "Failed to save settings" },
      { status: 500 }
    )
  }
}
