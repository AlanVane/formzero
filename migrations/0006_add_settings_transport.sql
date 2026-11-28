-- Migration number: 0006

-- Which path a message takes: the Cloudflare send binding, or a classic SMTP
-- login. NULL keeps the deployment default, so existing installations behave
-- as before; a stored value lets one installation switch methods from the
-- settings page without a redeploy.
ALTER TABLE settings ADD COLUMN transport TEXT;

-- Installations that already stored an SMTP host were sending through their
-- provider before this column existed. Keep them on that path instead of
-- falling back to the deployment default.
UPDATE settings SET transport = 'smtp' WHERE smtp_host IS NOT NULL;
