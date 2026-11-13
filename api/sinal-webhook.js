// POST /api/sinal-webhook?p=<pedido>  (o Mercado Pago do salão avisa aqui quando o sinal muda)
// Não confiamos no aviso: buscamos o pagamento no Mercado Pago com o token do salão e conferimos
// pedido, valor e moeda antes de marcar o sinal como pago.
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') return L.json(res, 405, { erro: 'Método não permitido.' });
  if (L.faltandoBase().length) return L.json(res, 503, { erro: 'Não configurado.' });
  const q = req.query || {}, b = await L.corpo(req);
  const ped = String(q.p || '');
  const tipo = String(q.type || q.topic || b.type || b.topic || '');
  const id = String(q['data.id'] || (b.data && b.data.id) || (tipo === 'payment' && (q.id || b.id)) || '');
  if (!L.UUID.test(ped) || tipo !== 'payment' || !/^\d{1,20}$/.test(id)) return L.json(res, 200, { ok: true, ignorado: true });
  try {
    const c = await L.rpcServico('sinal_contexto', { p_id: ped });
    if (!c || !c.token) return L.json(res, 200, { ok: true, ignorado: 'pedido ou conta não encontrados' });
    if (c.sinal_status === 'pago') return L.json(res, 200, { ok: true, repetido: true });
    const r = await L.mpCom(c.token, '/v1/payments/' + id, { method: 'GET' });
    if (r.status === 404) return L.json(res, 200, { ok: true, ignorado: 'pagamento não encontrado' });
    if (!r.ok) return L.json(res, 502, { erro: 'Mercado Pago indisponível.' });
    const p = r.dados || {};
    if (String(p.external_reference || '') !== ped) return L.json(res, 200, { ok: true, ignorado: 'pagamento de outro pedido' });
    if (p.status !== 'approved') return L.json(res, 200, { ok: true, situacao: p.status || 'desconhecida' });
    if (String(p.currency_id || 'BRL') !== 'BRL') return L.json(res, 200, { ok: true, ignorado: 'moeda diferente' });
    const g = await L.rpcServico('sinal_gravar_pagamento', { p_id: ped, p_mp_id: id, p_valor: Number(p.transaction_amount) });
    return L.json(res, 200, { ok: !!(g && g.ok), devolver: !!(g && g.devolver) });
  } catch (e) {
    console.error('sinal-webhook:', e.message);
    return L.json(res, 500, { erro: 'Falha ao registrar o sinal.' });
  }
};
