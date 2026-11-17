// POST /api/wa-signup  { code, phone_id, waba_id }   (Authorization: login da proprietária)
// Finaliza o "Conectar com o Facebook" (Cadastro Incorporado da Meta): troca o código pelo acesso do salão,
// confere o número, registra o número na Cloud API, assina os avisos, cria os 3 modelos de mensagem e guarda tudo no servidor.
// O acesso nunca volta para o navegador. Fica desligado até existirem META_APP_ID, META_APP_SECRET e META_CONFIG_ID.
const L = require('./_lib');
const M = require('./_modelos');
const GRAPH = 'https://graph.facebook.com/v25.0';

async function g(caminho, o = {}) {
  const r = await fetch(GRAPH + caminho, o);
  let j = null; try { j = await r.json(); } catch (_) { j = null; }
  return { ok: r.ok, status: r.status, j };
}
const hdr = t => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { erro: 'Método não permitido.' }); }
  if (L.faltandoBase().length) return L.json(res, 503, { erro: 'Servidor ainda não configurado.' });
  const app = L.env('META_APP_ID'), seg = L.env('META_APP_SECRET');
  if (!app || !seg || !L.env('META_CONFIG_ID')) return L.json(res, 503, { erro: 'A conexão pelo Facebook ainda não foi ativada pelo Agendio.' });
  const auth = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+/.test(auth)) return L.json(res, 401, { erro: 'Entre no sistema.' });
  const base = L.env('SUPABASE_URL').replace(/\/+$/, '');
  let tenant;
  try {
    const r = await fetch(base + '/rest/v1/rpc/wa_meu_salao', { method: 'POST', headers: { apikey: L.env('SUPABASE_ANON_KEY'), Authorization: auth, 'Content-Type': 'application/json' }, body: '{}' });
    if (r.status === 401 || r.status === 403) return L.json(res, 401, { erro: 'Sessão expirada. Entre de novo.' });
    if (r.status === 404) return L.json(res, 503, { erro: 'Falta rodar o SQL da Etapa 38 no Supabase (agendio-TUDO.sql).' });
    if (!r.ok) return L.json(res, 502, { erro: 'Não foi possível confirmar quem você é.' });
    tenant = await r.json();
  } catch (_) { return L.json(res, 502, { erro: 'Não foi possível confirmar quem você é.' }); }
  if (!L.UUID.test(String(tenant || ''))) return L.json(res, 403, { erro: 'Só a proprietária do salão pode conectar o WhatsApp.' });

  const b = await L.corpo(req);
  const code = String(b.code || ''), phone = String(b.phone_id || ''), waba = String(b.waba_id || '');
  if (!/^[A-Za-z0-9_-]{10,1000}$/.test(code) || !/^[0-9]{8,20}$/.test(phone) || !/^[0-9]{8,30}$/.test(waba)) return L.json(res, 400, { erro: 'A conexão não foi concluída. Tente de novo.' });
  try {
    // 1) troca o código pelo acesso (o segredo do app fica só aqui)
    const t = await g('/oauth/access_token?' + new URLSearchParams({ client_id: app, client_secret: seg, code }).toString());
    const token = t.j && t.j.access_token;
    // o acesso desse fluxo vale 60 dias: guardamos a validade para a rotina diária renovar (sem validade = não expira)
    const seg_ = Number(t.j && t.j.expires_in);
    const expira = seg_ > 0 && seg_ < 3.2e8 ? new Date(Date.now() + seg_ * 1000).toISOString() : null;
    if (!t.ok || !token) return L.json(res, 400, { erro: 'A Meta não aceitou a conexão. Tente de novo.' });
    // 2) confere se esse acesso enxerga mesmo o número informado
    const n = await g('/' + phone + '?fields=display_phone_number,verified_name', { headers: hdr(token) });
    if (!n.ok) return L.json(res, 400, { erro: 'Não foi possível confirmar o número na Meta. Tente de novo.' });
    // 3) registra o número na Cloud API e assina os avisos da conta (falhas aqui não impedem a conexão)
    const avisos = [];
    const reg = await g('/' + phone + '/register', { method: 'POST', headers: hdr(token), body: JSON.stringify({ messaging_product: 'whatsapp', pin: String(Math.floor(100000 + Math.random() * 900000)) }) });
    if (!reg.ok) avisos.push('registro');
    const sub = await g('/' + waba + '/subscribed_apps', { method: 'POST', headers: hdr(token), body: '{}' });
    if (!sub.ok) avisos.push('assinatura');
    // 4) cria os modelos de mensagem na conta do salão (a Meta ainda precisa aprovar)
    let modelos = 0;
    for (const m of M.MODELOS) {
      const r = await g('/' + waba + '/message_templates', { method: 'POST', headers: hdr(token), body: JSON.stringify(M.corpo(m)) });
      const dup = r.j && r.j.error && (r.j.error.code === 2388023 || /already exists|já existe/i.test(String(r.j.error.message || '')));
      if (r.ok || dup) modelos++; else avisos.push('modelo ' + m.name);
    }
    const numero = String((n.j && n.j.display_phone_number) || '').slice(0, 30), nome = String((n.j && n.j.verified_name) || '').slice(0, 80);
    await L.rpcServico('wa_conta_gravar', { p_tenant: tenant, p_phone: phone, p_token: token, p_numero: numero, p_nome: nome, p_waba: waba, p_expira: expira });
    return L.json(res, 200, { ok: true, conectado: true, numero, nome, modelos_criados: modelos, avisos });
  } catch (e) {
    console.error('wa-signup:', e.message);
    return L.json(res, 500, { erro: 'Não foi possível concluir a conexão.' });
  }
};
