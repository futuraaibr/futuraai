PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'Essencial — homologação',
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'finance')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  competence_date TEXT,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  category TEXT NOT NULL,
  category_source TEXT NOT NULL DEFAULT 'provided' CHECK (category_source IN ('provided', 'inferred')),
  account_name TEXT NOT NULL DEFAULT '',
  account_code TEXT NOT NULL DEFAULT '',
  counterparty TEXT NOT NULL DEFAULT '',
  cost_center TEXT NOT NULL DEFAULT '',
  document_number TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  payment_date TEXT,
  payment_method TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dre_category_classifications (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  category TEXT NOT NULL,
  dre_line TEXT NOT NULL CHECK (dre_line IN ('revenue','financial_income','other_income','deductions','direct_costs','operating_expenses','financial_expenses','other_expenses')),
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,type,category)
);

CREATE TABLE IF NOT EXISTS transaction_audit (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  transaction_id TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  monthly_growth REAL NOT NULL,
  months INTEGER NOT NULL CHECK (months IN (3, 6, 12)),
  base_cents INTEGER NOT NULL,
  projected_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_token_expiry ON sessions(token_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_date ON transactions(tenant_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_category ON transactions(tenant_id, type, category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_tenant_dedupe ON transactions(tenant_id, dedupe_key) WHERE dedupe_key != '';
CREATE INDEX IF NOT EXISTS idx_transaction_audit_tenant_created ON transaction_audit(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenarios_tenant_created ON scenarios(tenant_id, created_at DESC);

-- Platform administration, account approval, and security audit.
CREATE TABLE IF NOT EXISTS platform_admins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_reviews (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT REFERENCES platform_admins(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  scope_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES platform_admins(id),
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(token_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_user_reviews_status_created ON user_reviews(status, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);

-- Company-specific assumptions used by the transaction-based cash forecast.
CREATE TABLE IF NOT EXISTS forecast_preferences (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  history_months INTEGER NOT NULL DEFAULT 3 CHECK (history_months IN (3, 6)),
  horizon_months INTEGER NOT NULL DEFAULT 6 CHECK (horizon_months IN (3, 6, 12)),
  revenue_growth REAL NOT NULL DEFAULT 0,
  expense_growth REAL NOT NULL DEFAULT 0,
  updated_by_user_id TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

-- Billing visibility and collection settings managed by platform administrators.
CREATE TABLE IF NOT EXISTS company_billing (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  billing_email TEXT NOT NULL DEFAULT '',
  monthly_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (monthly_fee_cents >= 0),
  next_due_date TEXT,
  reminder_enabled INTEGER NOT NULL DEFAULT 0 CHECK (reminder_enabled IN (0,1)),
  reminder_days_before INTEGER NOT NULL DEFAULT 3 CHECK (reminder_days_before IN (0,1,3,5,7)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT 'Assinatura FUTURA AI',
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','canceled')),
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, period)
);

CREATE TABLE IF NOT EXISTS project_financial_entries (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('income','expense')),
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Geral',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  entry_date TEXT NOT NULL,
  created_by_admin_id TEXT NOT NULL REFERENCES platform_admins(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_financial_goals (
  id TEXT PRIMARY KEY CHECK (id='default'),
  target_mrr_cents INTEGER NOT NULL DEFAULT 0 CHECK (target_mrr_cents >= 0),
  expected_new_companies_per_month REAL NOT NULL DEFAULT 1 CHECK (expected_new_companies_per_month >= 0 AND expected_new_companies_per_month <= 1000),
  average_monthly_fee_cents INTEGER NOT NULL DEFAULT 29900 CHECK (average_monthly_fee_cents >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_email_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES billing_invoices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('manual','before_due','due_today')),
  status TEXT NOT NULL CHECK (status IN ('sent','draft','blocked','failed')),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  sent_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_due ON billing_invoices(status,due_date);
CREATE INDEX IF NOT EXISTS idx_billing_invoice_tenant ON billing_invoices(tenant_id,due_date DESC);
CREATE INDEX IF NOT EXISTS idx_project_financial_date ON project_financial_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_billing_email_tenant ON billing_email_log(tenant_id,created_at DESC);

-- Business profile maintained by platform administrators. Segment codes are validated in Worker.
CREATE TABLE IF NOT EXISTS company_profiles (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL DEFAULT '',
  cnpj TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  responsible_name TEXT NOT NULL DEFAULT '',
  responsible_role TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  business_email TEXT NOT NULL DEFAULT '',
  segment TEXT NOT NULL DEFAULT '',
  subsegment TEXT NOT NULL DEFAULT '',
  logo_data_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by_admin_id TEXT REFERENCES platform_admins(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_profiles_cnpj ON company_profiles(cnpj) WHERE cnpj<>'';

-- One cached AI outlook per tenant; bounded daily inference budget protects account usage.
CREATE TABLE IF NOT EXISTS ai_forecast_cache (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  segment TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  report_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_forecast_daily_usage (
  usage_date TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0 AND calls <= 50)
);
CREATE TABLE IF NOT EXISTS company_staff (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('employee','partner')),
  position TEXT NOT NULL DEFAULT '',
  reference_code TEXT NOT NULL DEFAULT '',
  monthly_salary_cents INTEGER NOT NULL DEFAULT 0 CHECK (monthly_salary_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_company_staff_tenant_name ON company_staff(tenant_id,active,full_name);
CREATE TABLE IF NOT EXISTS payroll_monthly_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES company_staff(id) ON DELETE CASCADE,
  reference_month TEXT NOT NULL CHECK (reference_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  taxable_income_cents INTEGER NOT NULL DEFAULT 0 CHECK (taxable_income_cents >= 0),
  thirteenth_income_cents INTEGER NOT NULL DEFAULT 0 CHECK (thirteenth_income_cents >= 0),
  exempt_income_cents INTEGER NOT NULL DEFAULT 0 CHECK (exempt_income_cents >= 0),
  profit_distribution_cents INTEGER NOT NULL DEFAULT 0 CHECK (profit_distribution_cents >= 0),
  social_security_cents INTEGER NOT NULL DEFAULT 0 CHECK (social_security_cents >= 0),
  irrf_cents INTEGER NOT NULL DEFAULT 0 CHECK (irrf_cents >= 0),
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,staff_id,reference_month),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(staff_id,tenant_id) REFERENCES company_staff(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payroll_tenant_month ON payroll_monthly_records(tenant_id,reference_month);
CREATE TABLE IF NOT EXISTS staff_audit (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  staff_id TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_audit_tenant_created ON staff_audit(tenant_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_staff_id_tenant ON company_staff(id,tenant_id);
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
