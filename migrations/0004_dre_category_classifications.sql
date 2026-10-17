-- Per-company classification of transaction categories for the managerial DRE.
CREATE TABLE IF NOT EXISTS dre_category_classifications (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  category TEXT NOT NULL,
  dre_line TEXT NOT NULL CHECK (dre_line IN (
    'revenue','financial_income','other_income',
    'deductions','direct_costs','operating_expenses','financial_expenses','other_expenses'
  )),
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,type,category)
);
