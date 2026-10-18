const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");

const source = fs.readFileSync(path.join(__dirname, "../worker.js"), "utf8");
const start = source.indexOf("function validIsoDate(value)");
const end = source.indexOf("const APP_HTML", start);
assert(start >= 0 && end > start, "financial CSV parsing functions must exist");
const context = { MAX_CSV_ROWS: 500 };
vm.runInNewContext(source.slice(start, end) + "\nglobalThis.parsers={parseCsv,parseMoney};", context);
const { parseCsv, parseMoney } = context.parsers;
const expectParseError = (csv, message) => assert.throws(() => parseCsv(csv), error => error.message.includes(message));

const quoted = parseCsv('\uFEFFdata;descrição;tipo;valor;categoria;centro de custo\r\n17/10/2026;"Venda, loja; ""especial""";Receita;1.301,10;Vendas;Centro A\r\n');
assert.equal(quoted.length, 1);
assert.equal(quoted[0].date, "2026-10-17");
assert.equal(quoted[0].description, 'Venda, loja; "especial"');
assert.equal(quoted[0].amount_cents, 130110);
assert.equal(quoted[0].category, "Vendas");
assert.equal(quoted[0].cost_center, "Centro A");

const commaDelimited = parseCsv('date,description,type,amount,category\n2026-10-17,"Venda, lote",income,1250.50,Revenue');
assert.equal(commaDelimited[0].amount_cents, 125050);
assert.equal(commaDelimited[0].description, "Venda, lote");

const tabDelimited = parseCsv("data\tdescricao\ttipo\tvalor\n2026-10-17\tConsultoria\treceita\t2.500,00");
assert.equal(tabDelimited[0].amount_cents, 250000);

const debitCredit = parseCsv("data;descricao;debito;credito\n2026-10-17;Compra de material;340,25;0\n2026-10-17;Recebimento cliente;0;1.000,00");
assert.equal(debitCredit[0].type, "expense");
assert.equal(debitCredit[0].amount_cents, 34025);
assert.equal(debitCredit[1].type, "income");
assert.equal(debitCredit[1].amount_cents, 100000);

expectParseError("data;descricao;tipo;debito;credito\n2026-10-17;Compra;Receita;100,00;0", "não corresponde");
expectParseError("data;descricao;tipo;debito;credito\n2026-10-17;Compra;Despesa;100,00;200,00", "não ambos");
expectParseError("data;descricao;tipo;valor\n31/02/2026;Venda;Receita;100,00", "data inválida");
expectParseError("data;descricao;valor\n2026-10-17;Venda", "quantidade de colunas");
expectParseError("data;valor\n2026-10-17;100,00", "colunas obrigatórias");

assert.equal(parseMoney("R$ 1.234,56"), 123456);
assert.equal(parseMoney(0), 0, "a numeric zero is valid, not a missing amount");
assert.equal(parseMoney("0,00"), 0, "zero-valued payroll fields must remain valid");
assert.equal(parseMoney("(250,00)"), -25000, "accounting parentheses are negative values");
assert.equal(parseMoney("(1.234,56)"), -123456);

const manyRows = ["data;descricao;valor", ...Array.from({ length: 501 }, (_, i) => `2026-10-17;Venda ${i};1,00`)].join("\n");
expectParseError(manyRows, "limite é 500");

assert.match(source, /async function prepareTransactionImport/, "import duplicate staging helper must exist");
assert.match(source, /COALESCE\(cost_center,''\)=\?/g, "cost center must distinguish legitimate transactions");
assert.match(source, /duplicates_skipped:skipped/, "import response and audit must use the same duplicate count");
assert.doesNotMatch(source.slice(source.indexOf('if (path === "/api/transactions/import"'), source.indexOf('if (path === "/api/forecast"')), /INSERT OR IGNORE INTO transactions/);
assert.match(source, /<div class="label">Resultado do período<\/div>/, "cash-flow movement results must not be labeled net profit");
assert.match(source, /<div class="label">Margem de caixa<\/div>/, "cash-flow margin must be named accurately");
assert.match(source, /Margem de caixa projetada:/, "AI cash-flow forecasts must not claim accounting net margin");
assert.match(source, /Histórico incompleto: '\+coverageLabel/, "forecast UI must explain sparse historical coverage");
assert.match(source, /Base observada: '\+coverageLabel/, "forecast UI must identify the months used for its projection");
assert.doesNotMatch(source, /Projeção baseada nos últimos 6 meses/);
assert.match(source, /status\?\.source_reason==="no_recent_results"/, "news carousel must distinguish an empty search from a provider outage");
assert.doesNotMatch(source, /A busca de manchetes está indisponível/);
assert.match(source, /Backtest · 1 mês à frente/, "forecast UI must expose a historical forecast test");
assert.match(source, /não prova de precisão/, "backtest UI must avoid claiming accuracy from a short history");
assert.match(source, /<th class="right">Resultado de caixa<\/th>/, "forecast output must identify cash result");
assert.doesNotMatch(source, /<div class="label">Lucro líquido<\/div>/);
assert.doesNotMatch(source, /<th class="right">Lucro<\/th>/);

const qualityStart=source.indexOf("function summarizeAiForecastHistory(history)");
const qualityEnd=source.indexOf("async function buildForecast",qualityStart);
assert(qualityStart>=0&&qualityEnd>qualityStart,"forecast history quality helper must exist");
const qualityContext={clamp:(value,min,max)=>Math.max(min,Math.min(max,value))};
vm.runInNewContext(source.slice(qualityStart,qualityEnd)+"\nglobalThis.summarize=summarizeAiForecastHistory;globalThis.backtest=calculateForecastBacktest;",qualityContext);
const sparseHistory=[
  {month:"2026-04",income_cents:10000,expense_cents:5000,movements:2},
  {month:"2026-05",income_cents:0,expense_cents:0,movements:0},
  {month:"2026-06",income_cents:0,expense_cents:0,movements:0},
  {month:"2026-07",income_cents:20000,expense_cents:8000,movements:3},
  {month:"2026-08",income_cents:0,expense_cents:0,movements:0},
  {month:"2026-09",income_cents:0,expense_cents:0,movements:0}
];
const sparseQuality=qualityContext.summarize(sparseHistory);
assert.equal(sparseQuality.months_with_data,2);
assert.equal(sparseQuality.average_income_cents,15000,"missing months must not reduce the average as if income were zero");
assert.equal(sparseQuality.revenue_trend_monthly_pct,0,"growth must not be inferred from incomplete history");
assert.equal(sparseQuality.confidence,"dados_insuficientes");
const completeHistory=sparseHistory.map((item,index)=>({...item,movements:index===0?2:3,income_cents:10000*(index+1),expense_cents:5000}));
assert.equal(qualityContext.summarize(completeHistory).has_complete_history,true);
const rampHistory=Array.from({length:12},(_,index)=>({
  month:`2025-${String(index+1).padStart(2,"0")}`,
  income_cents:10000+index*1000,
  expense_cents:4000,
  movements:1
}));
const rampBacktest=qualityContext.backtest(rampHistory);
assert.equal(rampBacktest.sample_count,6,"12 complete months should yield six one-month-ahead tests");
assert.equal(rampBacktest.confidence,"12_meses_completos");
assert.equal(rampBacktest.better_than_baseline,true,"the trend should beat the six-month average for steadily rising synthetic revenue");
const sparseBacktest=qualityContext.backtest(rampHistory.map((item,index)=>index===3?{...item,movements:0}:item));
assert.equal(sparseBacktest.sample_count,2,"backtest windows touching a missing month must be excluded while later complete windows remain testable");
assert.equal(sparseBacktest.confidence,"amostra_pequena");
assert.equal(JSON.stringify(sparseBacktest.sample_months),JSON.stringify(["2025-11","2025-12"]));

const appHtml = require("child_process").execFileSync("node", ["--input-type=module", "-e", "import worker from './worker.js'; const r=await worker.fetch(new Request('https://local.test/'),{}); process.stdout.write(await r.text())"], {encoding:"utf8"});
const appScript = [...appHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).join("\n");
const frontendStart=appScript.indexOf("function validImportDate(value)");
const frontendEnd=appScript.indexOf("function csvEscape(value)",frontendStart);
assert(frontendStart>=0&&frontendEnd>frontendStart,"frontend import validation helpers must exist");
const frontendContext={};
vm.runInNewContext(appScript.slice(frontendStart,frontendEnd)+"\nglobalThis.validators={normalizeImportDate,resolveImportMovement};",frontendContext);
assert.equal(frontendContext.validators.normalizeImportDate("17/10/2026"),"2026-10-17");
assert.equal(frontendContext.validators.normalizeImportDate("31/02/2026"),"");
assert.equal(frontendContext.validators.resolveImportMovement("Receita",-100,"").error,"Uma receita não pode ter valor negativo.");
assert.equal(frontendContext.validators.resolveImportMovement("Receita",100,"Despesa").error,"O tipo informado não corresponde ao valor de débito/crédito.");
assert.deepEqual(JSON.parse(JSON.stringify(frontendContext.validators.resolveImportMovement("",100,"Despesa"))),{type:"Despesa",amount:100});

function zipStored(files) {
  const locals=[],centrals=[];let offset=0;
  for(const [name,text] of Object.entries(files)){
    const filename=Buffer.from(name),data=Buffer.from(text),local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);local.writeUInt16LE(0,8);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);local.writeUInt16LE(0,28);
    locals.push(local,filename,data);
    central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0,8);central.writeUInt16LE(0,10);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt16LE(0,30);central.writeUInt16LE(0,32);central.writeUInt32LE(offset,42);
    centrals.push(central,filename);offset+=local.length+filename.length+data.length;
  }
  const centralBytes=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(centralBytes.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,centralBytes,end]);
}
class XmlNode {
  constructor(name,attrs={}){this.name=name;this.attrs=attrs;this.children=[];this.ownText="";}
  getAttribute(name){return this.attrs[name]??null;}
  getAttributeNS(_ns,name){return Object.entries(this.attrs).find(([key])=>key.split(":").pop()===name)?.[1]??null;}
  get textContent(){return this.ownText+this.children.map(child=>child.textContent).join("");}
  getElementsByTagNameNS(_ns,name){const out=[];for(const child of this.children){if(child.name.split(":").pop()===name)out.push(child);out.push(...child.getElementsByTagNameNS(_ns,name));}return out;}
  getElementsByTagName(name){return this.getElementsByTagNameNS("*",name);}
}
class MinimalDOMParser {
  parseFromString(xml){
    const root=new XmlNode("document"),stack=[root],tokens=xml.match(/<\/?[^>]+>|[^<]+/g)||[];
    for(const token of tokens){
      if(token.startsWith("<?")||token.startsWith("<!"))continue;
      if(token.startsWith("</")){if(stack.length>1)stack.pop();continue;}
      if(token.startsWith("<")){
        const selfClosing=/\/>$/.test(token),match=token.match(/^<([^\s/>]+)([\s\S]*?)\/?\s*>$/);if(!match)continue;
        const attrs={};for(const attr of match[2].matchAll(/([^\s=]+)\s*=\s*(["'])(.*?)\2/g))attrs[attr[1]]=attr[3];
        const node=new XmlNode(match[1],attrs);stack.at(-1).children.push(node);if(!selfClosing)stack.push(node);
      }else stack.at(-1).ownText+=token.replaceAll("&amp;","&").replaceAll("&lt;","<").replaceAll("&gt;",">").replaceAll("&quot;",'"').replaceAll("&apos;","'");
    }
    return root;
  }
}
async function testXlsxParser(){
  const xml={
    "xl/workbook.xml":'<workbook xmlns:r="urn:rel"><sheets><sheet name="Movimentações" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml":'<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>data</t></is></c><c r="B1" t="inlineStr"><is><t>descricao</t></is></c><c r="C1" t="inlineStr"><is><t>tipo</t></is></c><c r="D1" t="inlineStr"><is><t>valor</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>2026-10-12</t></is></c><c r="B2" t="inlineStr"><is><t>Venda sintética</t></is></c><c r="C2" t="inlineStr"><is><t>receita</t></is></c><c r="D2"><v>2500.75</v></c></row></sheetData></worksheet>'
  };
  const zip=zipStored(xml),bytes=new Uint8Array(zip),start=appScript.indexOf("function importColIndex"),end=appScript.indexOf("function parseImportNumber",start),context={Blob,Response,DecompressionStream,TextDecoder,DataView,Uint8Array,URL,DOMParser:MinimalDOMParser};
  assert(start>=0&&end>start,"XLSX parser and helpers must exist in the application script");
  vm.runInNewContext(appScript.slice(start,end)+"\nglobalThis.parseWorkbook=parseXlsxFile;",context);
  const workbook=await context.parseWorkbook({arrayBuffer:async()=>bytes.slice().buffer});
  assert.equal(workbook.sheets[0].name,"Movimentações");
  assert.equal(workbook.sheets[0].rows[0][0],"data");
  assert.equal(workbook.sheets[0].rows[1][1],"Venda sintética");
  assert.equal(workbook.sheets[0].rows[1][3],"2500.75");
}

async function testDuplicateStaging() {
  const helperStart = source.indexOf("async function prepareTransactionImport");
  const helperEnd = source.indexOf("function adminCookie", helperStart);
  const helperContext = { sha256: async value => `hash:${value}` };
  vm.runInNewContext(source.slice(helperStart, helperEnd) + "\nglobalThis.stage=prepareTransactionImport;", helperContext);

  const rows = Array.from({ length: 205 }, (_, i) => ({
    date: "2026-10-17", type: "expense", amount_cents: 10000 + i,
    description: `Compra ${i}`, account_code: "", document_number: "",
    counterparty: "Fornecedor sintético", cost_center: "Operações"
  }));
  rows.push({ ...rows[0] }); // duplicate within the same uploaded file
  rows.push({ ...rows[1], cost_center: "Financeiro" }); // legitimate separate allocation
  const existing = { tenant_id: "tenant-a", ...rows[2] };
  const calls = [];
  const db = {
    prepare(sql) { return { bind(...args) { return { sql, args }; } }; },
    async batch(statements) {
      calls.push(statements.length);
      return statements.map(statement => {
        const [tenantId, _key, date, type, amount, description, account, document, counterparty, costCenter] = statement.args;
        const duplicate = tenantId === existing.tenant_id && date === existing.date && type === existing.type && amount === existing.amount_cents &&
          description.toLocaleLowerCase("pt-BR") === existing.description.toLocaleLowerCase("pt-BR") && account === existing.account_code &&
          document === existing.document_number && counterparty === existing.counterparty && costCenter === existing.cost_center;
        return { results: duplicate ? [{ id: "existing-row" }] : [] };
      });
    }
  };
  const result = await helperContext.stage(db, "tenant-a", rows);
  assert.deepEqual(calls, [100, 100, 6], "lookups should be grouped into batches of at most 100");
  assert.equal(result.skipped, 2, "one in-file duplicate and one persisted duplicate should be skipped");
  assert.equal(result.candidates.length, 205, "distinct cost centers must remain separate transactions");
  assert.equal(result.candidates.find(row => row.description === "Compra 1" && row.cost_center === "Financeiro")?.cost_center, "Financeiro");
}

Promise.all([testDuplicateStaging(),testXlsxParser()]).then(() => {
  console.log("Import/forecast regression checks passed: CSV/TSV/XLSX parsing, locale values, quoted fields, debit-credit validation, duplicate lookups, cost centers, sparse-history safeguards, and rolling backtest accuracy metrics.");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
