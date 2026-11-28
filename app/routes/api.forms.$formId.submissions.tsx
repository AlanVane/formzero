import type { Route } from "./+types/api.forms.$formId.submissions";
import { data, redirect } from "react-router";
import { mailTransport, sendSubmissionNotification } from "~/lib/email.server";
import type { EmailConfig, MailTransport } from "#/types/settings";

// CORS headers to allow submissions from any domain
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400",
};

const URL_RE = /https?:\/\/|www\./i;
const URL_COUNT_RE = /https?:\/\//gi;

// Throwaway mail providers seen in form spam. Deliberately short: add domains
// here only after confirming they cannot be legitimate business addresses.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "euploading.com",
  "mailinator.com",
  "guerrillamail.com",
  "sharklasers.com",
  "trashmail.com",
  "yopmail.com",
  "10minutemail.com",
  "temp-mail.org",
]);

/**
 * Conservative bot heuristics. Returns a reason string when the submission
 * looks automated, otherwise null. Real enquiries are never rejected on weak
 * signals alone (a long message with a link is normal).
 */
function detectSpam(data: Record<string, any>): string | null {
  const name = String(data.name ?? "");
  const email = String(data.email ?? "");
  const message = String(data.message ?? "").trim();

  // A human name never contains a link; this is the pattern behind every spam
  // row received so far.
  if (URL_RE.test(name)) return "url_in_name";

  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return "disposable_email_domain";

  // "ke0dy2" style payloads: one short token, no spaces.
  if (/^\S{1,10}$/.test(message)) return "token_only_message";

  const urlCount = (Object.values(data).map(String).join(" ").match(URL_COUNT_RE) ?? [])
    .length;
  if (urlCount >= 3) return "too_many_urls";

  return null;
}

// Handle preflight OPTIONS requests
export async function loader({ request }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // For non-OPTIONS requests to this endpoint, return method not allowed
  return data(
    { error: "Method not allowed" },
    { status: 405, headers: corsHeaders }
  );
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { formId } = params;
  const db = context.cloudflare.env.DB;

  // Determine if this is a JSON request (used throughout)
  const contentType = request.headers.get("content-type") || "";
  const acceptHeader = request.headers.get("accept") || "";
  const isJsonRequest =
    acceptHeader.includes("application/json") ||
    contentType.includes("application/json");

  try {
    // Check if form exists
    const form = await db
      .prepare("SELECT id FROM forms WHERE id = ?")
      .bind(formId)
      .first();

    if (!form) {
      if (isJsonRequest) {
        return data(
          { success: false, error: "Form not found" },
          { status: 404, headers: corsHeaders }
        );
      }
      return redirect("/error?error=form_not_found");
    }

    // Parse request body based on content type
    let submissionData: Record<string, any>;

    if (contentType.includes("application/json")) {
      submissionData = await request.json();
    } else if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const formData = await request.formData();
      // Collect repeated keys into arrays so multi-select fields are not
      // silently truncated to their last value.
      submissionData = {};
      for (const [key, value] of formData.entries()) {
        const existing = submissionData[key];
        if (existing === undefined) {
          submissionData[key] = value;
        } else if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          submissionData[key] = [existing, value];
        }
      }
    } else {
      if (isJsonRequest) {
        return data(
          { success: false, error: "Unsupported content type" },
          { status: 415, headers: corsHeaders }
        );
      }
      return redirect("/error?error=unsupported_content_type");
    }

    // Generate submission ID and timestamp
    const submissionId = crypto.randomUUID();
    const createdAt = Date.now();

    // Bots that receive an error adapt; drop suspected spam silently and log
    // the reason instead. The response below stays identical to a real success.
    const spamReason = detectSpam(submissionData);
    if (spamReason) {
      console.warn(
        JSON.stringify({ event: "submission_dropped", formId, reason: spamReason })
      );
    }

    // Store submission in database
    if (!spamReason) {
      await db
        .prepare(
          "INSERT INTO submissions (id, form_id, data, created_at) VALUES (?, ?, ?, ?)"
        )
        .bind(submissionId, formId, JSON.stringify(submissionData), createdAt)
        .run();
    }

    // Send email notification asynchronously (don't await to avoid blocking response)
    // This runs in the background after the response is sent
    if (!spamReason)
      context.cloudflare.ctx.waitUntil(
      (async () => {
        try {
          // Fetch global settings
          const globalSettings = await db
            .prepare(
              "SELECT notification_email, notification_email_password, smtp_host, smtp_port, smtp_username, transport FROM settings WHERE id = 'global'"
            )
            .first<{
              notification_email: string | null
              notification_email_password: string | null
              smtp_host: string | null
              smtp_port: number | null
              smtp_username: string | null
              transport: MailTransport | null
            }>();

          // Check if email notifications are configured. The Cloudflare
          // binding needs no SMTP credentials, so only the receiving address
          // is required there.
          const transport = mailTransport(
            context.cloudflare.env,
            globalSettings?.transport ?? null
          );
          const usesCloudflare = transport === "cloudflare";
          if (
            globalSettings?.notification_email &&
            (usesCloudflare ||
              (globalSettings.notification_email_password &&
                globalSettings.smtp_host &&
                globalSettings.smtp_port))
          ) {
            // Fetch form name for email
            const formData = await db
              .prepare("SELECT name FROM forms WHERE id = ?")
              .bind(formId)
              .first<{ name: string }>();

            if (formData) {
              // Type-safe email config (null checks already done above)
              const emailConfig: EmailConfig = {
                notification_email: globalSettings.notification_email,
                notification_email_password: globalSettings.notification_email_password,
                smtp_host: globalSettings.smtp_host,
                smtp_port: globalSettings.smtp_port,
                smtp_username: globalSettings.smtp_username,
                transport,
              };

              await sendSubmissionNotification(
                context.cloudflare.env,
                emailConfig,
                {
                  id: submissionId,
                  formId: formId,
                  formName: formData.name,
                  data: submissionData,
                  createdAt: createdAt,
                }
              );
            }
          }
        } catch (error) {
          // Log error but don't fail the request
          console.error("Failed to send email notification:", error);
        }
      })()
    );

    if (isJsonRequest) {
      // Return JSON response
      return data(
        { success: true, id: submissionId },
        { status: 201, headers: corsHeaders }
      );
    } else {
      // Handle redirect for HTML form submissions
      const url = new URL(request.url);
      const redirectParam = url.searchParams.get("redirect");
      const referer = request.headers.get("referer");

      let redirectUrl: string;

      if (redirectParam) {
        // Path-only redirects resolve against the submitting page's origin, so
        // one form works across multiple domains (?redirect=/thanks).
        if (
          redirectParam.startsWith("/") &&
          !redirectParam.startsWith("//") &&
          referer
        ) {
          try {
            redirectUrl = new URL(redirectParam, referer).href;
          } catch {
            redirectUrl = redirectParam;
          }
        } else {
          redirectUrl = redirectParam;
        }
      } else if (referer) {
        redirectUrl = referer;
      } else {
        redirectUrl = "/success";
      }

      return redirect(redirectUrl, 303);
    }
  } catch (error) {
    console.error("Error processing form submission:", error);

    if (isJsonRequest) {
      return data(
        { success: false, error: "Failed to process submission" },
        { status: 500, headers: corsHeaders }
      );
    } else {
      return redirect("/error?error=internal_error");
    }
  }
}
