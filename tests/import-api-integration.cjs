const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let DatabaseSync;
try { ({ DatabaseSync } = require("node:sqlite")); }
catch {
  console.log("Import API integration test skipped: Node 22.5+ node:sqlite is unavailable.");
  process.exit(0);
}

async function main() {
  const { default: worker } = await import("../worker.js");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(fs.readFileSync(path.join(__dirname, "../schema.sql"), "utf8"));

  const statement = sql => ({
    bind(...params) {
      return {
        sql,
        params,
        async first() { return sqlite.prepare(sql).get(...params) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async run() {
          const result = sqlite.prepare(sql).run(...params);
          return { meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
        }
      };
    }
  });
  const db = {
    prepare: statement,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(item => {
          if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(item.sql)) {
            return { results: sqlite.prepare(item.sql).all(...item.params), meta: { changes: 0 } };
          }
          const result = sqlite.prepare(item.sql).run(...item.params);
          return { results: [], meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
  const env = { DB: db };
  const call = async (pathname, { method = "GET", body, cookie } = {}) => {
    const headers = { Origin: "https://futura.test" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
    const response = await worker.fetch(new Request(`https://futura.test${pathname}`, {
      method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
    }), env);
    let data = {};
    try { data = await response.json(); } catch {}
    return { response, data };
  };
  const registerAndLogin = async (company, email) => {
    const registration = await call("/api/auth/register", { method: "POST", body: {
      name: `Responsável ${company}`, company, email, password: "Senha-Interna-2026!"
    } });
    assert.equal(registration.response.status, 202);
    const user = sqlite.prepare("SELECT id,tenant_id FROM users WHERE email=?").get(email);
    assert(user, "synthetic user should be persisted");
    sqlite.prepare("UPDATE user_reviews SET status='approved' WHERE user_id=?").run(user.id);
    const login = await call("/api/auth/login", { method: "POST", body: { email, password: "Senha-Interna-2026!" } });
    assert.equal(login.response.status, 200);
    const cookie = login.response.headers.get("set-cookie").split(";")[0];
    return { ...user, cookie };
  };

  const companyA = await registerAndLogin("Empresa Sintética A", "a@example.test");
  const companyB = await registerAndLogin("Empresa Sintética B", "b@example.test");
  const csv = "data;descricao;tipo;valor;categoria;centro_custo\n" +
    "2026-10-01;Recebimento de cliente;receita;1.301,10;Serviços;Comercial\n" +
    "2026-10-03;Aluguel;despesa;100,00;Ocupação;Administrativo\n" +
    "2026-10-04;Fornecedor;despesa;200,25;Insumos;Operações";

  const firstImport = await call("/api/transactions/import", { method: "POST", body: csv, cookie: companyA.cookie });
  assert.equal(firstImport.response.status, 200, JSON.stringify(firstImport.data));
  assert.deepEqual(firstImport.data, { imported: 3, skipped_duplicates: 0, inferred_categories: 0 });
  const totals = sqlite.prepare(`SELECT COUNT(*) AS count,
    SUM(CASE WHEN type='income' THEN amount_cents ELSE 0 END) AS income,
    SUM(CASE WHEN type='expense' THEN amount_cents ELSE 0 END) AS expense
    FROM transactions WHERE tenant_id=?`).get(companyA.tenant_id);
  assert.equal(Number(totals.count), 3);
  assert.equal(Number(totals.income), 130110);
  assert.equal(Number(totals.expense), 30025);
  assert.equal(Number(totals.income) - Number(totals.expense), 100085);

  const repeatedImport = await call("/api/transactions/import", { method: "POST", body: csv, cookie: companyA.cookie });
  assert.equal(repeatedImport.response.status, 200);
  assert.deepEqual(repeatedImport.data, { imported: 0, skipped_duplicates: 3, inferred_categories: 0 });
  const audit = sqlite.prepare("SELECT details FROM transaction_audit WHERE tenant_id=? AND action='importado' ORDER BY created_at DESC LIMIT 1").get(companyA.tenant_id);
  assert.equal(JSON.parse(audit.details).inserted, 0);
  assert.equal(JSON.parse(audit.details).duplicates_skipped, 3);

  const invalid = await call("/api/transactions/import", { method: "POST", cookie: companyA.cookie,
    body: "data;descricao;tipo;debito;credito\n2026-10-05;Compra;receita;50,00;0" });
  assert.equal(invalid.response.status, 400);
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM transactions WHERE tenant_id=?").get(companyA.tenant_id).n), 3);

  const sameDataForB = await call("/api/transactions/import", { method: "POST", body: csv, cookie: companyB.cookie });
  assert.equal(sameDataForB.response.status, 200);
  assert.equal(sameDataForB.data.imported, 3, "a separate company must be allowed to import the same transactions");
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM transactions WHERE tenant_id=?").get(companyB.tenant_id).n), 3);
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM transactions WHERE tenant_id=?").get(companyA.tenant_id).n), 3);

  const viewA=await call("/api/transactions?period=all",{cookie:companyA.cookie});
  const viewB=await call("/api/transactions?period=all",{cookie:companyB.cookie});
  assert.equal(viewA.data.summary.count,3);
  assert.equal(viewB.data.summary.count,3);
  assert.equal(viewA.data.summary.income_cents,130110);
  assert.equal(viewB.data.summary.expense_cents,30025);

  sqlite.exec("CREATE TRIGGER fail_transaction_audit BEFORE INSERT ON transaction_audit BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END;");
  const originalConsoleError=console.error;
  console.error=()=>{};
  let failedBatch;
  try {
    failedBatch = await call("/api/transactions/import", { method: "POST", cookie: companyA.cookie,
      body: "data;descricao;tipo;valor\n2026-10-06;Lançamento sintético;despesa;10,00" });
  } finally { console.error=originalConsoleError; }
  assert.equal(failedBatch.response.status, 500);
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM transactions WHERE tenant_id=?").get(companyA.tenant_id).n), 3,
    "failed atomic import must leave no partial transactions");
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM transaction_audit WHERE tenant_id=? AND action='importado'").get(companyA.tenant_id).n), 2,
    "failed import must not append a success audit row");

  sqlite.exec("DROP TRIGGER fail_transaction_audit;");
  const created=await call("/api/transactions",{method:"POST",cookie:companyA.cookie,body:{date:"2026-10-07",description:"Registro privado sintético",type:"expense",amount:25,category:"Teste",cost_center:"Privado"}});
  assert.equal(created.response.status,200,JSON.stringify(created.data));
  const crossUpdate=await call("/api/transactions/"+encodeURIComponent(created.data.id),{method:"PUT",cookie:companyB.cookie,body:{date:"2026-10-07",description:"Alteração indevida",type:"income",amount:250,category:"Teste"}});
  assert.equal(crossUpdate.response.status,404,"another tenant cannot edit this transaction");
  const crossDelete=await call("/api/transactions/"+encodeURIComponent(created.data.id),{method:"DELETE",cookie:companyB.cookie});
  assert.equal(crossDelete.response.status,404,"another tenant cannot delete this transaction");
  const ownUpdate=await call("/api/transactions/"+encodeURIComponent(created.data.id),{method:"PUT",cookie:companyA.cookie,body:{date:"2026-10-07",description:"Registro privado revisado",type:"expense",amount:40,category:"Operação",cost_center:"Privado"}});
  assert.equal(ownUpdate.response.status,200);
  const editAudit=sqlite.prepare("SELECT details FROM transaction_audit WHERE tenant_id=? AND action='editado' ORDER BY created_at DESC LIMIT 1").get(companyA.tenant_id);
  assert(editAudit&&JSON.parse(editAudit.details).before&&JSON.parse(editAudit.details).after,"manual edits must retain before and after values in audit");
  const ownDelete=await call("/api/transactions/"+encodeURIComponent(created.data.id),{method:"DELETE",cookie:companyA.cookie});
  assert.equal(ownDelete.response.status,200);
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM transaction_audit WHERE tenant_id=? AND action='excluído'").get(companyA.tenant_id).n),1,"manual deletion must be audited");
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM transactions WHERE tenant_id=?").get(companyA.tenant_id).n),3);
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM transactions WHERE tenant_id=?").get(companyB.tenant_id).n),3);

  sqlite.prepare("INSERT INTO company_profiles(tenant_id,legal_name,segment,subsegment,updated_at) VALUES(?,?,?,?,?)")
    .run(companyA.tenant_id,"Empresa Sintética A","Tecnologia da informação","Software sob encomenda",new Date().toISOString());
  const monthOffset = offset => {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth()+offset);
    return date.toISOString().slice(0,7);
  };
  for (const [offset,income,expense] of [[-2,10000,6000],[-1,20000,9000]]) {
    const month=monthOffset(offset);
    sqlite.prepare("INSERT INTO transactions(id,tenant_id,date,description,type,amount_cents,category,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(`forecast-income-${offset}`,companyA.tenant_id,`${month}-05`,"Receita sintética", "income",income,"Serviços de software",new Date().toISOString());
    sqlite.prepare("INSERT INTO transactions(id,tenant_id,date,description,type,amount_cents,category,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(`forecast-expense-${offset}`,companyA.tenant_id,`${month}-10`,"Despesa sintética", "expense",expense,"Infraestrutura cloud",new Date().toISOString());
  }
  const previousFetch=global.fetch;
  global.fetch=async()=>new Response("<rss><channel></channel></rss>",{status:200,headers:{"content-type":"application/rss+xml"}});
  const previousConsoleError=console.error;
  let forecast;
  console.error=()=>{};
  try { forecast=await call("/api/ai-forecast",{cookie:companyA.cookie}); }
  finally { global.fetch=previousFetch;console.error=previousConsoleError; }
  assert.equal(forecast.response.status,200,JSON.stringify(forecast.data));
  assert.equal(forecast.data.data_quality.months_with_data,2);
  assert.equal(forecast.data.data_quality.average_income_cents,15000);
  assert.equal(forecast.data.data_quality.revenue_trend_monthly_pct,0);
  assert.equal(forecast.data.data_quality.confidence,"dados_insuficientes");
  assert.equal(forecast.data.growth.revenue_monthly_pct,0,"model must not invent growth when history has missing months");
  assert.equal(forecast.data.analysis_mode,"financial_fallback","forecast should remain usable and labeled if AI is unavailable");
  assert.equal(forecast.data.projection.length,6);
  assert.match(forecast.data.outlook,/faltam meses no histórico/);

  sqlite.close();
  console.log("Import API integration checks passed: login, exact synthetic totals, persistence, idempotent reimport, validation, read/write tenant isolation, audit consistency, atomic rollback, and sparse-history AI fallback.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
