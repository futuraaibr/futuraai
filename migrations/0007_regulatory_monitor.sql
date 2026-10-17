CREATE TABLE IF NOT EXISTS regulatory_monitor_runs (
  year_month TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL,
  sources_checked TEXT NOT NULL DEFAULT '',
  result_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS regulatory_updates (
  id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL DEFAULT '',
  discovered_at TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_regulatory_updates_date ON regulatory_updates(published_at DESC,discovered_at DESC);
