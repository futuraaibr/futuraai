-- Track changes to company movements and enforce idempotency for imported rows.
ALTER TABLE transactions ADD COLUMN dedupe_key TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_transactions_tenant_dedupe
  ON transactions(tenant_id, dedupe_key) WHERE dedupe_key != '';
CREATE TABLE transaction_audit (
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
CREATE INDEX idx_transaction_audit_tenant_created
  ON transaction_audit(tenant_id, created_at DESC);
