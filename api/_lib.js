// Funções comuns das rotas /api (Vercel). Arquivos com "_" no início não viram rotas.
const MP = 'https://api.mercadopago.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function env(n) { const v = process.env[n]; return v ? String(v).trim() : ''; }
function faltando() {
  return ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'MP_ACCESS_TOKEN'].filter(n => !env(n));
}
function faltandoBase() {
  return ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY'].filter(n => !env(n));
}
// Chama o Mercado Pago com o token de OUTRA conta (o do salão), nunca o da plataforma.
async function mpCom(token, caminho, opc) {
  const r = await fetch(MP + caminho, Object.assign({}, opc, {
    headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, opc && opc.headers)
  }));
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { j = null; }
  return { ok: r.ok, status: r.status, dados: j };
}
function siteUrl(req) {
  const e = env('SITE_URL');
  if (e) return e.replace(/\/+$/, '');
  // Sem SITE_URL: usa o domínio da própria requisição, só se parecer um domínio de verdade (evita endereço forjado em cabeçalho).
  const h = String(req.headers.host || req.headers['x-forwarded-host'] || '').split(',')[0].trim().toLowerCase();
  return /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/.test(h) ? 'https://' + h : '';
}
// Chave de serviço: a chave nova (sb_secret_...) vai só em "apikey"; a antiga (JWT) vai nos dois.
function cabServico() {
  const k = env('SUPABASE_SERVICE_KEY');
  const h = { apikey: k, 'Content-Type': 'application/json' };
  if (k.startsWith('eyJ')) h.Authorization = 'Bearer ' + k;
  return h;
}
async function rpcServico(nome, args) {
  const r = await fetch(env('SUPABASE_URL').replace(/\/+$/, '') + '/rest/v1/rpc/' + nome, {
    method: 'POST', headers: cabServico(), body: JSON.stringify(args || {})
  });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { j = t; }
  if (!r.ok) { const e = new Error((j && j.message) || ('Erro ' + r.status + ' em ' + nome)); e.status = r.status; throw e; }
  return j;
}
async function mp(caminho, opc) {
  const r = await fetch(MP + caminho, Object.assign({}, opc, {
    headers: Object.assign({ Authorization: 'Bearer ' + env('MP_ACCESS_TOKEN'), 'Content-Type': 'application/json' }, opc && opc.headers)
  }));
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { j = null; }
  return { ok: r.ok, status: r.status, dados: j };
}
function json(res, codigo, obj) {
  res.statusCode = codigo;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
async function corpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return {};
}
function dataSP(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
module.exports = { env, faltando, faltandoBase, mpCom, siteUrl, rpcServico, mp, json, corpo, dataSP, UUID };
