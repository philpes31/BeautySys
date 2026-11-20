// Débito automático (cartão) da mensalidade do clube, pela conta Mercado Pago do SALÃO.
//  POST /api/clube-debitar          { debito_id }  -> { url }  (cliente autoriza no Mercado Pago)
//  POST /api/clube-debito-cancelar  { debito_id }  -> { ok }
//  POST /api/clube-debito-webhook?d=<id>           (aviso do Mercado Pago; tudo é conferido com o token do salão)
// Rede de segurança: a rotina diária (sincronizar) confere cada débito no Mercado Pago, caso um aviso se perca.
const L = require('./_lib');

async function contexto(id) {
  try { return { c: await L.rpcServico('clube_deb_contexto', { p_id: id }) }; }
  catch (_) { return { erro: true }; }
}

async function debitar(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { erro: 'Método não permitido.' }); }
  if (L.faltandoBase().length) return L.json(res, 503, { erro: 'Pagamento online ainda não configurado.' });
  const b = await L.corpo(req), id = String(b.debito_id || '');
  if (!L.UUID.test(id)) return L.json(res, 400, { erro: 'Débito inválido.' });
  const { c, erro } = await contexto(id);
  if (erro) return L.json(res, 502, { erro: 'Não foi possível consultar o débito.' });
  if (!c) return L.json(res, 404, { erro: 'Débito não encontrado.' });
  if (c.status === 'ativo') return L.json(res, 409, { erro: 'Este débito automático já está ativo.' });
  if (c.status !== 'pendente') return L.json(res, 409, { erro: 'Este débito foi cancelado. Gere um novo.' });
  if (!c.token) return L.json(res, 409, { erro: 'Conecte o Mercado Pago do salão primeiro (Mais, Agendamento online).' });
  if (c.provedor === 'pagbank') return L.json(res, 409, { erro: 'O débito automático funciona só com o Mercado Pago. O salão está conectado ao PagBank.' });
  if (c.link && c.preapproval) return L.json(res, 200, { url: c.link, reaproveitado: true });
  const valor = Math.round(Number(c.valor) * 100) / 100;
  if (!(valor >= 1)) return L.json(res, 409, { erro: 'Valor inválido.' });
  if (!c.email) return L.json(res, 409, { erro: 'Cadastre o e-mail da cliente primeiro.' });
  const site = L.siteUrl(req);
  const corpo = {
    reason: String('Mensalidade ' + c.nome + ' - ' + c.salao).slice(0, 120),
    external_reference: id,
    payer_email: String(c.email),
    back_url: (site || 'https://www.agendio.tec.br') + '/' + (c.slug ? 'c/' + encodeURIComponent(c.slug) : ''),
    status: 'pending',
    auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: valor, currency_id: 'BRL' }
  };
  if (site) corpo.notification_url = site + '/api/clube-debito-webhook?d=' + id;
  const r = await L.mpCom(c.token, '/preapproval', { method: 'POST', body: JSON.stringify(corpo) });
  if (r.status === 401 || r.status === 403) return L.json(res, 409, { erro: 'Reconecte o Mercado Pago do salão (o acesso venceu).' });
  const url = r.dados && r.dados.init_point, pre = r.dados && r.dados.id;
  if (!r.ok || !url || !pre) {
    const dd = r.dados || {}, causa = Array.isArray(dd.cause) && dd.cause[0] ? (dd.cause[0].description || dd.cause[0].code) : '';
    console.error('clube-debitar: MP respondeu', r.status, JSON.stringify(dd).slice(0, 400));
    return L.json(res, 502, { erro: 'O Mercado Pago não criou o débito automático' + (r.status ? ' (erro ' + r.status + (causa || dd.message ? ': ' + String(causa || dd.message).slice(0, 140) : '') + ')' : '') + '.' });
  }
  try { await L.rpcServico('clube_deb_gravar', { p_id: id, p_pre: String(pre), p_link: String(url) }); }
  catch (_) { return L.json(res, 502, { erro: 'Não foi possível guardar o débito. Tente de novo.' }); }
  return L.json(res, 200, { url });
}

async function cancelar(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { erro: 'Método não permitido.' }); }
  if (L.faltandoBase().length) return L.json(res, 503, { erro: 'Pagamento online ainda não configurado.' });
  const b = await L.corpo(req), id = String(b.debito_id || '');
  if (!L.UUID.test(id)) return L.json(res, 400, { erro: 'Débito inválido.' });
  const { c, erro } = await contexto(id);
  if (erro) return L.json(res, 502, { erro: 'Não foi possível consultar o débito.' });
  if (!c) return L.json(res, 404, { erro: 'Débito não encontrado.' });
  if (c.status === 'cancelado') return L.json(res, 200, { ok: true, repetido: true });
  if (c.preapproval && c.token) {
    const r = await L.mpCom(c.token, '/preapproval/' + encodeURIComponent(c.preapproval), { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
    if (!r.ok && r.status !== 404) return L.json(res, 502, { erro: 'O Mercado Pago não cancelou agora. Tente de novo em instantes.' });
  }
  try { await L.rpcServico('clube_deb_atualizar', { p_id: id, p_status: 'cancelled' }); }
  catch (_) { return L.json(res, 502, { erro: 'Não foi possível registrar o cancelamento.' }); }
  return L.json(res, 200, { ok: true });
}

// Confere um débito no Mercado Pago (situação + débitos aprovados). Usado pelo aviso e pela rotina diária.
async function conferir(id, c, avisoPagamento) {
  if (!c || !c.token || !c.preapproval || c.provedor === 'pagbank') return { ignorado: 'sem conta ou assinatura' };
  const r = await L.mpCom(c.token, '/preapproval/' + encodeURIComponent(c.preapproval), { method: 'GET' });
  if (r.status === 404) return { ignorado: 'assinatura não encontrada' };
  if (!r.ok) throw new Error('Mercado Pago indisponível (' + r.status + ')');
  const p = r.dados || {};
  if (String(p.id || '') !== String(c.preapproval)) return { ignorado: 'assinatura diferente' };
  await L.rpcServico('clube_deb_atualizar', { p_id: id, p_status: String(p.status || ''), p_proximo: p.next_payment_date ? L.dataSP(p.next_payment_date) : null });
  let pagos = 0;
  const lista = [];
  if (avisoPagamento) {
    const a = await L.mpCom(c.token, '/authorized_payments/' + encodeURIComponent(avisoPagamento), { method: 'GET' });
    if (a.ok && a.dados && String(a.dados.preapproval_id || '') === String(c.preapproval)) lista.push(a.dados);
  } else {
    const a = await L.mpCom(c.token, '/authorized_payments/search?preapproval_id=' + encodeURIComponent(c.preapproval), { method: 'GET' });
    if (a.ok && a.dados && Array.isArray(a.dados.results)) a.dados.results.slice(0, 40).forEach(x => lista.push(x));
  }
  for (const x of lista) {
    const ok = x.status === 'processed' && (!x.payment || !x.payment.status || x.payment.status === 'approved');
    if (!ok || String(x.currency_id || 'BRL') !== 'BRL') continue;
    const y = await L.rpcServico('clube_deb_pagar', { p_id: id, p_ref: String(x.id), p_valor: Number(x.transaction_amount) });
    if (y && y.ok && !y.repetido) pagos++;
  }
  return { situacao: p.status, registrados: pagos };
}

async function webhook(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return L.json(res, 405, { erro: 'Método não permitido.' });
  if (L.faltandoBase().length) return L.json(res, 503, { erro: 'Não configurado.' });
  const q = req.query || {}, b = await L.corpo(req), id = String(q.d || '');
  if (!L.UUID.test(id)) return L.json(res, 200, { ok: true, ignorado: true });
  const tipo = String(q.type || q.topic || (b && (b.type || b.topic)) || '');
  const ref = String(q['data.id'] || (b && b.data && b.data.id) || q.id || '');
  const { c, erro } = await contexto(id);
  if (erro) return L.json(res, 502, { erro: 'Falha ao consultar.' });
  if (!c) return L.json(res, 200, { ok: true, ignorado: 'débito não encontrado' });
  try {
    const x = await conferir(id, c, tipo === 'subscription_authorized_payment' && /^[A-Za-z0-9_-]{1,80}$/.test(ref) ? ref : '');
    return L.json(res, 200, Object.assign({ ok: true }, x));
  } catch (e) {
    console.error('clube-debito-webhook:', e.message);
    return L.json(res, 502, { erro: 'Mercado Pago indisponível.' });
  }
}

async function sincronizar() {
  const ids = await L.rpcServico('clube_deb_pendentes', {});
  let ok = 0, registrados = 0, falhas = 0;
  for (const id of Array.isArray(ids) ? ids : []) {
    try {
      const { c } = await contexto(id);
      const x = await conferir(id, c, '');
      ok++; registrados += (x && x.registrados) || 0;
    } catch (e) { falhas++; console.error('clube débito sync:', e.message); }
  }
  return { conferidos: ok, registrados, falhas };
}

module.exports = { debitar, cancelar, webhook, sincronizar, conferir };
