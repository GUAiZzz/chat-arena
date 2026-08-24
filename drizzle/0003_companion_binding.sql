-- Chat Arena book flow: the final form stays undisclosed until the user binds the season.
ALTER TABLE companion_seasons ADD COLUMN finalized_at TEXT;

PRAGMA optimize;
