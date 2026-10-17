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
  const customPeriod=await call("/api/transactions?period=custom&from=2026-10-01&to=2026-10-01",{cookie:companyA.cookie});
  assert.equal(customPeriod.data.summary.count,1);
  assert.equal(customPeriod.data.transactions.length,1);
  assert.equal(customPeriod.data.summary.income_cents,customPeriod.data.transactions.reduce((sum,row)=>sum+(row.type==="income"?row.amount_cents:0),0),"period summary must reconcile to its listed movements");
  for(const period of ["30","60","90"]){
    const filtered=await call(`/api/transactions?period=${period}`,{cookie:companyA.cookie});
    const listedIncome=filtered.data.transactions.filter(row=>row.type==="income").reduce((sum,row)=>sum+row.amount_cents,0);
    const listedExpense=filtered.data.transactions.filter(row=>row.type==="expense").reduce((sum,row)=>sum+row.amount_cents,0);
    assert.equal(filtered.data.summary.income_cents,listedIncome,`${period}-day income summary must reconcile with listed rows`);
    assert.equal(filtered.data.summary.expense_cents,listedExpense,`${period}-day expense summary must reconcile with listed rows`);
  }
  const dashboardA=await call("/api/dashboard?year=2026",{cookie:companyA.cookie});
  assert.equal(dashboardA.data.income_cents,130110);
  assert.equal(dashboardA.data.expense_cents,30025);
  assert.equal(dashboardA.data.net_cents,100085);
  assert.equal(dashboardA.data.count,3);

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
  const dreA=await call("/api/dre?from=2026-10-01&to=2026-10-31",{cookie:companyA.cookie});
  const dreB=await call("/api/dre?from=2026-10-01&to=2026-10-31",{cookie:companyB.cookie});
  assert(dreA.data.details.some(row=>row.id===created.data.id),"company A DRE should include its own manual movement");
  assert(!dreB.data.details.some(row=>row.id===created.data.id),"company B DRE must not expose company A movements");
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
  sqlite.prepare("INSERT INTO company_profiles(tenant_id,legal_name,segment,subsegment,updated_at) VALUES(?,?,?,?,?)")
    .run(companyB.tenant_id,"Empresa Sintética B","Financeiro","Fintech de crédito",new Date().toISOString());
  const profileA=await call("/api/company/profile",{cookie:companyA.cookie});
  const profileB=await call("/api/company/profile",{cookie:companyB.cookie});
  assert.equal(profileA.data.profile.segment,"Tecnologia da informação");
  assert.equal(profileB.data.profile.segment,"Financeiro");
  const staffCreated=await call("/api/staff",{method:"POST",cookie:companyA.cookie,body:{full_name:"Pessoa Sintética A",kind:"employee",position:"Analista",reference_code:"SYN-A-01",monthly_salary:"3500,00"}});
  assert.equal(staffCreated.response.status,200);
  const staffA=await call("/api/staff",{cookie:companyA.cookie});
  const staffB=await call("/api/staff",{cookie:companyB.cookie});
  assert.equal(staffA.data.staff.length,1);
  assert.equal(staffB.data.staff.length,0,"another company cannot view employee or salary records");
  const foreignPayroll=await call("/api/payroll",{method:"POST",cookie:companyB.cookie,body:{staff_id:staffCreated.data.id,reference_month:"2026-09",taxable_income:"3500,00"}});
  assert.equal(foreignPayroll.response.status,400,"another company cannot create payroll for this employee");
  const payrollSaved=await call("/api/payroll",{method:"POST",cookie:companyA.cookie,body:{staff_id:staffCreated.data.id,reference_month:"2026-09",taxable_income:"3500,00",social_security:"385,00",irrf:"75,00"}});
  assert.equal(payrollSaved.response.status,200,JSON.stringify(payrollSaved.data));
  const payrollA=await call("/api/payroll?year=2026",{cookie:companyA.cookie});
  const payrollB=await call("/api/payroll?year=2026",{cookie:companyB.cookie});
  assert.equal(payrollA.data.staff[0].months[0].taxable_income_cents,350000);
  assert.equal(payrollB.data.staff.length,0);
  sqlite.prepare("UPDATE users SET role='finance' WHERE id=?").run(companyB.id);
  const financeStaff=await call("/api/staff",{cookie:companyB.cookie});
  const financePayroll=await call("/api/payroll?year=2026",{cookie:companyB.cookie});
  assert.equal(financeStaff.response.status,403,"finance role cannot access employee salary roster");
  assert.equal(financePayroll.response.status,403,"finance role cannot access annual income reports");
  sqlite.prepare("UPDATE users SET role='owner' WHERE id=?").run(companyB.id);

  const originalFeedFetch=global.fetch;
  global.fetch=async input=>{
    const query=new URL(String(input)).searchParams.get("q")||"";
    const item=(title,url,date="Sat, 17 Oct 2026 09:00:00 GMT")=>`<item><title>${title}</title><link>${url}</link><pubDate>${date}</pubDate><source>Portal Sintético</source></item>`;
    const lower=query.toLocaleLowerCase("pt-BR");
    const rss=lower.includes("software sob encomenda")?`<rss><channel>${item("Mercado de software sob encomenda cresce no Brasil","https://news.google.com/rss/articles/software-a")}${item("Mercado de software sob encomenda cresce no Brasil","https://news.google.com/rss/articles/software-a")}${item("Software sob encomenda em janeiro","https://news.google.com/rss/articles/software-old","Thu, 01 Jan 2026 09:00:00 GMT")}${item("Banco anuncia novas taxas de juros","https://news.google.com/rss/articles/bank-a")}</channel></rss>`:lower.includes("fintech de crédito")?`<rss><channel>${item("Fintech de crédito amplia serviços financeiros para empresas","https://news.google.com/rss/articles/finance-b")}</channel></rss>`:"<rss><channel></channel></rss>";
    return new Response(rss,{status:200,headers:{"content-type":"application/rss+xml"}});
  };
  let newsA,newsB;
  try{
    newsA=await call("/api/sector-news",{cookie:companyA.cookie});
    newsB=await call("/api/sector-news",{cookie:companyB.cookie});
  }finally{global.fetch=originalFeedFetch;}
  assert.equal(newsA.data.status.level,"segment");
  assert.equal(newsB.data.status.level,"segment");
  assert.equal(newsA.data.items.length,1,"duplicate, old and unrelated headlines must be removed");
  assert.match(newsA.data.items[0].title,/software sob encomenda/i);
  assert.match(newsB.data.items[0].title,/fintech de crédito/i);
  assert.notEqual(newsA.data.items[0].title,newsB.data.items[0].title,"sector news must be independently selected per tenant");
  global.fetch=async()=>{throw new Error("synthetic feed outage")};
  let unavailableNews;
  try{unavailableNews=await call("/api/sector-news",{cookie:companyA.cookie});}
  finally{global.fetch=originalFeedFetch;}
  assert.equal(unavailableNews.data.status.reason,"live_search_fallback");
  assert.equal(unavailableNews.data.status.source_reason,"provider_unavailable","provider outage must be distinct from a valid feed with no recent articles");

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
  assert.equal(forecast.data.news_status.reason,"live_search_fallback");
  assert.equal(forecast.data.news_status.source_reason,"no_recent_results");
  assert.equal(forecast.data.news[0].is_search_link,true,"an empty feed must be labeled as a live search, never as a published article");

  sqlite.close();
  console.log("API integration checks passed: exact synthetic totals, period/dashboard reconciliation, DRE/staff/payroll tenant isolation, personalized news, idempotent import, audit consistency, atomic rollback, zero payroll amounts, and sparse-history AI fallback.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
