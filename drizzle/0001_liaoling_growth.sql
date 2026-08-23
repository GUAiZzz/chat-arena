ALTER TABLE votes ADD COLUMN display_swapped INTEGER NOT NULL DEFAULT 0;
ALTER TABLE votes ADD COLUMN updated_at TEXT;

CREATE TABLE IF NOT EXISTS companions (
  id TEXT PRIMARY KEY,
  rater_id TEXT NOT NULL UNIQUE,
  genome TEXT NOT NULL CHECK (genome IN ('light', 'cloud', 'alien')),
  main_species TEXT,
  main_season_id TEXT,
  lineage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companion_seasons (
  id TEXT PRIMARY KEY,
  companion_id TEXT NOT NULL,
  dataset_version_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('main', 'echo')),
  stage TEXT NOT NULL DEFAULT 'birth' CHECK (stage IN ('birth', 'awakening', 'forming', 'revealed')),
  empathy_score INTEGER NOT NULL DEFAULT 0,
  exploration_score INTEGER NOT NULL DEFAULT 0,
  discernment_score INTEGER NOT NULL DEFAULT 0,
  species TEXT,
  revealed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (companion_id) REFERENCES companions(id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_version_id) REFERENCES dataset_versions(id),
  UNIQUE (companion_id, dataset_version_id)
);

CREATE TABLE IF NOT EXISTS companion_events (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('vote', 'reflection')),
  source_id TEXT NOT NULL,
  milestone INTEGER,
  empathy_delta INTEGER NOT NULL DEFAULT 0,
  exploration_delta INTEGER NOT NULL DEFAULT 0,
  discernment_delta INTEGER NOT NULL DEFAULT 0,
  tone_labels_json TEXT NOT NULL DEFAULT '[]',
  companion_reply TEXT,
  memory_summary TEXT,
  provider TEXT NOT NULL DEFAULT 'rules',
  model TEXT,
  prompt_version TEXT,
  confidence REAL,
  fallback INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (season_id) REFERENCES companion_seasons(id) ON DELETE CASCADE,
  UNIQUE (season_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_companion_seasons_companion
ON companion_seasons(companion_id, dataset_version_id);

CREATE INDEX IF NOT EXISTS idx_companion_events_season
ON companion_events(season_id, created_at);

PRAGMA optimize;
