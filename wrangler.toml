-- MedPrompt D1 schema.
-- Audio is NEVER stored. Only transcribed text and coverage metadata persist,
-- matching the scribe-tool governance model.

CREATE TABLE IF NOT EXISTS guides (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,        -- full guide JSON
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  guide_id    TEXT NOT NULL,
  transcript  TEXT,                 -- text only; no audio
  covered     TEXT,                 -- JSON array of covered step ids
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_guide ON sessions (guide_id);
