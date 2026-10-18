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

  const statement = sql => {
    const bind = (...params) => ({
        sql,
        params,
        async first() { return sqlite.prepare(sql).get(...params) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async run() {
          const result = sqlite.prepare(sql).run(...params);
          return { meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
        }
    });
    return { bind, first: () => bind().first(), all: () => bind().all(), run: () => bind().run() };
  };
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
  const call = async (pathname, { method = "GET", body, cookie, omitOrigin = false, origin = "https://futura.test" } = {}) => {
    const headers = {};
    if (!omitOrigin) headers.Origin = origin;
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
    const password = "Senha-Interna-2026!", now = new Date().toISOString();
    const tenantId = "tenant-" + email.split("@")[0], userId = "user-" + email.split("@")[0];
    const salt = "salt-" + email.split("@")[0];
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 100000, hash: "SHA-256" }, key, 256);
    const hash = [...new Uint8Array(bits)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    sqlite.prepare("INSERT INTO tenants(id,name,plan,status,created_at) VALUES(?,?,?,'active',?)").run(tenantId, company, "Essencial — homologação", now);
    sqlite.prepare("INSERT INTO users(id,tenant_id,name,email,password_hash,password_salt,role,status,created_at) VALUES(?,?,?,?,?,?,'owner','active',?)")
      .run(userId, tenantId, "Responsável " + company, email, hash, salt, now);
    sqlite.prepare("INSERT INTO user_reviews(user_id,status,reviewed_at,created_at) VALUES(?,'approved',?,?)").run(userId, now, now);
    const user = { id: userId, tenant_id: tenantId };
    const login = await call("/api/auth/login", { method: "POST", body: { email, password } });
    assert.equal(login.response.status, 200);
    assert.match(login.response.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Strict/,
      "company session cookies must be protected from script access and cross-site use");
    const cookie = login.response.headers.get("set-cookie").split(";")[0];
    return { ...user, cookie };
  };
  const companyA = await registerAndLogin("Empresa Sintética A", "a@example.test");
  const companyB = await registerAndLogin("Empresa Sintética B", "b@example.test");
  for(let attempt=1;attempt<=9;attempt++){
    const denied=await call("/api/auth/login",{method:"POST",body:{email:"brute-force@example.test",password:"Senha-errada"}});
    assert.equal(denied.response.status,attempt<=8?401:429,"company login must enforce its documented 15-minute attempt limit");
  }
  for(let attempt=1;attempt<=9;attempt++){
    const denied=await call("/api/admin/login",{method:"POST",body:{email:"admin-brute-force@example.test",password:"Senha-errada"}});
    assert.equal(denied.response.status,attempt<=8?401:429,"admin login must enforce its documented 15-minute attempt limit");
  }
  const missingOriginRegistration=await call("/api/auth/register",{method:"POST",omitOrigin:true,body:{name:"Bloqueado",company:"Bloqueada",email:"sem-origem@example.test",password:"Senha-Interna-2026!"}});
  const foreignOriginRegistration=await call("/api/auth/register",{method:"POST",origin:"https://attacker.example",body:{name:"Bloqueado",company:"Bloqueada",email:"origem-estranha@example.test",password:"Senha-Interna-2026!"}});
  assert.equal(missingOriginRegistration.response.status,403,"cookie-authenticated mutation routes must reject requests without Origin");
  assert.equal(foreignOriginRegistration.response.status,403,"mutation routes must reject cross-origin requests");
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@example.test'").get().n),2,
    "origin-rejected registrations must not create accounts");

  const unavailable = await call("/api/trial/availability");
  assert.equal(unavailable.data.email_ready, false, "trial email signup must stay closed until a verified sender is configured");
  const leadInput = {
    responsible_name: "Responsável Trial", company_name: "Empresa Trial Sintética", legal_name: "Empresa Trial Sintética Ltda",
    cnpj: "98765432000198", email: "trial@example.test", phone: "65999990000",
    segment: "Serviços", subsegment: "Tecnologia e software", employee_range: "1 a 5",
    main_challenge: "Planejar o caixa", consent: true
  };
  const blockedTrial = await call("/api/trial/apply", { method: "POST", body: leadInput });
  assert.equal(blockedTrial.response.status, 503);
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM trial_applications").get().n), 0,
    "a form must not claim to send verification when the sender is unavailable");

  let verificationMessage = null;
  env.EMAIL = { send: async message => { verificationMessage = message; } };
  env.TRIAL_FROM_EMAIL = "noreply@example.test";
  env.TRIAL_EMAIL_VERIFIED = "true";
  assert.equal((await call("/api/trial/availability")).data.email_ready, true);
  const requestTrial = await call("/api/trial/apply", { method: "POST", body: leadInput });
  assert.equal(requestTrial.response.status, 202, JSON.stringify(requestTrial.data));
  assert.equal(verificationMessage.to, leadInput.email);
  const tokenMatch = verificationMessage.text.match(/https:\/\/futura\.test\/\?ativar=([a-f0-9]{64})/);
  assert(tokenMatch, "the validation email must contain a one-time activation URL");
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE email=?").get(leadInput.email).n), 0,
    "no credentials or company user should exist before email validation");
  const activateTrial = await call("/api/trial/activate", {
    method: "POST", body: { token: tokenMatch[1], password: "Senha-Trial-2026!" }
  });
  assert.equal(activateTrial.response.status, 200, JSON.stringify(activateTrial.data));
  const trialUser = sqlite.prepare("SELECT u.id,u.tenant_id,t.trial_started_at,t.trial_ends_at FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.email=?").get(leadInput.email);
  assert(trialUser, "email validation must create the business login");
  assert.equal(sqlite.prepare("SELECT status FROM user_reviews WHERE user_id=?").get(trialUser.id).status, "approved");
  const duration = Date.parse(trialUser.trial_ends_at) - Date.parse(trialUser.trial_started_at);
  assert.equal(duration, 60 * 86400000, "the trial end date must be exactly 60 days after activation");
  const trialProfile = sqlite.prepare("SELECT segment,subsegment,business_email FROM company_profiles WHERE tenant_id=?").get(trialUser.tenant_id);
  assert.equal(trialProfile.segment, "Serviços");
  assert.equal(trialProfile.subsegment, "Tecnologia e software");
  assert.equal(trialProfile.business_email, leadInput.email);
  const trialLogin = await call("/api/auth/login", { method: "POST", body: { email: leadInput.email, password: "Senha-Trial-2026!" } });
  assert.equal(trialLogin.response.status, 200, "verified users must be able to use their trial immediately");
  const reusedLink = await call("/api/trial/activate", {
    method: "POST", body: { token: tokenMatch[1], password: "Senha-Trial-2026!" }
  });
  assert.equal(reusedLink.response.status, 410, "activation links must be single-use");

  const adminToken = "a".repeat(64);
  const adminDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(adminToken));
  const adminTokenHash = [...new Uint8Array(adminDigest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const adminPassword="Senha-Admin-Interna-2026!",adminSalt="salt-synthetic";
  const adminKey=await crypto.subtle.importKey("raw",new TextEncoder().encode(adminPassword),"PBKDF2",false,["deriveBits"]);
  const adminPasswordBits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:new TextEncoder().encode(adminSalt),iterations:100000,hash:"SHA-256"},adminKey,256);
  const adminPasswordHash=[...new Uint8Array(adminPasswordBits)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  sqlite.prepare("INSERT INTO platform_admins(id,name,email,password_hash,password_salt,status,created_at) VALUES(?,?,?,?,?,'active',?)")
    .run("admin-synthetic", "Admin Sintético", "admin@example.test", adminPasswordHash, adminSalt, new Date().toISOString());
  sqlite.prepare("INSERT INTO admin_sessions(id,admin_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)")
    .run("admin-session-synthetic", "admin-synthetic", adminTokenHash, new Date(Date.now() + 3600000).toISOString(), new Date().toISOString());
  const adminCookie = `futura_admin_session=${adminToken}`;
  const adminLogin=await call("/api/admin/login",{method:"POST",body:{email:"admin@example.test",password:adminPassword}});
  assert.equal(adminLogin.response.status,200,"administrator must be able to establish a session with valid credentials");
  assert.match(adminLogin.response.headers.get("set-cookie"),/HttpOnly; Secure; SameSite=Strict/,
    "administrator session cookies must use protective attributes");
  const realAdminCookie=adminLogin.response.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("/api/admin/me",{cookie:realAdminCookie})).response.status,200);
  assert.equal((await call("/api/admin/logout",{method:"POST",cookie:realAdminCookie,body:{}})).response.status,200);
  assert.equal((await call("/api/admin/me",{cookie:realAdminCookie})).response.status,401,
    "administrator logout must invalidate its own session");
  const blockedAdmin = await call("/api/admin/companies");
  assert.equal(blockedAdmin.response.status, 401, "administrative routes must reject unauthenticated requests");
  const segmentCatalog = await call("/api/admin/segments", { cookie: adminCookie });
  assert(segmentCatalog.data.sectors.some(group => group.name === "Serviços" && group.children.includes("Tecnologia e software")));

  const createdCompany = await call("/api/admin/companies", { method: "POST", cookie: adminCookie, body: {
    company: "Empresa Sintética C", owner_name: "Responsável Sintético", email: "c@example.test",
    plan: "Profissional", segment: "Serviços", subsegment: "Tecnologia e software"
  } });
  assert.equal(createdCompany.response.status, 201, JSON.stringify(createdCompany.data));
  assert(createdCompany.data.temporary_password.length >= 20, "new company credentials must be generated once for the administrator");
  const companyList = await call("/api/admin/companies", { cookie: adminCookie });
  assert(companyList.data.companies.some(company => company.name === "Empresa Sintética C"));
  const companyC = sqlite.prepare("SELECT id,tenant_id FROM users WHERE email='c@example.test'").get();
  const invalidProfile = await call(`/api/admin/companies/${encodeURIComponent(companyC.tenant_id)}/profile`, {
    method: "PUT", cookie: adminCookie, body: { name: "Empresa Sintética C", segment: "Serviços", subsegment: "Financeiro" }
  });
  assert.equal(invalidProfile.response.status, 400, "an invalid segment pairing must not be saved");
  const profileSaved = await call(`/api/admin/companies/${encodeURIComponent(companyC.tenant_id)}/profile`, {
    method: "PUT", cookie: adminCookie, body: {
      name: "Empresa Sintética C Atualizada", legal_name: "Empresa Sintética C Ltda", cnpj: "12345678000199",
      address: "Rua de Testes, 10", city: "São Paulo", state: "SP", postal_code: "01000000",
      responsible_name: "Responsável Sintético", responsible_role: "Sócio", phone: "11999990000",
      business_email: "financeiro@example.test", segment: "Serviços", subsegment: "Tecnologia e software",
      logo_data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pU8AAAAASUVORK5CYII="
    }
  });
  assert.equal(profileSaved.response.status, 200, JSON.stringify(profileSaved.data));
  assert.equal(profileSaved.data.profile.cnpj, "12345678000199");
  assert.equal(profileSaved.data.profile.subsegment, "Tecnologia e software");
  assert.equal(profileSaved.data.profile.logo_data_url,"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pU8AAAAASUVORK5CYII=");
  const svgLogo=await call(`/api/admin/companies/${encodeURIComponent(companyC.tenant_id)}/profile`,{method:"PUT",cookie:adminCookie,body:{name:"Empresa Sintética C Atualizada",segment:"Serviços",subsegment:"Tecnologia e software",logo_data_url:"data:image/svg+xml;base64,PHN2Zz4="}});
  assert.equal(svgLogo.response.status,400,"active content such as SVG must not be accepted as a company logo");
  const oversizedLogo=await call(`/api/admin/companies/${encodeURIComponent(companyC.tenant_id)}/profile`,{method:"PUT",cookie:adminCookie,body:{name:"Empresa Sintética C Atualizada",segment:"Serviços",subsegment:"Tecnologia e software",logo_data_url:`data:image/png;base64,${"A".repeat(210001)}`}});
  assert.equal(oversizedLogo.response.status,400,"oversized company logos must be rejected before saving");
  const profileAfterRejectedLogos=await call(`/api/admin/companies/${encodeURIComponent(companyC.tenant_id)}/profile`,{cookie:adminCookie});
  assert.equal(profileAfterRejectedLogos.data.profile.logo_data_url,profileSaved.data.profile.logo_data_url,
    "rejected logo uploads must leave the previously saved company branding intact");
  assert(sqlite.prepare("SELECT 1 FROM admin_audit WHERE admin_id=? AND action='perfil_empresa_atualizado'").get("admin-synthetic"));

  const usersList = await call("/api/admin/users", { cookie: adminCookie });
  assert(usersList.data.users.some(user => user.id === companyC.id && user.review_status === "approved"));
  const resetPassword = await call(`/api/admin/users/${encodeURIComponent(companyC.id)}/reset-password`, { method: "POST", cookie: adminCookie, body: {} });
  assert.equal(resetPassword.response.status, 200);
  assert(resetPassword.data.temporary_password.length >= 20);
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?").get(companyC.id).n), 0,
    "password reset must invalidate existing user sessions");
  const disabledUser = await call(`/api/admin/users/${encodeURIComponent(companyC.id)}`, { method: "PATCH", cookie: adminCookie, body: { status: "disabled" } });
  assert.equal(disabledUser.response.status, 200);
  assert.equal(sqlite.prepare("SELECT status FROM users WHERE id=?").get(companyC.id).status, "disabled");

  const noEmailReminder = await call(`/api/admin/finance/companies/${encodeURIComponent(companyA.tenant_id)}`, {
    method: "PUT", cookie: adminCookie, body: { billing_email: "cobranca@example.test", monthly_fee: 300, due_date: "2026-11-10", reminder_enabled: true, reminder_days_before: 3 }
  });
  assert.equal(noEmailReminder.response.status, 503, "automatic reminders must stay disabled without the email provider");
  const billingSaved = await call(`/api/admin/finance/companies/${encodeURIComponent(companyA.tenant_id)}`, {
    method: "PUT", cookie: adminCookie, body: { billing_email: "cobranca@example.test", monthly_fee: 300, due_date: "2026-11-10", reminder_enabled: false, reminder_days_before: 3 }
  });
  assert.equal(billingSaved.response.status, 200, JSON.stringify(billingSaved.data));
  const invoice = sqlite.prepare("SELECT id,amount_cents,status FROM billing_invoices WHERE tenant_id=? AND period='2026-11'").get(companyA.tenant_id);
  assert.equal(invoice.amount_cents, 30000);
  const manualReminder = await call(`/api/admin/finance/invoices/${encodeURIComponent(invoice.id)}/send`, { method: "POST", cookie: adminCookie, body: {} });
  assert.equal(manualReminder.response.status, 200);
  assert.equal(manualReminder.data.status, "draft", "manual reminder without email configuration must return an explicit draft");
  assert.match(manualReminder.data.mailto, /^mailto:/);
  assert.equal(sqlite.prepare("SELECT status FROM billing_email_log WHERE invoice_id=?").get(invoice.id).status, "draft");
  const paidInvoice = await call(`/api/admin/finance/invoices/${encodeURIComponent(invoice.id)}/paid`, { method: "POST", cookie: adminCookie, body: {} });
  assert.equal(paidInvoice.response.status, 200, JSON.stringify(paidInvoice.data));
  assert.equal(paidInvoice.data.next_due_date, "2026-12-10");

  const goalSaved = await call("/api/admin/finance/goal", { method: "PUT", cookie: adminCookie, body: {
    target_mrr: 5000, expected_new_companies_per_month: 2, average_monthly_fee: 300
  } });
  assert.equal(goalSaved.response.status, 200);
  assert.equal(goalSaved.data.target_mrr_cents, 500000);
  assert.equal(goalSaved.data.months_to_goal, 8);
  const projectDate = new Date().toISOString().slice(0, 10);
  for (const [entry_type, description, amount] of [["income", "Receita sintética do projeto", 1000.25], ["expense", "Despesa sintética do projeto", 200.25]]) {
    const entry = await call("/api/admin/finance/entries", { method: "POST", cookie: adminCookie, body: { entry_type, description, category: "Teste", amount, entry_date: projectDate } });
    assert.equal(entry.response.status, 201, JSON.stringify(entry.data));
  }
  const projectFinance = await call("/api/admin/finance", { cookie: adminCookie });
  assert.equal(projectFinance.data.summary.mrr_cents, 30000);
  assert.equal(projectFinance.data.summary.month_project_income_cents, 100025);
  assert.equal(projectFinance.data.summary.month_project_expense_cents, 20025);
  assert.equal(projectFinance.data.summary.month_project_net_cents, 80000);
  const projectEntryId = sqlite.prepare("SELECT id FROM project_financial_entries WHERE description='Despesa sintética do projeto'").get().id;
  const projectEntryDeleted = await call(`/api/admin/finance/entries/${encodeURIComponent(projectEntryId)}`, { method: "DELETE", cookie: adminCookie });
  assert.equal(projectEntryDeleted.response.status, 200);
  assert(sqlite.prepare("SELECT 1 FROM admin_audit WHERE action='lancamento_financeiro_projeto_removido'").get());

  const csv = "data;descricao;tipo;valor;categoria;centro_custo\n" +
    "2026-10-01;Recebimento de cliente;receita;1.301,10;Serviços;Comercial\n" +
    "2026-10-03;Aluguel;despesa;100,00;Ocupação;Administrativo\n" +
    "2026-10-04;Fornecedor;despesa;200,25;Insumos;Operações";

  const firstImport = await call("/api/transactions/import", { method: "POST", body: csv, cookie: companyA.cookie });
  assert.equal(firstImport.response.status, 200, JSON.stringify(firstImport.data));
  assert.deepEqual(firstImport.data, { imported: 3, skipped_duplicates: 0, inferred_categories: 0 });
  const missingOriginMovement=await call("/api/transactions",{method:"POST",cookie:companyA.cookie,omitOrigin:true,body:{date:"2026-10-02",description:"Bloqueado sem origem",type:"income",amount:20,category:"Teste"}});
  assert.equal(missingOriginMovement.response.status,403,"authenticated data mutations must require an exact same-origin Origin header");
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

  sqlite.exec("CREATE TRIGGER fail_transaction_audit BEFORE INSERT ON transaction_audit BEGIN SELECT RAISE(ABORT, 'synthetic-private-marker-4812'); END;");
  const originalConsoleError=console.error;
  const internalLogs=[];
  console.error=(...args)=>internalLogs.push(args.map(String).join(" "));
  let failedBatch;
  try {
    failedBatch = await call("/api/transactions/import", { method: "POST", cookie: companyA.cookie,
      body: "data;descricao;tipo;valor\n2026-10-06;Lançamento sintético;despesa;10,00" });
  } finally { console.error=originalConsoleError; }
  assert.equal(failedBatch.response.status, 500);
  assert.deepEqual(failedBatch.data, { error: "A importação não foi concluída. Nenhum dado do arquivo atual deve ser considerado confirmado." },
    "import failures must return a safe, actionable message without internal database details");
  assert.deepEqual(internalLogs, ["FUTURA_INTERNAL_FAILURE Transaction import batch failed Error"],
    "internal logs must retain the failure category without raw exception details");
  assert.equal(internalLogs.join(" ").includes("synthetic-private-marker-4812"), false,
    "database exception text must not leak into application logs");
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
  assert.equal(dreA.data.summary.net_income_partial,true,"unmapped movements must mark the DRE subtotal as partial");
  assert.match(dreA.data.summary.net_income_label,/parcial/i,"DRE must label the result subtotal when classifications are pending");
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
  const auditA=await call("/api/transactions/audit",{cookie:companyA.cookie});
  const auditB=await call("/api/transactions/audit",{cookie:companyB.cookie});
  assert(auditA.data.audit.some(row=>row.transaction_id===created.data.id),"company A audit should retain its own movement history");
  assert(!auditB.data.audit.some(row=>row.transaction_id===created.data.id),"company B audit must not expose company A movement IDs or details");

  sqlite.prepare("INSERT INTO company_profiles(tenant_id,legal_name,segment,subsegment,logo_data_url,updated_at) VALUES(?,?,?,?,?,?)")
    .run(companyA.tenant_id,"Empresa Sintética A","Tecnologia da informação","Software sob encomenda","data:image/png;base64,YW1hbmVudGUtYQ==",new Date().toISOString());
  sqlite.prepare("INSERT INTO company_profiles(tenant_id,legal_name,segment,subsegment,logo_data_url,updated_at) VALUES(?,?,?,?,?,?)")
    .run(companyB.tenant_id,"Empresa Sintética B","Financeiro","Fintech de crédito","data:image/png;base64,YW1hbmVudGUtYg==",new Date().toISOString());
  const profileA=await call("/api/company/profile",{cookie:companyA.cookie});
  const profileB=await call("/api/company/profile",{cookie:companyB.cookie});
  assert.equal(profileA.data.profile.segment,"Tecnologia da informação");
  assert.equal(profileB.data.profile.segment,"Financeiro");
  assert.equal(profileA.data.profile.logo_data_url,"data:image/png;base64,YW1hbmVudGUtYQ==");
  assert.equal(profileB.data.profile.logo_data_url,"data:image/png;base64,YW1hbmVudGUtYg==","company profile reads must return only the requesting company's own logo");
  const savedPreferencesA=await call("/api/forecast",{method:"POST",cookie:companyA.cookie,body:{opening_balance:9876.54,history_months:6,horizon_months:12,revenue_growth:4,expense_growth:2}});
  const preferencesA=await call("/api/forecast",{cookie:companyA.cookie});
  const preferencesB=await call("/api/forecast",{cookie:companyB.cookie});
  assert.equal(savedPreferencesA.response.status,200);
  assert.equal(preferencesA.data.preferences.opening_balance_cents,987654);
  assert.equal(preferencesA.data.preferences.horizon_months,12);
  assert.equal(preferencesB.data.preferences.opening_balance_cents,0,"forecast settings must not leak between companies");
  assert.equal(preferencesB.data.preferences.horizon_months,6);
  const scenarioCreated=await call("/api/scenarios",{method:"POST",cookie:companyA.cookie,body:{name:"Plano privado A",monthly_growth:5,months:6}});
  assert.equal(scenarioCreated.response.status,201);
  const scenariosA=await call("/api/scenarios",{cookie:companyA.cookie});
  const scenariosB=await call("/api/scenarios",{cookie:companyB.cookie});
  assert(scenariosA.data.scenarios.some(row=>row.id===scenarioCreated.data.id),"company A should see its own scenario");
  assert.equal(scenariosB.data.scenarios.length,0,"company B must not see company A scenarios");
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
  const financeStaffImport=await call("/api/staff/import",{method:"POST",cookie:companyB.cookie,body:{people:[{full_name:"Importação não autorizada",monthly_salary:"1000,00"}]}});
  const financeStaffWrite=await call("/api/staff",{method:"POST",cookie:companyB.cookie,body:{full_name:"Alteração não autorizada",monthly_salary:"1000,00"}});
  const financePayrollWrite=await call("/api/payroll",{method:"POST",cookie:companyB.cookie,body:{staff_id:"missing",reference_month:"2026-10",taxable_income:"1000,00"}});
  const financeRegulatoryRefresh=await call("/api/regulatory-updates/refresh",{method:"POST",cookie:companyB.cookie,body:{}});
  const financeBulkDelete=await call("/api/transactions",{method:"DELETE",cookie:companyB.cookie,body:{confirmation:"APAGAR TODOS"}});
  assert.equal(financeStaffImport.response.status,403,"finance role cannot import employee salary data");
  assert.equal(financeStaffWrite.response.status,403,"finance role cannot create or modify employee salary records");
  assert.equal(financePayrollWrite.response.status,403,"finance role cannot write payroll records");
  assert.equal(financeRegulatoryRefresh.response.status,403,"only an owner can start a regulatory scan");
  assert.equal(financeBulkDelete.response.status,403,"finance role cannot erase all company transactions");
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM transactions WHERE tenant_id=?").get(companyB.tenant_id).n),3,
    "a denied bulk erase must not change company transactions");
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM company_staff WHERE tenant_id=?").get(companyB.tenant_id).n),0,
    "denied staff operations must not create or alter employee records");
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM staff_audit WHERE tenant_id=?").get(companyB.tenant_id).n),0,
    "denied staff operations must not append audit records");
  const protectedCompanyRoutes=[
    ["/api/regulatory-updates","GET"],["/api/regulatory-updates/refresh","POST",{}],
    ["/api/staff/import","POST",{people:[{full_name:"Teste",monthly_salary:"0"}]}],
    ["/api/staff","GET"],["/api/staff","POST",{full_name:"Teste",monthly_salary:"0"}],
    ["/api/payroll?year=2026","GET"],["/api/payroll","POST",{staff_id:"missing",reference_month:"2026-10"}],
    ["/api/company/profile","GET"],["/api/sector-news","GET"],["/api/ai-forecast","GET"],
    ["/api/dashboard?year=2026","GET"],["/api/dre?from=2026-10-01&to=2026-10-31","GET"],
    ["/api/dre/categories","PUT",{type:"expense",category:"Teste",line:"operating_expenses"}],
    ["/api/transactions/audit","GET"],["/api/transactions","GET"],
    ["/api/transactions","POST",{date:"2026-10-08",description:"Teste",type:"income",amount:1,category:"Teste"}],
    ["/api/transactions/synthetic","PUT",{date:"2026-10-08",description:"Teste",type:"income",amount:1,category:"Teste"}],
    ["/api/transactions/synthetic","DELETE"],["/api/transactions","DELETE",{confirmation:"APAGAR TODOS"}],
    ["/api/transactions/import","POST","data;descricao;tipo;valor\n2026-10-08;Teste;receita;1,00"],
    ["/api/forecast","GET"],["/api/forecast","POST",{opening_balance:0,history_months:3,horizon_months:3,revenue_growth:0,expense_growth:0}],
    ["/api/scenarios","GET"],["/api/scenarios","POST",{name:"Teste",monthly_growth:0,months:3}],
    ["/api/team","GET"]
  ];
  for(const [route,method,body] of protectedCompanyRoutes){
    const denied=await call(route,{method,body});
    assert.equal(denied.response.status,401,`${method} ${route} must reject requests without a company session`);
  }
  const protectedAdminRoutes=[
    ["/api/admin/me","GET"],["/api/admin/dashboard","GET"],["/api/admin/finance","GET"],
    ["/api/admin/finance/goal","GET"],["/api/admin/finance/goal","PUT",{}],
    ["/api/admin/finance/entries","GET"],["/api/admin/finance/entries","POST",{}],
    ["/api/admin/finance/entries/synthetic","DELETE"],["/api/admin/segments","GET"],
    ["/api/admin/companies","GET"],["/api/admin/companies","POST",{}],
    ["/api/admin/companies/synthetic","PATCH",{status:"suspended"}],
    ["/api/admin/companies/synthetic/profile","GET"],["/api/admin/companies/synthetic/profile","PUT",{}],
    ["/api/admin/users","GET"],["/api/admin/users/synthetic","PATCH",{status:"disabled"}],
    ["/api/admin/users/synthetic/reset-password","POST",{}],["/api/admin/audit","GET"],
    ["/api/admin/finance/companies/synthetic","GET"],["/api/admin/finance/companies/synthetic","PUT",{}],
    ["/api/admin/finance/invoices/synthetic/send","POST",{}],["/api/admin/finance/invoices/synthetic/paid","POST",{}]
  ];
  for(const [route,method,body] of protectedAdminRoutes){
    const denied=await call(route,{method,body});
    assert.equal(denied.response.status,401,`${method} ${route} must reject requests without an admin session`);
  }
  sqlite.prepare("UPDATE users SET role='owner' WHERE id=?").run(companyB.id);

  const originalFeedFetch=global.fetch;
  global.fetch=async input=>{
    const query=new URL(String(input)).searchParams.get("q")||"";
    const item=(title,url,date="Sat, 17 Oct 2026 09:00:00 GMT")=>`<item><title>${title}</title><link>${url}</link><pubDate>${date}</pubDate><source>Portal Sintético</source></item>`;
    const lower=query.toLocaleLowerCase("pt-BR");
    const rss=lower.includes("software sob encomenda")?`<rss><channel>${item("Mercado de software sob encomenda cresce no Brasil","https://news.google.com/rss/articles/software-a")}${item("Mercado de software sob encomenda cresce no Brasil","https://news.google.com/rss/articles/software-a")}${item("Software sob encomenda em janeiro","https://news.google.com/rss/articles/software-old","Thu, 01 Jan 2026 09:00:00 GMT")}${item("Dia dos Pais abre segundo semestre com vendas aquecidas","https://news.google.com/rss/articles/august-old","Sun, 09 Aug 2026 09:00:00 GMT")}${item("Banco anuncia novas taxas de juros","https://news.google.com/rss/articles/bank-a")}</channel></rss>`:lower.includes("fintech de crédito")?`<rss><channel>${item("Fintech de crédito amplia serviços financeiros para empresas","https://news.google.com/rss/articles/finance-b")}</channel></rss>`:"<rss><channel></channel></rss>";
    return new Response(rss,{status:200,headers:{"content-type":"application/rss+xml"}});
  };
  let newsA,newsB;
  try{
    newsA=await call("/api/sector-news",{cookie:companyA.cookie});
    newsB=await call("/api/sector-news",{cookie:companyB.cookie});
  }finally{global.fetch=originalFeedFetch;}
  assert.equal(newsA.data.status.level,"segment");
  assert.equal(newsB.data.status.level,"segment");
  assert.equal(newsA.data.items.length,1,"duplicate, old (including August) and unrelated headlines must be removed");
  assert.match(newsA.data.items[0].title,/software sob encomenda/i);
  assert.match(newsB.data.items[0].title,/fintech de crédito/i);
  assert.notEqual(newsA.data.items[0].title,newsB.data.items[0].title,"sector news must be independently selected per tenant");
  assert.equal(newsA.data.status.provider_version,5,"news freshness policy version must invalidate old cached feeds");
  global.fetch=async()=>new Response(`<rss><channel><item><title>Dia dos Pais abre segundo semestre com vendas aquecidas</title><link>https://news.google.com/rss/articles/august-only</link><pubDate>Sun, 09 Aug 2026 09:00:00 GMT</pubDate><source>Portal Sintético</source></item></channel></rss>`,{status:200,headers:{"content-type":"application/rss+xml"}});
  let staleOnlyNews;
  try{staleOnlyNews=await call("/api/sector-news",{cookie:companyA.cookie});}
  finally{global.fetch=originalFeedFetch;}
  assert.equal(staleOnlyNews.data.status.matched,0,"an August headline must not be treated as current in October");
  assert.equal(staleOnlyNews.data.items.some(item=>item.url.includes("august-only")),false,"stale headlines must be removed rather than shown");
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
  assert.equal(forecast.data.sector,"Tecnologia da informação","company A forecast must use its own sector profile");
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
  assert.equal(forecast.data.backtest.sample_count,0,"sparse company history must not produce a fabricated backtest sample");
  assert.equal(forecast.data.backtest.confidence,"dados_insuficientes");

  for(let offset=-12;offset<0;offset++){
    const month=monthOffset(offset),income=10000+(offset+12)*1000;
    sqlite.prepare("INSERT INTO transactions(id,tenant_id,date,description,type,amount_cents,category,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(`backtest-income-${offset}`,companyB.tenant_id,`${month}-05`,"Receita sintética de tendência","income",income,"Serviços financeiros",new Date().toISOString());
    sqlite.prepare("INSERT INTO transactions(id,tenant_id,date,description,type,amount_cents,category,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(`backtest-expense-${offset}`,companyB.tenant_id,`${month}-10`,"Despesa sintética estável","expense",4000,"Operação financeira",new Date().toISOString());
  }
  const beforeBacktestFetch=global.fetch;
  global.fetch=async()=>new Response("<rss><channel></channel></rss>",{status:200,headers:{"content-type":"application/rss+xml"}});
  let completeBacktestForecast;
  console.error=()=>{};
  try{completeBacktestForecast=await call("/api/ai-forecast",{cookie:companyB.cookie});}
  finally{global.fetch=beforeBacktestFetch;console.error=previousConsoleError;}
  assert.equal(completeBacktestForecast.response.status,200,JSON.stringify(completeBacktestForecast.data));
  assert.equal(completeBacktestForecast.data.sector,"Financeiro","company B forecast must use its own sector profile");
  assert.equal(completeBacktestForecast.data.backtest.sample_count,6);
  assert.equal(completeBacktestForecast.data.backtest.confidence,"12_meses_completos");
  assert.equal(completeBacktestForecast.data.backtest.better_than_baseline,true,
    "a rising synthetic revenue series should produce lower one-step error than a flat six-month average");
  const cachedForecastA=await call("/api/ai-forecast",{cookie:companyA.cookie});
  const cachedForecastB=await call("/api/ai-forecast",{cookie:companyB.cookie});
  assert.equal(cachedForecastA.data.cached,true);
  assert.equal(cachedForecastB.data.cached,true);
  assert.equal(cachedForecastA.data.sector,"Tecnologia da informação");
  assert.equal(cachedForecastB.data.sector,"Financeiro");
  assert.notEqual(cachedForecastA.data.data_quality.months_with_data,cachedForecastB.data.data_quality.months_with_data,
    "the AI cache key must retain each company's independent financial history");

  sqlite.close();
  console.log("API integration checks passed: company/admin lifecycle, billing and project finance, exact synthetic totals, period/dashboard reconciliation, DRE/staff/payroll tenant isolation, personalized news, idempotent import, audit consistency, atomic rollback, zero payroll amounts, sparse-history backtest and AI fallback.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
