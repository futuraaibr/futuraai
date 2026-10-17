-- Additive, reversible per-tenant overrides for the expanded managerial DRE chart.
-- Legacy classifications remain intact and are read as fallback.
CREATE TABLE IF NOT EXISTS dre_category_overrides (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  category TEXT NOT NULL,
  dre_line TEXT NOT NULL CHECK (dre_line IN (
    'revenue','deductions','direct_costs','commercial_expenses',
    'administrative_expenses','operating_expenses','other_operating_income',
    'other_operating_expenses','depreciation','financial_income',
    'financial_expenses','other_income','other_expenses','income_taxes',
    'excluded','unclassified'
  )),
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,type,category)
);
