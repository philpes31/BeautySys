// Renova o acesso do WhatsApp dos salões que conectaram pelo "Conectar com o Facebook" (vale 60 dias).
// Chamado pela rotina diária (api/cron.js). Troca o acesso atual por um novo de mais 60 dias, direto no servidor,
// usando o segredo do app (só existe nas variáveis da Vercel). Se a Meta recusar de vez, marca o salão para "Reconectar".
const L = require('./_lib');
const GRAPH = 'https://graph.facebook.com/v25.0';

async function renovarUm(app, seg, tenant, token) {
  const q = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: app, client_secret: seg, set_token_expires_in_60_days: 'true', fb_exchange_token: token });
  let r, j = null;
  try { r = await fetch(GRAPH + '/oauth/access_token?' + q.toString()); } catch (_) { return 'rede'; }   // sem internet agora: tenta amanhã
  try { j = await r.json(); } catch (_) { j = null; }
  const novo = j && j.access_token;
  if (r.ok && novo) {
    const s = Number(j.expires_in);
    const expira = s > 0 && s < 3.2e8 ? new Date(Date.now() + s * 1000).toISOString() : null;
    await L.rpcServico('wa_token_renovado', { p_tenant: tenant, p_token: novo, p_expira: expira });
    return 'ok';
  }
  const e = j && j.error ? j.error : {};
  // erro do servidor ou limite de uso: tenta de novo amanhã. Acesso recusado (190 etc.): precisa reconectar.
  if (r.status >= 500 || e.code === 1 || e.code === 2 || e.code === 4 || e.code === 17 || e.code === 341) return 'adiado';
  await L.rpcServico('wa_token_falhou', { p_tenant: tenant, p_erro: String(e.message || ('erro ' + r.status)).slice(0, 200) });
  return 'falhou';
}

async function renovarTodos() {
  const app = L.env('META_APP_ID'), seg = L.env('META_APP_SECRET');
  if (!app || !seg) return null;
  const lista = await L.rpcServico('wa_tokens_vencendo', { p_dias: 15 });
  const res = { ok: 0, falhou: 0, adiado: 0 };
  for (const x of Array.isArray(lista) ? lista.slice(0, 100) : []) {
    try {
      const o = await renovarUm(app, seg, x.tenant_id, x.token);
      if (o === 'ok') res.ok++; else if (o === 'falhou') res.falhou++; else res.adiado++;
    } catch (e) { res.adiado++; console.error('renovar token:', e.message); }
  }
  return res;
}
module.exports = { renovarTodos, renovarUm };
