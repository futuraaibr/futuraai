const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "futura-backup-smoke-"));
const sourcePath = path.join(directory, "source.sqlite");
const snapshotPath = path.join(directory, "snapshot.sqlite");
const schema = fs.readFileSync(path.join(__dirname, "../schema.sql"), "utf8");
let source;
try {
  source = new DatabaseSync(sourcePath);
  source.exec(schema);
  source.exec(`
    INSERT INTO tenants(id,name,status,created_at) VALUES('synthetic-tenant','Empresa de Teste','active','2026-10-17T00:00:00Z');
    INSERT INTO users(id,tenant_id,name,email,password_hash,password_salt,role,status,created_at)
      VALUES('synthetic-user','synthetic-tenant','Pessoa Sintética','backup@example.test','hash','salt','owner','active','2026-10-17T00:00:00Z');
    INSERT INTO transactions(id,tenant_id,date,description,type,amount_cents,category,created_at)
      VALUES('synthetic-transaction','synthetic-tenant','2026-10-01','Receita sintética','income',12345,'Teste','2026-10-17T00:00:00Z');
    INSERT INTO transaction_audit(id,tenant_id,actor_id,actor_name,actor_email,action,transaction_id,details,created_at)
      VALUES('synthetic-audit','synthetic-tenant','synthetic-user','Pessoa Sintética','backup@example.test','criado','synthetic-transaction','{"amount_cents":12345}','2026-10-17T00:00:00Z');
  `);
  source.exec(`VACUUM INTO '${snapshotPath.replaceAll("'", "''")}'`);
  source.exec("DELETE FROM transactions WHERE tenant_id='synthetic-tenant'; DELETE FROM transaction_audit WHERE tenant_id='synthetic-tenant';");
  assert.equal(Number(source.prepare("SELECT COUNT(*) AS n FROM transactions").get().n), 0,
    "the source database is intentionally changed after its snapshot");

  const restored = new DatabaseSync(snapshotPath);
  try {
    assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(Number(restored.prepare("SELECT COUNT(*) AS n FROM tenants").get().n), 1);
    assert.equal(Number(restored.prepare("SELECT amount_cents FROM transactions WHERE id='synthetic-transaction'").get().amount_cents), 12345);
    assert.equal(Number(restored.prepare("SELECT COUNT(*) AS n FROM transaction_audit WHERE transaction_id='synthetic-transaction'").get().n), 1);
    assert.equal(Number(restored.prepare("SELECT COUNT(*) AS n FROM users WHERE email='backup@example.test'").get().n), 1);
  } finally { restored.close(); }
  console.log("Backup/restore smoke check passed: synthetic tenant, user, movement, audit and SQLite integrity survived isolated snapshot restoration.");
} finally {
  if (source) source.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
