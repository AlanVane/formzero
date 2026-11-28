-- Migration number: 0007

-- Submissions the spam heuristic held back. They are never inserted into
-- `submissions` and never emailed, but dropping them outright made a false
-- positive unrecoverable and invisible: a terse Chinese enquiry (报价多少) was
-- dropped while the visitor was told it had been received. Keeping the row
-- separately lets the operator look, and gives the heuristic something to be
-- tuned against.

CREATE TABLE IF NOT EXISTS dropped_submissions (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL,
    data TEXT NOT NULL, -- JSON stored as TEXT, same shape as submissions.data
    reason TEXT NOT NULL, -- url_in_name | disposable_email_domain | token_only_message | too_many_urls
    created_at INTEGER NOT NULL,
    FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dropped_form_id ON dropped_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_dropped_form_created ON dropped_submissions(form_id, created_at);
