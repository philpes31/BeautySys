
// POST /api/mp-webhook  (o Mercado Pago avisa aqui quando um pagamento muda)
// Não confiamos no aviso: buscamos o pagamento no Mercado Pago com a nossa chave e conferimos
// cobrança, valor e moeda antes de marcar como pago.
const L = require('./_lib');

function pegaId(req, b) {
  const q = req.query || {};
  const tipo = String(q.type || q.topic || (b && (b.type || b.topic)) || '');
  const id = (q['data.id'] || (b && b.data && b.data.id) || (tipo === 'payment' && (q.id || (b && b.id))) || '');
  return { tipo, id: String(id || '') };
}

// Assinatura automática: o aviso só diz "algo mudou"; a situação e o valor vêm do Mercado Pago, e o valor é conferido no banco.
async function assinatura(res, tipo, id) {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) return L.json(res, 200, { ok: true, ignorado: true });
  try {
    if (tipo === 'subscription_preapproval') {
      const r = await L.mp('/preapproval/' + encodeURIComponent(id), { method: 'GET' });
      if (r.status === 404) return L.json(res, 200, { ok: true, ignorado: 'assinatura não encontrada' });
      if (!r.ok) return L.json(res, 502, { erro: 'Mercado Pago indisponível.' });
      const p = r.dados || {}, a = await L.rpcServico('mp_assinatura_dados', { p_preapproval: id });
      if (!a || String(p.external_reference || '') !== String(a.tenant_id)) return L.json(res, 200, { ok: true, ignorado: 'assinatura não é do Agendio' });
      const prox = p.next_payment_date ? L.dataSP(p.next_payment_date) : null;
      const x = await L.rpcServico('mp_assinatura_atualizar', { p_preapproval: id, p_status: String(p.status || ''), p_proximo: prox });
      return L.json(res, 200, { ok: !!(x && x.ok) });
    }
    const r = await L.mp('/authorized_payments/' + encodeURIComponent(id), { method: 'GET' });
    if (r.status === 404) return L.json(res, 200, { ok: true, ignorado: 'débito não encontrado' });
    if (!r.ok) return L.json(res, 502, { erro: 'Mercado Pago indisponível.' });
    const p = r.dados || {}, pre = String(p.preapproval_id || '');
    const aprovado = p.status === 'processed' && (!p.payment || !p.payment.status || p.payment.status === 'approved');
    if (!pre || !aprovado) return L.json(res, 200, { ok: true, situacao: p.status || 'desconhecida' });
    if (String(p.currency_id || 'BRL') !== 'BRL') return L.json(res, 200, { ok: true, ignorado: 'moeda diferente' });
    const x = await L.rpcServico('mp_registrar_debito', { p_preapproval: pre, p_ref: String(p.id || id), p_valor: Number(p.transaction_amount), p_pago_em: L.dataSP(p.debit_date || p.last_modified || p.date_created) });
    return L.json(res, 200, { ok: !!(x && x.ok), repetido: !!(x && x.repetido) });
  } catch (e) {
    console.error('mp-webhook assinatura:', e.message);
    return L.json(res, 500, { erro: 'Falha ao registrar a assinatura.' });
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') return L.json(res, 405, { erro: 'Método não permitido.' });
  const f = L.faltando();
  if (f.length) return L.json(res, 503, { erro: 'Não configurado.' });
  const b = await L.corpo(req);
  const { tipo, id } = pegaId(req, b);
  if (tipo === 'subscription_preapproval' || tipo === 'subscription_authorized_payment') return assinatura(res, tipo, id);
  if (tipo !== 'payment' || !/^\d{1,20}$/.test(id)) return L.json(res, 200, { ok: true, ignorado: true });

  let p;
  try {
    const r = await L.mp('/v1/payments/' + id, { method: 'GET' });
    if (r.status === 404) return L.json(res, 200, { ok: true, ignorado: 'pagamento não encontrado' });
    if (!r.ok) return L.json(res, 502, { erro: 'Mercado Pago indisponível.' });   // o MP tenta de novo
    p = r.dados || {};
  } catch (_) { return L.json(res, 502, { erro: 'Mercado Pago indisponível.' }); }

  const ref = String(p.external_reference || '');
  if (!L.UUID.test(ref)) return L.json(res, 200, { ok: true, ignorado: 'sem cobrança do Agendio' });
  if (p.status !== 'approved') return L.json(res, 200, { ok: true, situacao: p.status || 'desconhecida' });

  try {
    const c = await L.rpcServico('mp_dados_cobranca', { p_id: ref });
    if (!c) return L.json(res, 200, { ok: true, ignorado: 'cobrança não existe' });
    if (c.status === 'pago') return L.json(res, 200, { ok: true, repetido: true });
    const pago = Number(p.transaction_amount);
    if (String(p.currency_id || 'BRL') !== 'BRL' || !(pago + 0.005 >= Number(c.valor))) {
      console.warn('mp-webhook: valor ou moeda diferente do esperado', { ref, pago, esperado: c.valor, moeda: p.currency_id });
      return L.json(res, 200, { ok: true, ignorado: 'valor diferente do esperado' });
    }
    const r = await L.rpcServico('registrar_pagamento_externo', {
      p_provedor: 'mercadopago', p_ref: ref, p_status: 'pago', p_pago_em: L.dataSP(p.date_approved)
    });
    return L.json(res, 200, { ok: !!(r && r.ok) });
  } catch (e) {
    console.error('mp-webhook:', e.message);
    return L.json(res, 500, { erro: 'Falha ao registrar o pagamento.' });          // o MP tenta de novo
  }
};
