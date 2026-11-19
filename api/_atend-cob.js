// Cobrança de um atendimento pendente pelo Mercado Pago do SALÃO.
//  POST /api/atend-cobrar  { cobranca_id }  -> { url }   (o id vem de uma função protegida do banco; o valor vem do banco)
//  POST /api/atend-webhook?c=<id>           (aviso do Mercado Pago; conferimos o pagamento com o token do salão antes de marcar como pago)
const L = require('./_lib');
const PB = require('./_pagbank');

async function cobrar(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { erro: 'Método não permitido.' }); }
  if (L.faltandoBase().length) return L.json(res, 503, { erro: 'Pagamento online ainda não configurado.' });
  const b = await L.corpo(req);
  const id = String(b.cobranca_id || '');
  if (!L.UUID.test(id)) return L.json(res, 400, { erro: 'Cobrança inválida.' });
  let c;
  try { c = await L.rpcServico('atend_cob_contexto', { p_id: id }); }
  catch (_) { return L.json(res, 502, { erro: 'Não foi possível consultar a cobrança.' }); }
  if (!c) return L.json(res, 404, { erro: 'Cobrança não encontrada.' });
  if (c.status === 'pago') return L.json(res, 409, { erro: 'Este atendimento já foi pago.' });
  if (c.status !== 'aguardando') return L.json(res, 409, { erro: 'Esta cobrança foi cancelada. Gere uma nova.' });
  if (!c.token) return L.json(res, 409, { erro: 'Conecte o Mercado Pago ou o PagBank do salão primeiro (Mais, Agendamento online).' });
  if (c.link) return L.json(res, 200, { url: c.link, reaproveitado: true });
  const valor = Math.round(Number(c.valor) * 100) / 100;
  if (!(valor >= 1)) return L.json(res, 409, { erro: 'Valor inválido.' });
  const site = L.siteUrl(req);
  if (c.provedor === 'pagbank') {
    const notificar = site + '/api/atend-webhook?c=' + id + '&g=pb';
    if (notificar.length > 100) return L.json(res, 500, { erro: 'O endereço do site é longo demais para o PagBank.' });
    const r = await PB.criarCheckout(c.token, { ref: id, titulo: c.servico + ' - ' + c.salao, valor, notificar, expira: Date.now() + 3 * 24 * 3600 * 1000, descritor: c.salao });
    if (r.status === 401 || r.status === 403) return L.json(res, 409, { erro: 'Reconecte o PagBank do salão (o token venceu ou foi trocado).' });
    if (!r.ok || !r.url) return L.json(res, 502, { erro: 'O PagBank não respondeu. Tente de novo em instantes.' });
    try { await L.rpcServico('atend_cob_gravar_link', { p_id: id, p_link: r.url }); } catch (_) { /* o link continua válido */ }
    return L.json(res, 200, { url: r.url });
  }
  const pref = {
    items: [{ id, title: String(c.servico + ' - ' + c.salao).slice(0, 120), quantity: 1, currency_id: 'BRL', unit_price: valor }],
    external_reference: id,
    notification_url: site + '/api/atend-webhook?c=' + id,
    expires: true,
    expiration_date_to: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
    statement_descriptor: String(c.salao || 'SALAO').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 13) || 'SALAO'
  };
  const r = await L.mpCom(c.token, '/checkout/preferences', { method: 'POST', body: JSON.stringify(pref) });
  if (r.status === 401 || r.status === 403) return L.json(res, 409, { erro: 'Reconecte o Mercado Pago do salão (o acesso venceu).' });
  const url = r.dados && r.dados.init_point;
  if (!r.ok || !url) return L.json(res, 502, { erro: 'O Mercado Pago não respondeu. Tente de novo em instantes.' });
  try { await L.rpcServico('atend_cob_gravar_link', { p_id: id, p_link: url }); } catch (_) { /* o link continua válido */ }
  return L.json(res, 200, { url });
}

async function webhook(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return L.json(res, 405, { erro: 'Método não permitido.' });
  if (L.faltandoBase().length) return L.json(res, 503, { erro: 'Não configurado.' });
  const q = req.query || {}, b = await L.corpo(req);
  const cob = String(q.c || '');
  if (String(q.g || '') === 'pb') {
    if (!L.UUID.test(cob)) return L.json(res, 200, { ok: true, ignorado: true });
    try {
      const c = await L.rpcServico('atend_cob_contexto', { p_id: cob });
      if (!c || !c.token || c.provedor !== 'pagbank') return L.json(res, 200, { ok: true, ignorado: 'cobrança ou conta não encontradas' });
      if (c.status === 'pago') return L.json(res, 200, { ok: true, repetido: true });
      const v = await PB.conferir(c.token, cob, b);
      if (v.estado === 'erro') return L.json(res, 502, { erro: v.motivo });
      if (v.estado !== 'pago') return L.json(res, 200, { ok: true, ignorado: v.motivo });
      const g = await L.rpcServico('atend_cob_pagar', { p_id: cob, p_mp_id: v.pid, p_valor: v.valor, p_forma: v.forma, p_parcelas: v.parcelas });
      return L.json(res, 200, { ok: !!(g && g.ok) });
    } catch (e) {
      console.error('atend-webhook (pagbank):', e.message);
      return L.json(res, 500, { erro: 'Falha ao registrar o pagamento.' });
    }
  }
  const tipo = String(q.type || q.topic || b.type || b.topic || '');
  const id = String(q['data.id'] || (b.data && b.data.id) || (tipo === 'payment' && (q.id || b.id)) || '');
  if (!L.UUID.test(cob) || tipo !== 'payment' || !/^\d{1,20}$/.test(id)) return L.json(res, 200, { ok: true, ignorado: true });
  try {
    const c = await L.rpcServico('atend_cob_contexto', { p_id: cob });
    if (!c || !c.token) return L.json(res, 200, { ok: true, ignorado: 'cobrança ou conta não encontradas' });
    if (c.status === 'pago') return L.json(res, 200, { ok: true, repetido: true });
    const r = await L.mpCom(c.token, '/v1/payments/' + id, { method: 'GET' });
    if (r.status === 404) return L.json(res, 200, { ok: true, ignorado: 'pagamento não encontrado' });
    if (!r.ok) return L.json(res, 502, { erro: 'Mercado Pago indisponível.' });
    const p = r.dados || {};
    if (String(p.external_reference || '') !== cob) return L.json(res, 200, { ok: true, ignorado: 'pagamento de outra cobrança' });
    if (p.status !== 'approved') return L.json(res, 200, { ok: true, situacao: p.status || 'desconhecida' });
    if (String(p.currency_id || 'BRL') !== 'BRL') return L.json(res, 200, { ok: true, ignorado: 'moeda diferente' });
    const forma = p.payment_type_id === 'credit_card' ? 'Cartão de crédito' : p.payment_type_id === 'debit_card' ? 'Cartão de débito' : (p.payment_type_id === 'bank_transfer' || p.payment_method_id === 'pix') ? 'Pix' : 'Outro';
    const g = await L.rpcServico('atend_cob_pagar', { p_id: cob, p_mp_id: id, p_valor: Number(p.transaction_amount), p_forma: forma, p_parcelas: Number(p.installments) || 1 });
    return L.json(res, 200, { ok: !!(g && g.ok) });
  } catch (e) {
    console.error('atend-webhook:', e.message);
    return L.json(res, 500, { erro: 'Falha ao registrar o pagamento.' });
  }
}
module.exports = { cobrar, webhook };
