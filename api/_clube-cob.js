// Cobrança da mensalidade do clube pelo Mercado Pago do SALÃO.
//  POST /api/clube-cobrar  { cobranca_id }  -> { url }   (o id vem de uma função protegida do banco; o valor vem do banco)
//  POST /api/clube-webhook?c=<id>           (aviso do Mercado Pago; conferimos o pagamento com o token do salão antes de registrar)
const L = require('./_lib');

async function cobrar(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { erro: 'Método não permitido.' }); }
  if (L.faltandoBase().length) return L.json(res, 503, { erro: 'Pagamento online ainda não configurado.' });
  const b = await L.corpo(req);
  const id = String(b.cobranca_id || '');
  if (!L.UUID.test(id)) return L.json(res, 400, { erro: 'Cobrança inválida.' });
  let c;
  try { c = await L.rpcServico('clube_cob_contexto', { p_id: id }); }
  catch (_) { return L.json(res, 502, { erro: 'Não foi possível consultar a cobrança.' }); }
  if (!c) return L.json(res, 404, { erro: 'Cobrança não encontrada.' });
  if (c.status === 'pago') return L.json(res, 409, { erro: 'Esta mensalidade já foi paga.' });
  if (c.status !== 'aguardando') return L.json(res, 409, { erro: 'Esta cobrança foi cancelada. Gere uma nova.' });
  if (!c.token) return L.json(res, 409, { erro: 'Conecte o Mercado Pago do salão primeiro (Configurações do salão).' });
  if (c.link) return L.json(res, 200, { url: c.link, reaproveitado: true });
  const valor = Math.round(Number(c.valor) * 100) / 100;
  if (!(valor >= 1)) return L.json(res, 409, { erro: 'Valor inválido.' });
  const site = L.siteUrl(req);
  const pref = {
    items: [{ id, title: String('Mensalidade ' + c.nome + ' - ' + c.salao).slice(0, 120), quantity: 1, currency_id: 'BRL', unit_price: valor }],
    external_reference: id,
    notification_url: site + '/api/clube-webhook?c=' + id,
    expires: true,
    expiration_date_to: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
    statement_descriptor: String(c.salao || 'CLUBE').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 13) || 'CLUBE'
  };
  const r = await L.mpCom(c.token, '/checkout/preferences', { method: 'POST', body: JSON.stringify(pref) });
  if (r.status === 401 || r.status === 403) return L.json(res, 409, { erro: 'Reconecte o Mercado Pago do salão (o acesso venceu).' });
  const url = r.dados && r.dados.init_point;
  if (!r.ok || !url) return L.json(res, 502, { erro: 'O Mercado Pago não respondeu. Tente de novo em instantes.' });
  try { await L.rpcServico('clube_cob_gravar_link', { p_id: id, p_link: url }); } catch (_) { /* o link continua válido */ }
  return L.json(res, 200, { url });
}

async function webhook(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return L.json(res, 405, { erro: 'Método não permitido.' });
  if (L.faltandoBase().length) return L.json(res, 503, { erro: 'Não configurado.' });
  const q = req.query || {}, b = await L.corpo(req);
  const cob = String(q.c || '');
  const tipo = String(q.type || q.topic || b.type || b.topic || '');
  const id = String(q['data.id'] || (b.data && b.data.id) || (tipo === 'payment' && (q.id || b.id)) || '');
  if (!L.UUID.test(cob) || tipo !== 'payment' || !/^\d{1,20}$/.test(id)) return L.json(res, 200, { ok: true, ignorado: true });
  try {
    const c = await L.rpcServico('clube_cob_contexto', { p_id: cob });
    if (!c || !c.token) return L.json(res, 200, { ok: true, ignorado: 'cobrança ou conta não encontradas' });
    if (c.status === 'pago') return L.json(res, 200, { ok: true, repetido: true });
    const r = await L.mpCom(c.token, '/v1/payments/' + id, { method: 'GET' });
    if (r.status === 404) return L.json(res, 200, { ok: true, ignorado: 'pagamento não encontrado' });
    if (!r.ok) return L.json(res, 502, { erro: 'Mercado Pago indisponível.' });
    const p = r.dados || {};
    if (String(p.external_reference || '') !== cob) return L.json(res, 200, { ok: true, ignorado: 'pagamento de outra cobrança' });
    if (p.status !== 'approved') return L.json(res, 200, { ok: true, situacao: p.status || 'desconhecida' });
    if (String(p.currency_id || 'BRL') !== 'BRL') return L.json(res, 200, { ok: true, ignorado: 'moeda diferente' });
    const g = await L.rpcServico('clube_cob_pagar', { p_id: cob, p_mp_id: id, p_valor: Number(p.transaction_amount) });
    return L.json(res, 200, { ok: !!(g && g.ok) });
  } catch (e) {
    console.error('clube-webhook:', e.message);
    return L.json(res, 500, { erro: 'Falha ao registrar a mensalidade.' });
  }
}
module.exports = { cobrar, webhook };
