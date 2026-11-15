// Confere um pagamento do Mercado Pago (já buscado com a NOSSA chave) e, se for da cobrança e estiver certo, marca como pago.
// Usado pelo aviso automático (mp-webhook) e pela conferência da tela de Pix/cartão.
const L = require('./_lib');
const A = require('./_avisos');

async function confirmar(p) {
  const ref = String(p.external_reference || '');
  if (!L.UUID.test(ref)) return { codigo: 200, corpo: { ok: true, ignorado: 'sem cobrança do Agendio' } };
  if (p.status !== 'approved') return { codigo: 200, corpo: { ok: true, situacao: p.status || 'desconhecida' } };
  const c = await L.rpcServico('mp_dados_cobranca', { p_id: ref });
  if (!c) return { codigo: 200, corpo: { ok: true, ignorado: 'cobrança não existe' } };
  if (c.status === 'pago') return { codigo: 200, corpo: { ok: true, repetido: true } };
  const pago = Number(p.transaction_amount);
  if (String(p.currency_id || 'BRL') !== 'BRL' || !(pago + 0.005 >= Number(c.valor))) {
    console.warn('pagamento: valor ou moeda diferente do esperado', { ref, pago, esperado: c.valor, moeda: p.currency_id });
    return { codigo: 200, corpo: { ok: true, ignorado: 'valor diferente do esperado' } };
  }
  await L.marcarMp(ref);
  const r = await L.rpcServico('registrar_pagamento_externo', { p_provedor: 'mercadopago', p_ref: ref, p_status: 'pago', p_pago_em: L.dataSP(p.date_approved) });
  if (!(r && r.ok)) {
    console.error('pagamento: não foi possível registrar', ref, JSON.stringify(r));
    try { await A.avisarAdmin('Pagamento recebido e não registrado', ['O Mercado Pago aprovou um pagamento, mas o Agendio não conseguiu marcar a cobrança como paga.', 'Cobrança: ' + ref, 'Confira em Plataforma > Pagamentos e marque como pago se necessário.']); } catch (_) {}
  } else {
    try { await A.processar({ tipos: ['recibo'], limite: 5 }); } catch (e) { console.error('recibo por e-mail:', e.message); }
  }
  return { codigo: 200, corpo: { ok: !!(r && r.ok), registrado: !!(r && r.ok) } };
}
module.exports = { confirmar };
