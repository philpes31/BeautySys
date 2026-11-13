
// POST /api/mp-conectar  { token }  ou  { remover: true }   (cabeçalho Authorization: login da proprietária)
// Guarda o Access Token do Mercado Pago DO SALÃO, para o sinal cair direto na conta dele.
// O token só é guardado depois de o Mercado Pago confirmar que ele é válido, e nunca volta para o navegador.
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { erro: 'Método não permitido.' }); }
  if (L.faltandoBase().length) return L.json(res, 503, { erro: 'Servidor ainda não configurado.' });
  const auth = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+/.test(auth)) return L.json(res, 401, { erro: 'Entre no sistema.' });
  const base = L.env('SUPABASE_URL').replace(/\/+$/, '');
  let tenant;
  try {
    const r = await fetch(base + '/rest/v1/rpc/mp_meu_salao', { method: 'POST', headers: { apikey: L.env('SUPABASE_ANON_KEY'), Authorization: auth, 'Content-Type': 'application/json' }, body: '{}' });
    if (r.status === 401 || r.status === 403) return L.json(res, 401, { erro: 'Sessão expirada. Entre de novo.' });
    if (!r.ok) return L.json(res, 502, { erro: 'Não foi possível confirmar quem você é.' });
    tenant = await r.json();
  } catch (_) { return L.json(res, 502, { erro: 'Não foi possível confirmar quem você é.' }); }
  if (!L.UUID.test(String(tenant || ''))) return L.json(res, 403, { erro: 'Só a proprietária do salão pode conectar o Mercado Pago.' });
  const b = await L.corpo(req);
  try {
    if (b.remover === true) {
      await L.rpcServico('mp_salvar_token', { p_tenant: tenant, p_token: '', p_user: null });
      return L.json(res, 200, { ok: true, conectado: false });
    }
    const token = String(b.token || '').trim();
    if (!/^(APP_USR|TEST)-[A-Za-z0-9_-]{16,300}$/.test(token)) return L.json(res, 400, { erro: 'Esse não parece um Access Token do Mercado Pago. Ele começa com APP_USR-.' });
    const r = await L.mpCom(token, '/users/me', { method: 'GET' });
    if (r.status === 401 || r.status === 403) return L.json(res, 400, { erro: 'O Mercado Pago não aceitou esse token. Copie de novo, sem espaços.' });
    if (!r.ok || !r.dados || !r.dados.id) return L.json(res, 502, { erro: 'O Mercado Pago não respondeu. Tente de novo.' });
    await L.rpcServico('mp_salvar_token', { p_tenant: tenant, p_token: token, p_user: String(r.dados.id) });
    return L.json(res, 200, { ok: true, conectado: true, conta: String(r.dados.nickname || r.dados.email || r.dados.id).replace(/(.{2}).+(@.*)?/, '$1***$2') });
  } catch (e) {
    console.error('mp-conectar:', e.message);
    return L.json(res, 500, { erro: 'Não foi possível salvar.' });
  }
};
