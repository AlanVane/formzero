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
export function detectSpam(data: Record<string, unknown>): string | null {
  const name = String(data.name ?? "");
  const email = String(data.email ?? "");
  const message = String(data.message ?? "").trim();

  // A human name never contains a link; this is the pattern behind every spam
  // row received so far.
  if (URL_RE.test(name)) return "url_in_name";

  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return "disposable_email_domain";

  // "ke0dy2" style payloads: one short ASCII token, no spaces. ASCII-only on
  // purpose: Chinese has no word spaces, so the previous rule dropped any terse
  // CJK enquiry while the caller was told it had been received.
  if (/^[A-Za-z0-9]{1,10}$/.test(message)) return "token_only_message";

  const urlCount = (
    Object.values(data).map(String).join(" ").match(URL_COUNT_RE) ?? []
  ).length;
  if (urlCount >= 3) return "too_many_urls";

  return null;
}
