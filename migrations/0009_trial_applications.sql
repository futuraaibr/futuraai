ALTER TABLE tenants ADD COLUMN trial_started_at TEXT;
ALTER TABLE tenants ADD COLUMN trial_ends_at TEXT;

CREATE TABLE IF NOT EXISTS trial_applications (
  id TEXT PRIMARY KEY,
  responsible_name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  legal_name TEXT NOT NULL DEFAULT '',
  cnpj TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  segment TEXT NOT NULL,
  subsegment TEXT NOT NULL,
  employee_range TEXT NOT NULL DEFAULT '',
  main_challenge TEXT NOT NULL DEFAULT '',
  consent_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_email','activated','expired')),
  verification_token_hash TEXT NOT NULL DEFAULT '',
  verification_expires_at TEXT NOT NULL,
  verification_sent_at TEXT,
  verified_at TEXT,
  trial_starts_at TEXT,
  trial_ends_at TEXT,
  tenant_id TEXT REFERENCES tenants(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trial_applications_created ON trial_applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trial_applications_status ON trial_applications(status,created_at DESC);