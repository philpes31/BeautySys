// POST /api/wa-conectar  { phone_id, token }  ou  { remover: true }   (cabeçalho Authorization: login da proprietária)
// Guarda o WhatsApp Business DO SALÃO (código do número + token da Meta) para os lembretes saírem do número dele.
// Só guarda depois de a Meta confirmar que o token funciona para aquele número. O token nunca volta para o navegador.
const L = require('./_lib');
const GRAPH = 'https://graph.facebook.com/v21.0';

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { erro: 'Método não permitido.' }); }
  if (L.faltandoBase().length) return L.json(res, 503, { erro: 'Servidor ainda não configurado.' });
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
  try {
    if (b.remover === true) {
      await L.rpcServico('wa_conta_gravar', { p_tenant: tenant, p_phone: '', p_token: '', p_numero: null, p_nome: null });
      return L.json(res, 200, { ok: true, conectado: false });
    }
    const phone = String(b.phone_id || '').replace(/\s+/g, '');
    const token = String(b.token || '').replace(/\s+/g, '');
    if (!/^[0-9]{8,20}$/.test(phone)) return L.json(res, 400, { erro: 'O "ID do número de telefone" tem só números (de 8 a 20 dígitos). Não é o telefone nem o ID da conta.' });
    if (!/^[A-Za-z0-9_-]{20,600}$/.test(token)) return L.json(res, 400, { erro: 'Esse não parece um token da Meta. Copie de novo, inteiro e sem espaços.' });
    let j = null, r;
    try {
      r = await fetch(GRAPH + '/' + phone + '?fields=display_phone_number,verified_name', { headers: { Authorization: 'Bearer ' + token } });
      try { j = await r.json(); } catch (_) { j = null; }
    } catch (_) { return L.json(res, 502, { erro: 'Não consegui falar com a Meta. Tente de novo.' }); }
    if (!r.ok) {
      const cod = j && j.error && j.error.code;
      if (r.status === 401 || cod === 190) return L.json(res, 400, { erro: 'A Meta não aceitou esse token. Gere um token permanente e copie de novo.' });
      if (r.status === 400 || r.status === 403 || r.status === 404 || cod === 100 || cod === 10) return L.json(res, 400, { erro: 'Esse token não tem acesso a esse número. Confira o ID do número de telefone e se o token foi criado para a mesma conta.' });
      return L.json(res, 502, { erro: 'A Meta não respondeu direito. Tente de novo.' });
    }
    const numero = String((j && j.display_phone_number) || '').slice(0, 30), nome = String((j && j.verified_name) || '').slice(0, 80);
    await L.rpcServico('wa_conta_gravar', { p_tenant: tenant, p_phone: phone, p_token: token, p_numero: numero, p_nome: nome });
    return L.json(res, 200, { ok: true, conectado: true, numero, nome });
  } catch (e) {
    console.error('wa-conectar:', e.message);
    return L.json(res, 500, { erro: 'Não foi possível salvar.' });
  }
};
