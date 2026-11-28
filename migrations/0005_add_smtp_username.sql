-- Migration number: 0005

-- Some SMTP servers authenticate with a username that is not the mailbox
-- address (Cloudflare Email Service uses the literal `api_token`). Stored
-- NULL means "use notification_email as the login", which keeps existing
-- installations working unchanged.
ALTER TABLE settings ADD COLUMN smtp_username TEXT;
