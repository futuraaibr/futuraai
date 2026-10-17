const SESSION_DAYS = 7;
const MAX_CSV_ROWS = 100;
const DEMO_CSV = `data;descricao;tipo;valor;categoria
2026-09-01;Mensalidade cliente Alfa;receita;480,50;Serviços
2026-09-05;Projeto de implantação;receita;600,00;Consultoria
2026-09-12;Suporte premium;receita;220,60;Serviços
2026-09-03;Licenças de software;despesa;200,25;Tecnologia
2026-09-10;Material de escritório;despesa;100,00;Operacional`;

const encoder = new TextEncoder();
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});
const fail = (message, status = 400) => json({ error: message }, status);
const id = () => crypto.randomUUID();
const bytesToHex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (n = 32) => bytesToHex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (value) => bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const money = (cents) => Number(cents || 0) / 100;

function safeEqual(a, b) {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 150000, hash: "SHA-256" }, key, 256);
  return bytesToHex(bits);
}

function cookieValue(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function checkOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

async function createSession(db, user, tenant) {
  const token = randomHex(32);
  const sessionId = id();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.prepare("INSERT INTO sessions (id, user_id, tenant_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(sessionId, user.id, tenant.id, await sha256(token), expires, new Date().toISOString()).run();
  return { token, expires };
}

async function requireUser(request, db) {
  const token = cookieValue(request, "futura_session");
  if (!token || token.length !== 64) return null;
  const hash = await sha256(token);
  return db.prepare(`SELECT u.id, u.name, u.email, u.role, t.id AS tenant_id, t.name AS company_name, t.plan
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN tenants t ON t.id = s.tenant_id AND t.id = u.tenant_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active' AND t.status = 'active' LIMIT 1`)
    .bind(hash, new Date().toISOString()).first();
}

function sessionCookie(token, expires) {
  const maxAge = Math.max(0, Math.floor((new Date(expires).getTime() - Date.now()) / 1000));
  return `futura_session=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
const clearCookie = "futura_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict";

function parseMoney(value) {
  const raw = String(value || "").trim().replace(/R\$\s?/g, "").replace(/\s/g, "");
  if (!raw || !/^-?[\d.,]+$/.test(raw)) return null;
  let normalized = raw;
  if (raw.includes(",") && raw.includes(".")) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (raw.includes(",")) normalized = raw.replace(",", ".");
  const number = Number(normalized);
  if (!Number.isFinite(number) || Math.abs(number) > 100000000) return null;
  return Math.round(number * 100);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted && c === '"' && input[i + 1] === '"') { field += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ";" && !quoted) { row.push(field); field = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); if (row.some((v) => v.trim())) rows.push(row); }
  if (rows.length < 2) throw new Error("O arquivo CSV não contém lançamentos.");
  const header = rows.shift().map((v) => v.trim().toLocaleLowerCase("pt-BR"));
  const required = ["data", "descricao", "tipo", "valor", "categoria"];
  if (header.length !== required.length || required.some((key, i) => header[i] !== key)) {
    throw new Error("Cabeçalho inválido. Use: data;descricao;tipo;valor;categoria");
  }
  if (rows.length > MAX_CSV_ROWS) throw new Error(`O limite é ${MAX_CSV_ROWS} lançamentos por importação.`);
  return rows.map((cells, i) => {
    if (cells.length !== 5) throw new Error(`Linha ${i + 2}: são esperadas 5 colunas.`);
    const [dateRaw, descriptionRaw, typeRaw, amountRaw, categoryRaw] = cells.map((v) => v.trim());
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : (() => {
      const match = dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
    })();
    const type = ({ receita: "income", entrada: "income", income: "income", despesa: "expense", saída: "expense", saida: "expense", expense: "expense" })[typeRaw.toLocaleLowerCase("pt-BR")];
    const amount = parseMoney(amountRaw);
    const parsedDate = date ? new Date(`${date}T00:00:00Z`) : null;
    if (!date || !parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw new Error(`Linha ${i + 2}: data inválida.`);
    if (!descriptionRaw || descriptionRaw.length > 160) throw new Error(`Linha ${i + 2}: descrição inválida (máximo 160 caracteres).`);
    if (!type) throw new Error(`Linha ${i + 2}: tipo deve ser receita ou despesa.`);
    if (amount === null || amount <= 0) throw new Error(`Linha ${i + 2}: valor inválido.`);
    if (!categoryRaw || categoryRaw.length > 80) throw new Error(`Linha ${i + 2}: categoria inválida.`);
    return { date, description: descriptionRaw, type, amount_cents: amount, category: categoryRaw };
  });
}

const APP_HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#090d18"><title>Futura AI — Inteligência Financeira</title>
<style>
:root{--bg:#080c15;--panel:#101725;--panel2:#151f2f;--line:#253248;--text:#eef4ff;--muted:#97a7bf;--cyan:#70e1dc;--blue:#7598ff;--green:#65d9a4;--red:#ff818e;--gold:#e5c47f;--shadow:0 20px 60px #02040a66}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 82% -12%,#23447566,transparent 48%),var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}button,input,select{font:inherit}button{cursor:pointer}a{color:inherit;text-decoration:none}.wrap{max-width:1180px;margin:auto;padding:24px}.top{display:flex;align-items:center;justify-content:space-between;gap:16px}.brand{display:flex;align-items:center;gap:11px;font-weight:750;letter-spacing:.01em}.brandmark{width:38px;height:38px;display:grid;place-items:center;border-radius:13px;background:linear-gradient(135deg,#8ef3db,#789aff);color:#0b1421;font-weight:900;box-shadow:0 8px 30px #65d9a433}.brand small{display:block;color:var(--muted);font-weight:500;font-size:11px;letter-spacing:.12em;text-transform:uppercase}.toplinks{display:flex;gap:22px;color:#b9c5d8;font-size:13px}.toplinks a:hover{color:var(--cyan)}.pill,.badge{display:inline-flex;align-items:center;gap:7px;border:1px solid #375168;background:#10212c;color:#bce8e1;border-radius:999px;padding:7px 11px;font-size:12px}.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:42px;align-items:center;padding:82px 0 66px}.eyebrow{color:var(--cyan);font-size:12px;text-transform:uppercase;letter-spacing:.16em;font-weight:700}.hero h1{font-size:clamp(38px,5.4vw,68px);letter-spacing:-.045em;line-height:1.03;margin:18px 0}.hero p{font-size:17px;line-height:1.7;color:#aebbd0;max-width:590px}.hero .actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px}.btn{border:1px solid transparent;border-radius:12px;padding:11px 16px;background:linear-gradient(115deg,#8cf0d6,#7c9bff);color:#0a1521;font-weight:750;transition:.18s transform,.18s opacity}.btn:hover{transform:translateY(-1px);opacity:.94}.btn.secondary{color:#e6edfa;background:#141e2e;border-color:#34435b}.btn.ghost{background:transparent;border-color:#33445d;color:#d6e1f2}.btn.danger{color:#ffd6d9;background:#351820;border-color:#6c313c}.btn.small{padding:8px 11px;font-size:12px}.hero-card,.card{background:linear-gradient(150deg,#131e2d,#0d1421);border:1px solid #27374d;border-radius:20px;box-shadow:var(--shadow)}.hero-card{padding:24px;transform:rotate(1deg)}.hero-card-head{display:flex;justify-content:space-between;align-items:center;color:#bdc9dc;font-size:13px}.hero-value{font-size:32px;letter-spacing:-.04em;margin:8px 0 2px}.positive{color:var(--green)}.chart{height:140px;display:flex;align-items:end;gap:10px;padding:20px 2px 0}.bar{flex:1;min-width:10px;border-radius:7px 7px 2px 2px;background:linear-gradient(180deg,#73e7d1,#5d79e3);opacity:.9}.mini-stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}.mini-stat{background:#101a28;border:1px solid #26374b;border-radius:13px;padding:13px}.mini-stat span{display:block;font-size:11px;color:var(--muted)}.mini-stat strong{display:block;font-size:16px;margin-top:3px}.features{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding-bottom:74px}.feature{padding:20px;background:#0f1724;border:1px solid #202e42;border-radius:16px}.feature i{font-style:normal;color:var(--cyan);font-size:20px}.feature h3{font-size:15px;margin:12px 0 5px}.feature p{font-size:13px;color:var(--muted);margin:0}.footer{border-top:1px solid #1b293b;padding:20px 0;color:#71839e;font-size:12px;display:flex;justify-content:space-between;gap:12px}.auth-area{max-width:900px;margin:60px auto;display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{padding:24px}.card h2,.card h3{margin:0 0 7px;letter-spacing:-.02em}.sub{color:var(--muted);font-size:13px;margin:0 0 18px}.field{display:grid;gap:6px;margin:12px 0}.field label{color:#b8c5d8;font-size:12px}.field input,.field select{width:100%;border:1px solid #30415a;background:#0a111d;color:#edf4ff;border-radius:10px;padding:11px 12px;outline:none}.field input:focus,.field select:focus{border-color:#72d9d3;box-shadow:0 0 0 3px #70e1dc1c}.message{min-height:22px;color:var(--red);font-size:13px}.dash{display:none;min-height:100vh}.app-shell{display:grid;grid-template-columns:232px 1fr;max-width:1440px;margin:auto;min-height:100vh}.sidebar{padding:23px 15px;border-right:1px solid #1d2a3d;background:#0a111c;display:flex;flex-direction:column}.sidebar .brand{padding:0 8px 26px}.side-label{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#63758f;padding:12px 10px 7px}.navbtn{width:100%;text-align:left;border:1px solid transparent;background:transparent;color:#9fb0c8;padding:10px 11px;border-radius:10px;margin:2px 0;font-size:13px}.navbtn:hover,.navbtn.active{background:#151f30;color:#eff6ff;border-color:#283952}.navbtn.active{box-shadow:inset 2px 0 #6de1d1}.side-bottom{margin-top:auto;border-top:1px solid #1d2a3d;padding-top:13px}.profile-mini{padding:10px;color:#a8b5c9;font-size:12px;overflow-wrap:anywhere}.main{padding:26px clamp(18px,3.2vw,44px) 50px;min-width:0}.dash-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}.dash-top h1{font-size:25px;letter-spacing:-.035em;margin:0}.dash-top p{font-size:12px;color:var(--muted);margin:4px 0 0}.top-actions{display:flex;align-items:center;gap:9px}.content{max-width:1120px}.page{display:none}.page.active{display:block}.grid{display:grid;gap:14px}.kpis{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:16px}.kpi{padding:17px 18px;background:#101825;border:1px solid #223147;border-radius:15px}.kpi .label{font-size:11px;color:#9aabc2;display:flex;justify-content:space-between;gap:10px}.kpi .value{font-size:24px;letter-spacing:-.04em;margin:9px 0 4px}.trend{font-size:11px;color:var(--green)}.trend.down{color:var(--red)}.two-col{grid-template-columns:1.55fr 1fr}.card-title{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:15px}.card-title h3{font-size:14px;margin:0}.card-title span{font-size:11px;color:var(--muted)}.graph{height:200px;display:flex;align-items:end;gap:9px;padding:18px 4px 0;border-bottom:1px solid #2b394d;background:repeating-linear-gradient(to bottom,transparent 0,transparent 48px,#1c293b 49px,#1c293b 50px)}.graph-col{flex:1;height:100%;display:flex;align-items:end;justify-content:center;gap:4px;position:relative}.graph-col i{width:38%;max-width:18px;border-radius:5px 5px 1px 1px;background:linear-gradient(#75e6d2,#5185d8)}.graph-col i.exp{background:linear-gradient(#f29a9b,#c46984)}.graph-col small{position:absolute;bottom:-23px;font-size:9px;color:#71829a}.chart-foot{display:flex;gap:15px;font-size:10px;color:var(--muted);margin-top:27px}.dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:5px;background:var(--cyan)}.dot.red{background:#df8293}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;color:#71849e;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;padding:9px 7px;border-bottom:1px solid #27354a}td{padding:11px 7px;border-bottom:1px solid #1d2a3d;color:#d6dfed}td.right,th.right{text-align:right}.kind{border-radius:99px;padding:4px 8px;font-size:10px}.kind.income{color:#8de4bd;background:#143229}.kind.expense{color:#ffacb3;background:#381b25}.muted{color:var(--muted)}.split{display:grid;grid-template-columns:1fr 1fr;gap:14px}.empty{padding:26px;color:var(--muted);text-align:center;border:1px dashed #34435a;border-radius:12px;font-size:13px}.progress{height:7px;background:#222d3e;border-radius:8px;overflow:hidden;margin:8px 0 14px}.progress i{height:100%;display:block;background:linear-gradient(90deg,var(--cyan),var(--blue));border-radius:inherit}.category-row{font-size:12px;margin:13px 0}.category-row header{display:flex;justify-content:space-between;color:#bbc7d8}.notice{padding:12px 14px;border:1px solid #4a4633;background:#201d16;color:#dec994;border-radius:12px;font-size:12px}.toolbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:14px}.scenario-grid{grid-template-columns:1fr 1fr}.scenario-result{padding:16px;border:1px solid #293951;background:#101a28;border-radius:13px}.scenario-result strong{font-size:21px;display:block}.row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #1d2a3d}.row:last-child{border:0}.row .who{font-size:13px}.row .who small{display:block;color:var(--muted)}.hidden{display:none!important}.modal-back{position:fixed;inset:0;background:#0009;display:grid;place-items:center;padding:18px;z-index:10}.modal{width:min(470px,100%);background:#111a29;border:1px solid #30415a;border-radius:18px;padding:22px;box-shadow:var(--shadow)}.mobile-menu{display:none}
@media(max-width:900px){.hero{grid-template-columns:1fr;padding-top:58px}.hero-card{transform:none;max-width:530px}.kpis{grid-template-columns:repeat(2,1fr)}.two-col,.split{grid-template-columns:1fr}.features{grid-template-columns:1fr 1fr}.app-shell{grid-template-columns:72px 1fr}.sidebar{padding:18px 9px}.sidebar .brand{justify-content:center;padding:0 0 24px}.brand-text,.side-label,.navbtn span,.profile-mini,.side-bottom .btn{display:none}.navbtn{text-align:center;font-size:18px;padding:10px 0}.mobile-menu{display:inline-flex}}
@media(max-width:620px){.wrap{padding:18px}.toplinks{display:none}.hero{padding:42px 0}.hero h1{font-size:43px}.features{grid-template-columns:1fr}.auth-area{grid-template-columns:1fr;margin:28px auto}.app-shell{display:block}.sidebar{position:fixed;z-index:4;inset:auto 0 0;height:62px;border-right:0;border-top:1px solid #27344a;padding:5px 7px;flex-direction:row;justify-content:space-around}.sidebar .brand,.side-label,.side-bottom{display:none}.sidebar nav{width:100%;display:flex;justify-content:space-around}.navbtn{width:auto;min-width:54px;margin:0;font-size:17px}.navbtn span{display:none}.main{padding:20px 14px 88px}.dash-top{align-items:flex-start}.dash-top h1{font-size:22px}.dash-top p{max-width:250px}.top-actions .pill{display:none}.kpis{gap:9px}.kpi{padding:13px}.kpi .value{font-size:20px}.table-wrap{margin:0 -8px}.card{padding:17px}.hero-card{padding:18px}.footer{flex-direction:column}}
</style></head><body>
<div id="marketing"><div class="wrap"><header class="top"><a class="brand" href="#"><span class="brandmark">F</span><span class="brand-text">FUTURA AI<small>inteligência financeira</small></span></a><nav class="toplinks"><a href="#plataforma">Plataforma</a><a href="#planos">Planos</a><a href="#acesso">Acessar conta</a></nav><a class="btn small" href="#acesso">Começar agora</a></header>
<section class="hero"><div><div class="eyebrow">Finanças mais claras. Decisões melhores.</div><h1>O futuro da sua empresa, em perspectiva.</h1><p>Organize o fluxo financeiro, acompanhe indicadores e compare cenários em um espaço feito para quem precisa decidir com confiança.</p><div class="actions"><a class="btn" href="#acesso">Acessar a plataforma <span aria-hidden="true">→</span></a><a class="btn secondary" href="#plataforma">Conhecer recursos</a></div><p class="muted" style="font-size:12px;margin-top:15px">Ambiente de homologação • Não insira dados financeiros reais</p></div>
<div class="hero-card"><div class="hero-card-head"><span>Visão financeira</span><span class="badge">● DEMONSTRAÇÃO</span></div><div class="hero-value">R$ 84.290,00</div><div class="positive" style="font-size:12px">↗ 12,8% no período</div><div class="chart" aria-label="Gráfico demonstrativo de fluxo financeiro"><i class="bar" style="height:34%"></i><i class="bar" style="height:52%"></i><i class="bar" style="height:42%"></i><i class="bar" style="height:67%"></i><i class="bar" style="height:57%"></i><i class="bar" style="height:78%"></i><i class="bar" style="height:92%"></i></div><div class="mini-stats"><div class="mini-stat"><span>Receitas no mês</span><strong class="positive">R$ 31.480</strong></div><div class="mini-stat"><span>Despesas no mês</span><strong>R$ 18.260</strong></div></div></div></section>
<section id="plataforma" class="features"><article class="feature"><i>◈</i><h3>Fluxo em um só lugar</h3><p>Importe lançamentos por CSV, classifique receitas e despesas e consulte seu histórico.</p></article><article class="feature"><i>⌁</i><h3>Cenários para planejar</h3><p>Projete resultados a partir do saldo atual e ajuste premissas de crescimento.</p></article><article class="feature"><i>▦</i><h3>Espaço da empresa</h3><p>Tenha acesso separado por empresa, com perfil e dados organizados por conta.</p></article></section>
<section id="planos" class="card" style="margin-bottom:52px"><div class="card-title"><h3>Planos FUTURA AI</h3><span>Preços de referência</span></div><div class="split"><div><strong>Essencial</strong><p class="sub">Para organizar a gestão financeira da empresa.</p><strong style="font-size:24px">R$ 299 <small class="muted" style="font-size:12px">/mês</small></strong></div><div><strong>Profissional</strong><p class="sub">Mais estrutura para times e análises recorrentes.</p><strong style="font-size:24px">R$ 999 <small class="muted" style="font-size:12px">/mês</small></strong></div></div><div style="margin-top:18px;padding-top:17px;border-top:1px solid var(--line)"><strong>Enterprise</strong> <span class="muted">— R$ 2.499/mês, com atendimento e implantação personalizados.</span><p class="muted" style="font-size:11px;margin-bottom:0">Planos e valores são referenciais nesta homologação. Cobrança ainda não está habilitada.</p></div></section>
<div class="footer"><span>© 2026 FUTURA AI · Inteligência financeira para empresas</span><span>Ambiente de homologação</span></div></div></div>
<section id="auth" class="wrap hidden"><header class="top"><a class="brand" href="#"><span class="brandmark">F</span><span>FUTURA AI<small>inteligência financeira</small></span></a><button class="btn ghost small" id="back-home">← Início</button></header><div class="auth-area"><form id="login-form" class="card"><h2>Bem-vindo de volta</h2><p class="sub">Acesse o ambiente de homologação da sua empresa.</p><div class="field"><label for="login-email">E-mail</label><input id="login-email" type="email" autocomplete="username" required></div><div class="field"><label for="login-password">Senha</label><input id="login-password" type="password" autocomplete="current-password" minlength="10" required></div><div class="message" id="login-message"></div><button class="btn" style="width:100%">Entrar na plataforma</button></form><form id="register-form" class="card"><h2>Crie o espaço da empresa</h2><p class="sub">O primeiro cadastro vira administrador desta empresa.</p><div class="field"><label for="register-name">Seu nome</label><input id="register-name" autocomplete="name" required maxlength="80"></div><div class="field"><label for="register-company">Nome da empresa</label><input id="register-company" required maxlength="100"></div><div class="field"><label for="register-email">E-mail de trabalho</label><input id="register-email" type="email" autocomplete="email" required maxlength="160"></div><div class="field"><label for="register-password">Senha (mínimo 10 caracteres)</label><input id="register-password" type="password" autocomplete="new-password" minlength="10" required></div><div class="message" id="register-message"></div><button class="btn secondary" style="width:100%">Criar espaço</button><p class="muted" style="font-size:10px;margin-bottom:0">Homologação sem verificação de e-mail ou redefinição de senha.</p></form></div></section>
<div id="app" class="dash"><div class="app-shell"><aside class="sidebar"><a class="brand" href="#"><span class="brandmark">F</span><span class="brand-text">FUTURA AI<small>painel empresarial</small></span></a><div class="side-label">Workspace</div><nav><button class="navbtn active" data-page="overview">⌂ <span>Visão geral</span></button><button class="navbtn" data-page="transactions">⇄ <span>Movimentações</span></button><button class="navbtn" data-page="projections">⌁ <span>Projeções</span></button><button class="navbtn" data-page="company">▦ <span>Empresa e equipe</span></button></nav><div class="side-bottom"><div class="profile-mini" id="side-profile"></div><button class="btn ghost small" id="logout-button">Sair da conta</button></div></aside><main class="main"><div class="content"><header class="dash-top"><div><h1 id="page-title">Visão geral</h1><p id="company-line"></p></div><div class="top-actions"><span class="pill">● Homologação</span><button class="btn ghost small" id="logout-top">Sair</button></div></header>
<section class="page active" id="page-overview"><div class="grid kpis"><article class="kpi"><div class="label">Saldo líquido <span>◉</span></div><div class="value" id="kpi-net">R$ 0,00</div><div class="trend" id="kpi-net-note">No período importado</div></article><article class="kpi"><div class="label">Receitas <span>↗</span></div><div class="value" id="kpi-income">R$ 0,00</div><div class="trend">Entradas registradas</div></article><article class="kpi"><div class="label">Despesas <span>↘</span></div><div class="value" id="kpi-expense">R$ 0,00</div><div class="trend down">Saídas registradas</div></article><article class="kpi"><div class="label">Lançamentos <span>▤</span></div><div class="value" id="kpi-count">0</div><div class="trend" id="kpi-count-note">Registros nesta empresa</div></article></div><div class="grid two-col"><article class="card"><div class="card-title"><h3>Movimento mensal</h3><span id="graph-period">Últimos 6 meses</span></div><div class="graph" id="overview-graph"></div><div class="chart-foot"><span><i class="dot"></i>Receitas</span><span><i class="dot red"></i>Despesas</span></div></article><article class="card"><div class="card-title"><h3>Despesas por categoria</h3><span>Distribuição</span></div><div id="categories"></div></article></div><article class="card" style="margin-top:14px"><div class="card-title"><h3>Movimentações recentes</h3><button class="btn ghost small" data-goto="transactions">Ver todas</button></div><div id="recent-table" class="table-wrap"></div></article><div class="notice" style="margin-top:14px">Esta conta está em homologação. Use exclusivamente dados fictícios e valide os resultados antes de qualquer uso operacional.</div></section>
<section class="page" id="page-transactions"><div class="toolbar"><button class="btn" id="upload-csv">Importar CSV</button><button class="btn secondary" id="demo-import">Carregar dados de demonstração</button><a class="btn ghost small" href="/demo.csv" download>Baixar CSV de exemplo</a><input id="file-input" type="file" accept=".csv,text/csv" class="hidden"></div><div class="card"><div class="card-title"><h3>Movimentações</h3><span id="transaction-count">0 lançamentos</span></div><div id="transaction-table" class="table-wrap"></div></div><p class="sub" style="margin-top:10px">Formato: data;descricao;tipo;valor;categoria · Use receita/despesa e valores em reais.</p></section>
<section class="page" id="page-projections"><div class="grid scenario-grid"><form id="scenario-form" class="card"><h3>Novo cenário</h3><p class="sub">Uma projeção simples a partir do saldo líquido atual. Não é recomendação financeira.</p><div class="field"><label for="scenario-name">Nome do cenário</label><input id="scenario-name" maxlength="80" value="Crescimento base" required></div><div class="field"><label for="scenario-growth">Crescimento mensal estimado (%)</label><input id="scenario-growth" type="number" step="0.1" min="-50" max="100" value="5" required></div><div class="field"><label for="scenario-months">Horizonte (meses)</label><select id="scenario-months"><option value="3">3 meses</option><option value="6" selected>6 meses</option><option value="12">12 meses</option></select></div><div class="message" id="scenario-message"></div><button class="btn">Salvar cenário</button></form><article class="card"><div class="card-title"><h3>Projeção de caixa</h3><span>Estimativa matemática</span></div><div id="scenario-preview" class="scenario-result"><span class="muted">Saldo inicial</span><strong id="scenario-current">R$ 0,00</strong><span class="muted" id="scenario-end-label">Saldo projetado em 6 meses</span><strong class="positive" id="scenario-end">R$ 0,00</strong></div><div class="notice" style="margin-top:14px">A projeção usa taxa mensal composta sobre o saldo líquido importado. Não inclui impostos, sazonalidade, inflação ou compromissos futuros.</div></article></div><article class="card" style="margin-top:14px"><div class="card-title"><h3>Cenários salvos</h3><span>Privados à empresa</span></div><div id="scenario-list"></div></article></section>
<section class="page" id="page-company"><div class="grid split"><article class="card"><div class="card-title"><h3>Empresa</h3><span class="badge">Conta isolada</span></div><div class="row"><div class="who">Razão social / nome<small id="company-name"></small></div></div><div class="row"><div class="who">Plano de referência<small id="company-plan"></small></div></div><div class="row"><div class="who">Identificador da empresa<small id="company-id" style="font-family:monospace"></small></div></div><div class="notice" style="margin-top:14px">Os lançamentos e projeções são sempre consultados pelo identificador desta empresa.</div></article><article class="card"><div class="card-title"><h3>Meu perfil</h3><span id="my-role" class="badge"></span></div><div class="row"><div class="who">Nome<small id="my-name"></small></div></div><div class="row"><div class="who">E-mail<small id="my-email"></small></div></div><div class="row"><div class="who">Acesso<small id="my-access"></small></div></div></article></div><article class="card" style="margin-top:14px"><div class="card-title"><h3>Equipe</h3><span id="team-count">0 pessoas</span></div><div id="team-list"></div><div class="notice" style="margin-top:14px">Convites por e-mail e administração de acessos serão habilitados numa próxima etapa.</div></article></section>
</div></main></div></div>
<div id="toast-host" style="position:fixed;right:16px;bottom:80px;z-index:20"></div>
<script>
const $=(s)=>document.querySelector(s), $$=(s)=>Array.from(document.querySelectorAll(s));
const state={me:null,dashboard:null,transactions:[],scenarios:[],team:[],page:"overview"};
const money=(v)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v||0));
const esc=(s)=>String(s??"").replace(/[&<>"']/g,c=>c==="&"?"&amp;":c==="<"?"&lt;":c===">"?"&gt;":c==='"'?"&quot;":"&#39;");
async function api(path,options={}){const res=await fetch(path,{...options,headers:{"content-type":"application/json",...(options.headers||{})},credentials:"same-origin"});let data={};try{data=await res.json()}catch{}if(!res.ok)throw new Error(data.error||"Não foi possível concluir a solicitação.");return data}
function toast(text,error=false){const box=document.createElement("div");box.className="pill";box.style.cssText=\`margin-top:8px;background:\${error?"#391923":"#122b29"};border-color:\${error?"#74404a":"#326458"};color:\${error?"#ffbdc3":"#b8f2de"}\`;box.textContent=text;$("#toast-host").append(box);setTimeout(()=>box.remove(),4200)}
function show(marketing){$("#marketing").classList.toggle("hidden",!marketing);$("#auth").classList.toggle("hidden",marketing);$("#app").style.display="none";if(marketing)location.hash=""}
async function showApp(){$("#marketing").classList.add("hidden");$("#auth").classList.add("hidden");$("#app").style.display="block";try{await refreshAll()}catch(e){await logout(false);show(false);toast(e.message,true)}}
async function logout(call=true){if(call)try{await api("/api/auth/logout",{method:"POST",body:"{}"})}catch{}state.me=null;$("#app").style.display="none";show(false)}
function renderTable(rows,target,empty="Nenhum lançamento registrado ainda."){if(!rows.length){$(target).innerHTML=\`<div class="empty">\${empty}</div>\`;return}$(target).innerHTML=\`<table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Tipo</th><th class="right">Valor</th></tr></thead><tbody>\${rows.map(r=>\`<tr><td>\${esc(new Date(r.date+"T00:00:00").toLocaleDateString("pt-BR"))}</td><td>\${esc(r.description)}</td><td>\${esc(r.category)}</td><td><span class="kind \${r.type}">\${r.type==="income"?"Receita":"Despesa"}</span></td><td class="right \${r.type==="income"?"positive":""}">\${money(r.amount_cents/100)}</td></tr>\`).join("")}</tbody></table>\`}
function drawGraph(months){const vals=months||[];const max=Math.max(1,...vals.flatMap(m=>[m.income,m.expense]));$("#overview-graph").innerHTML=vals.map(m=>\`<div class="graph-col"><i style="height:\${Math.max(3,Math.round(m.income/max*94))}%"></i><i class="exp" style="height:\${Math.max(3,Math.round(m.expense/max*94))}%"></i><small>\${esc(m.label)}</small></div>\`).join("")||'<div class="empty">Importe lançamentos para visualizar o fluxo.</div>'}
function renderCategories(categories){const list=categories||[];const total=list.reduce((a,x)=>a+x.amount,0);$("#categories").innerHTML=list.length?list.slice(0,6).map((x,i)=>{const pct=total?Math.round(x.amount/total*100):0;return \`<div class="category-row"><header><span>\${esc(x.category)}</span><span>\${money(x.amount)} · \${pct}%</span></header><div class="progress"><i style="width:\${pct}%;background:\${["linear-gradient(90deg,#70e1dc,#729cff)","linear-gradient(90deg,#e5c47f,#d58976)","linear-gradient(90deg,#af95ee,#758dff)"][i%3]}"></i></div></div>\`}).join(""):'<div class="empty">As categorias aparecem após a importação.</div>'}
function renderScenarios(){const list=state.scenarios;$("#scenario-list").innerHTML=list.length?list.map(x=>\`<div class="row"><div class="who">\${esc(x.name)}<small>\${x.months} meses · \${x.monthly_growth}% ao mês</small></div><div style="text-align:right"><strong>\${money(x.projected_cents/100)}</strong><small class="muted" style="display:block">projeção</small></div></div>\`).join(""):'<div class="empty">Nenhum cenário salvo.</div>'}
function renderTeam(){const list=state.team;$("#team-list").innerHTML=list.map(u=>\`<div class="row"><div class="who">\${esc(u.name)}<small>\${esc(u.email)}</small></div><span class="badge">\${u.role==="owner"?"Administrador":"Financeiro"}</span></div>\`).join("")||'<div class="empty">Nenhum usuário na equipe.</div>';$("#team-count").textContent=\`\${list.length} \${list.length===1?"pessoa":"pessoas"}\`}
async function refreshAll(){const [me,dash,tx,sc,team]=await Promise.all([api("/api/me"),api("/api/dashboard"),api("/api/transactions"),api("/api/scenarios"),api("/api/team")]);state.me=me;state.dashboard=dash;state.transactions=tx.transactions;state.scenarios=sc.scenarios;state.team=team.users;renderAll()}
function renderAll(){const m=state.me,d=state.dashboard;$("#company-line").textContent=m.company_name;$("#side-profile").textContent=m.name+" · "+m.email;$("#company-name").textContent=m.company_name;$("#company-plan").textContent=m.plan;$("#company-id").textContent=m.tenant_id;$("#my-role").textContent=m.role==="owner"?"Administrador":"Financeiro";$("#my-name").textContent=m.name;$("#my-email").textContent=m.email;$("#my-access").textContent=m.role==="owner"?"Administrador da empresa":"Acesso financeiro";$("#kpi-income").textContent=money(d.income_cents/100);$("#kpi-expense").textContent=money(d.expense_cents/100);$("#kpi-net").textContent=money(d.net_cents/100);$("#kpi-net").className="value "+(d.net_cents>=0?"positive":"");$("#kpi-count").textContent=d.count.toLocaleString("pt-BR");$("#kpi-count-note").textContent=d.count?"Registros nesta empresa":"Importe um CSV para começar";drawGraph(d.months);renderCategories(d.categories);renderTable(state.transactions.slice(0,6),"#recent-table");renderTable(state.transactions,"#transaction-table");$("#transaction-count").textContent=\`\${state.transactions.length} lançamentos\`;renderScenarios();renderTeam();updatePreview()}
function updatePreview(){const bal=(state.dashboard?.net_cents||0)/100;const rate=Number($("#scenario-growth").value||0)/100;const months=Number($("#scenario-months").value||6);const value=bal*Math.pow(1+rate,months);$("#scenario-current").textContent=money(bal);$("#scenario-end").textContent=money(value);$("#scenario-end-label").textContent=\`Saldo projetado em \${months} \${months===1?"mês":"meses"}\`}
function go(page){state.page=page;$$('.navbtn').forEach(b=>b.classList.toggle("active",b.dataset.page===page));$$('.page').forEach(p=>p.classList.toggle("active",p.id===\`page-\${page}\`));$("#page-title").textContent=({overview:"Visão geral",transactions:"Movimentações",projections:"Projeções",company:"Empresa e equipe"})[page];}
$$('a[href="#acesso"]').forEach(a=>a.addEventListener("click",e=>{e.preventDefault();show(false);history.replaceState(null,"",location.pathname+"#acesso")}));$$('.navbtn').forEach(b=>b.addEventListener("click",()=>go(b.dataset.page)));$$('[data-goto]').forEach(b=>b.addEventListener("click",()=>go(b.dataset.goto)));$("#back-home").addEventListener("click",()=>{show(true);history.replaceState(null,"",location.pathname)});
$("#login-form").addEventListener("submit",async e=>{e.preventDefault();const msg=$("#login-message");msg.textContent="";try{await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:$("#login-email").value,password:$("#login-password").value})});await showApp()}catch(err){msg.textContent=err.message}});
$("#register-form").addEventListener("submit",async e=>{e.preventDefault();const msg=$("#register-message");msg.textContent="";try{await api("/api/auth/register",{method:"POST",body:JSON.stringify({name:$("#register-name").value,company:$("#register-company").value,email:$("#register-email").value,password:$("#register-password").value})});await showApp()}catch(err){msg.textContent=err.message}});
$("#logout-button").addEventListener("click",()=>logout());$("#logout-top").addEventListener("click",()=>logout());$("#scenario-growth").addEventListener("input",updatePreview);$("#scenario-months").addEventListener("change",updatePreview);
$("#scenario-form").addEventListener("submit",async e=>{e.preventDefault();const msg=$("#scenario-message");msg.textContent="";try{await api("/api/scenarios",{method:"POST",body:JSON.stringify({name:$("#scenario-name").value,monthly_growth:Number($("#scenario-growth").value),months:Number($("#scenario-months").value)})});await refreshAll();toast("Cenário salvo nesta empresa.")}catch(err){msg.textContent=err.message}});
$("#upload-csv").addEventListener("click",()=>$("#file-input").click());$("#file-input").addEventListener("change",async e=>{const file=e.target.files[0];if(!file)return;try{const result=await api("/api/transactions/import",{method:"POST",headers:{"content-type":"text/csv"},body:await file.text()});await refreshAll();toast(\`\${result.imported} lançamentos importados.\`)}catch(err){toast(err.message,true)}finally{e.target.value=""}});
$("#demo-import").addEventListener("click",async()=>{if(state.transactions.length&&!confirm("A empresa já tem lançamentos. Deseja adicionar novamente os dados de demonstração?"))return;try{const result=await api("/api/transactions/import",{method:"POST",headers:{"content-type":"text/csv"},body:${JSON.stringify(DEMO_CSV)}});await refreshAll();toast(\`\${result.imported} registros fictícios importados.\`)}catch(err){toast(err.message,true)}});
async function boot(){try{await api("/api/me");await showApp()}catch{if(location.hash==="#acesso"){show(false);return}show(true)}}boot();
</script></body></html>`;

async function handleApi(request, env, url) {
  const db = env.DB;
  const path = url.pathname;
  if (request.method !== "GET" && !checkOrigin(request)) return fail("Origem inválida.", 403);
  if (path === "/api/health" && request.method === "GET") {
    try { await db.prepare("SELECT 1 AS ok").first(); return json({ status: "ok", environment: env.ENVIRONMENT || "homologacao", database: "connected" }); }
    catch { return fail("Banco de dados indisponível.", 503); }
  }
  if (path === "/api/auth/register" && request.method === "POST") {
    let input; try { input = await request.json(); } catch { return fail("Dados inválidos."); }
    const name = String(input.name || "").trim();
    const company = String(input.company || "").trim();
    const email = String(input.email || "").trim().toLowerCase();
    const password = String(input.password || "");
    if (name.length < 2 || name.length > 80 || company.length < 2 || company.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) return fail("Confira nome, empresa e e-mail.");
    if (password.length < 10 || password.length > 128) return fail("A senha deve ter entre 10 e 128 caracteres.");
    const existing = await db.prepare("SELECT id FROM users WHERE email = ? LIMIT 1").bind(email).first();
    if (existing) return fail("Este e-mail já tem uma conta.", 409);
    const tenant = { id: id(), name: company };
    const user = { id: id(), name, email, role: "owner" };
    const salt = randomHex(16), passwordHash = await hashPassword(password, salt), now = new Date().toISOString();
    try {
      await db.batch([
        db.prepare("INSERT INTO tenants (id, name, plan, status, created_at) VALUES (?, ?, 'Essencial — homologação', 'active', ?)").bind(tenant.id, tenant.name, now),
        db.prepare("INSERT INTO users (id, tenant_id, name, email, password_hash, password_salt, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'owner', 'active', ?)").bind(user.id, tenant.id, user.name, user.email, passwordHash, salt, now),
      ]);
    } catch { return fail("Não foi possível criar a conta. Verifique se o e-mail já está cadastrado.", 409); }
    const session = await createSession(db, user, tenant);
    return json({ ok: true }, 201, { "set-cookie": sessionCookie(session.token, session.expires) });
  }
  if (path === "/api/auth/login" && request.method === "POST") {
    let input; try { input = await request.json(); } catch { return fail("Dados inválidos."); }
    const email = String(input.email || "").trim().toLowerCase(), password = String(input.password || "");
    if (email.length > 160 || password.length > 128) return fail("E-mail ou senha inválidos.", 401);
    const record = await db.prepare(`SELECT u.id, u.name, u.email, u.role, u.password_hash, u.password_salt, t.id AS tenant_id, t.name AS company_name
      FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.email=? AND u.status='active' AND t.status='active' LIMIT 1`).bind(email).first();
    const candidate = await hashPassword(password, record?.password_salt || "futura-no-user-salt");
    if (!record || !safeEqual(candidate, record.password_hash)) return fail("E-mail ou senha inválidos.", 401);
    const session = await createSession(db, record, { id: record.tenant_id });
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(session.token, session.expires) });
  }
  if (path === "/api/auth/logout" && request.method === "POST") {
    const token = cookieValue(request, "futura_session");
    if (token) await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "set-cookie": clearCookie });
  }
  if (path === "/api/me" && request.method === "GET") {
    const user = await requireUser(request, db);
    if (!user) return fail("Sessão expirada.", 401);
    return json({ id: user.id, name: user.name, email: user.email, role: user.role, tenant_id: user.tenant_id, company_name: user.company_name, plan: user.plan });
  }
  const user = await requireUser(request, db);
  if (!user) return fail("Faça login para continuar.", 401);
  const tenantId = user.tenant_id;
  if (path === "/api/dashboard" && request.method === "GET") {
    const summary = await db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount_cents ELSE 0 END),0) AS income_cents,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount_cents ELSE 0 END),0) AS expense_cents, COUNT(*) AS count FROM transactions WHERE tenant_id=?`).bind(tenantId).first();
    const monthRows = await db.prepare(`SELECT substr(date,1,7) AS month, SUM(CASE WHEN type='income' THEN amount_cents ELSE 0 END) AS income,
      SUM(CASE WHEN type='expense' THEN amount_cents ELSE 0 END) AS expense FROM transactions WHERE tenant_id=? AND date >= date('now','-5 months','start of month') GROUP BY month ORDER BY month`).bind(tenantId).all();
    const catRows = await db.prepare("SELECT category, SUM(amount_cents) AS amount FROM transactions WHERE tenant_id=? AND type='expense' GROUP BY category ORDER BY amount DESC LIMIT 8").bind(tenantId).all();
    const labels = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
    const monthData = (monthRows.results || []).map((row) => ({ ...row, label: labels[Number(row.month.slice(5, 7)) - 1] + "." }));
    const income = Number(summary.income_cents), expense = Number(summary.expense_cents);
    return json({ ...summary, net_cents: income - expense, months: monthData, categories: (catRows.results || []).map((row) => ({ ...row, amount: money(row.amount) })) });
  }
  if (path === "/api/transactions" && request.method === "GET") {
    const result = await db.prepare("SELECT id, date, description, type, amount_cents, category, created_at FROM transactions WHERE tenant_id=? ORDER BY date DESC, created_at DESC LIMIT 500").bind(tenantId).all();
    return json({ transactions: result.results || [] });
  }
  if (path === "/api/transactions/import" && request.method === "POST") {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 1024 * 1024) return fail("O arquivo deve ter no máximo 1 MB.", 413);
    const text = await request.text();
    if (text.length > 1024 * 1024) return fail("O arquivo deve ter no máximo 1 MB.", 413);
    let rows; try { rows = parseCsv(text); } catch (error) { return fail(error.message); }
    const now = new Date().toISOString();
    try {
      const stmts = rows.map((row) => db.prepare("INSERT INTO transactions (id, tenant_id, date, description, type, amount_cents, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id(), tenantId, row.date, row.description, row.type, row.amount_cents, row.category, now));
      await db.batch(stmts);
    } catch { return fail("A importação não foi concluída. Nenhum dado do arquivo atual deve ser considerado confirmado.", 500); }
    return json({ imported: rows.length });
  }
  if (path === "/api/scenarios" && request.method === "GET") {
    const result = await db.prepare("SELECT id, name, monthly_growth, months, base_cents, projected_cents, created_at FROM scenarios WHERE tenant_id=? ORDER BY created_at DESC LIMIT 50").bind(tenantId).all();
    return json({ scenarios: result.results || [] });
  }
  if (path === "/api/scenarios" && request.method === "POST") {
    let input; try { input = await request.json(); } catch { return fail("Dados inválidos."); }
    const name = String(input.name || "").trim(), monthly = Number(input.monthly_growth), months = Number(input.months);
    if (!name || name.length > 80 || !Number.isFinite(monthly) || monthly < -50 || monthly > 100 || ![3,6,12].includes(months)) return fail("Confira nome, crescimento e horizonte do cenário.");
    const summary = await db.prepare("SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount_cents ELSE -amount_cents END),0) AS balance FROM transactions WHERE tenant_id=?").bind(tenantId).first();
    const base = Number(summary.balance), projected = Math.round(base * Math.pow(1 + monthly / 100, months));
    const scenarioId = id();
    await db.prepare("INSERT INTO scenarios (id, tenant_id, user_id, name, monthly_growth, months, base_cents, projected_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(scenarioId, tenantId, user.id, name, monthly, months, base, projected, new Date().toISOString()).run();
    return json({ id: scenarioId, projected_cents: projected }, 201);
  }
  if (path === "/api/team" && request.method === "GET") {
    const result = await db.prepare("SELECT id, name, email, role, created_at FROM users WHERE tenant_id=? AND status='active' ORDER BY created_at").bind(tenantId).all();
    return json({ users: result.results || [] });
  }
  return fail("Rota não encontrada.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/demo.csv") return new Response(DEMO_CSV, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=futuraai-dados-demo.csv", "cache-control": "no-store" } });
    if (url.pathname.startsWith("/api/")) {
      try { return await handleApi(request, env, url); }
      catch { return fail("Erro interno. Tente novamente.", 500); }
    }
    if (request.method !== "GET" && request.method !== "HEAD") return fail("Método não permitido.", 405);
    return new Response(APP_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY", "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" } });
  },
};
