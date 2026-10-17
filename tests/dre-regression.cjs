const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../worker.js"), "utf8");
const start = source.indexOf("const DRE_LINE_LABELS=");
const end = source.indexOf("function normalizeManualTransaction", start);
assert(start >= 0 && end > start, "DRE engine functions must exist");
const context = {};
vm.runInNewContext(source.slice(start, end) + "\nglobalThis.engine={calculateDre,suggestDreClassification};", context);
const { calculateDre, suggestDreClassification } = context.engine;
const row = (id, type, amount_cents, category, description, competence_date="2025-12-15", date="2025-12-15") =>
  ({id,tenant_id:"test-a",type,amount_cents,category,description,competence_date,date,category_source:"synthetic"});

const testA = [
  row("r", "income", 28050000, "Vendas", "Faturamento de vendas"),
  row("tax", "expense", 4598500, "Deduções confirmadas", "Impostos sobre venda"),
  row("cost", "expense", 9197000, "Custos variáveis", "Custos variáveis"),
  row("opex", "expense", 9197000, "Despesas operacionais", "Serviços administrativos")
];
const overridesA = {
  "income\u0000Vendas": {dre_line:"revenue"},
  "expense\u0000Deduções confirmadas": {dre_line:"deductions"},
  "expense\u0000Custos variáveis": {dre_line:"direct_costs"},
  "expense\u0000Despesas operacionais": {dre_line:"operating_expenses"}
};
const a = calculateDre(testA, overridesA);
assert.equal(a.summary.net_revenue_cents, 23451500);
assert.equal(a.summary.gross_profit_cents, 14254500);
assert.equal(a.lines.find(x=>x.key==="operating_expenses").amount_cents, -9197000);
assert.equal(a.summary.net_income_cents, 5057500);

const testB = [row("sales", "income", 10000000, "Vendas", "Venda"), row("balance", "income", 1000000, "Saldo", "Saldo inicial"), row("expense", "expense", 5000000, "Administrativo", "Aluguel")];
const b = calculateDre(testB, {"income\u0000Vendas":{dre_line:"revenue"},"expense\u0000Administrativo":{dre_line:"administrative_expenses"}});
assert.equal(suggestDreClassification(testB[1]).line, "excluded");
assert.equal(b.summary.income_cents, 10000000);
assert.equal(b.summary.net_income_cents, 5000000);
assert.equal(b.summary.excluded_count, 1);

const duplicateSet=[row("dup1","income",100000,"Vendas","Venda repetida"),row("dup2","income",100000,"Vendas","Venda repetida")];
const duplicateReport=calculateDre(duplicateSet,{"income\u0000Vendas":{dre_line:"revenue"}});
assert.equal(duplicateReport.summary.duplicate_candidate_count,2);
assert.equal(duplicateReport.details.filter(x=>x.duplicate_suspected).length,2);
assert(duplicateReport.warnings.some(x=>x.includes("podem estar duplicados")));

const genericTax = row("tax2","expense",100000,"Impostos","Pagamento de impostos");
assert.equal(suggestDreClassification(genericTax).line,"unclassified");
const directCostAmbiguous = row("cost2","expense",100000,"Custos variáveis","Compra de mercadorias");
assert.equal(suggestDreClassification(directCostAmbiguous).line,"unclassified");

const competenceSale = row("sale-sept","income",500000,"Vendas","Venda emitida", "2026-09-20","2026-11-03");
assert.equal(competenceSale.competence_date.slice(0,7),"2026-09");
assert.equal(competenceSale.date.slice(0,7),"2026-11");
assert.match(source.slice(source.indexOf('if (path === "/api/dre"'),source.indexOf('if (path === "/api/dre/categories"')),/COALESCE\(t\.competence_date,t\.date\)/);
assert.match(source.slice(source.indexOf('if (path === "/api/dre"'),source.indexOf('if (path === "/api/dre/categories"')),/WHERE t\.tenant_id=\?/);

const tenantA = calculateDre([row("a","income",500000,"Vendas","Venda")], {"income\u0000Vendas":{dre_line:"revenue"}});
const tenantB = calculateDre([row("b","income",300000,"Serviços","Honorário")], {"income\u0000Serviços":{dre_line:"revenue"}});
assert.equal(tenantA.summary.income_cents,500000);
assert.equal(tenantB.summary.income_cents,300000);
assert.notEqual(tenantA.summary.income_cents,tenantB.summary.income_cents);

assert.match(source,/dre_category_overrides/);
assert.match(source,/transactionAuditStatement\(db,user,"classificacao_dre"/);
const appHtml = require("child_process").execFileSync("node", ["--input-type=module", "-e", "import worker from './worker.js'; const r=await worker.fetch(new Request('https://local.test/'),{}); process.stdout.write(await r.text())"], {encoding:"utf8"});
const script = [...appHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).join("\n");
const xmlStart = script.indexOf("function xmlCell(");
const xmlEnd = script.indexOf("function renderDre(report)", xmlStart);
assert(xmlStart>=0&&xmlEnd>xmlStart, "Excel exporter must exist");
const workbookContext = {DRE_LINES:{"revenue":"Receita bruta"}};
vm.runInNewContext(script.slice(xmlStart,xmlEnd)+"\nglobalThis.build=buildDreSpreadsheet;",workbookContext);
const reportForExport={from:"2025-01-01",to:"2025-12-31",basis_label:"competência",responsible:"Teste",company:{name:"Empresa sintética",cnpj:""},summary:{validation_status:"preliminary",ebitda_cents:null,ebitda_margin_pct:null,net_margin_pct:20},lines:[{label:"Resultado líquido",amount_cents:5057500}],details:[{competence_date:"2025-09-20",date:"2025-11-03",type:"income",description:"Venda de teste",category:"Vendas",line:"revenue",amount_cents:500000,classification_status:"confirmed",origin:"synthetic",classification_reason:"teste"}],warnings:["Dados sintéticos"]};
const xls=workbookContext.build(reportForExport);
assert.match(xls,/<Worksheet ss:Name="DRE">/);
assert.match(xls,/<Worksheet ss:Name="Memoria">/);
assert.match(xls,/<Worksheet ss:Name="Notas">/);
assert.match(xls,/>50575\.00</);
assert.match(xls,/>5000\.00</);
assert.match(xls,/>Venda de teste</);
console.log("DRE regression checks passed: A reclassification, B opening balance, duplicate detection, generic taxes/costs pending, competence priority, tenant separation, audited override storage.");
