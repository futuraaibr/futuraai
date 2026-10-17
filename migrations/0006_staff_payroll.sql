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
