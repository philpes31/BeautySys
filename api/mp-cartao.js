// POST /api/mp-cartao  { pagamento_id, token, payment_method_id, issuer_id?, cpf, parcelas? }  (Authorization: Bearer <login>)
// Paga uma cobrança no cartão. O cartão nunca passa por aqui: o navegador troca os dados por um "token" direto com o Mercado Pago.
const L = require('./_lib');
const P = require('./_pag');

const MOTIVO = {
  cc_rejected_insufficient_amount: 'Saldo ou limite insuficiente.',
  cc_rejected_bad_filled_card_number: 'Confira o número do cartão.',
  cc_rejected_bad_filled_date: 'Confira a validade do cartão.',
  cc_rejected_bad_filled_security_code: 'Confira o código de segurança (CVV).',
  cc_rejected_bad_filled_other: 'Confira os dados do cartão.',
  cc_rejected_call_for_authorize: 'O banco pediu autorização. Ligue para o banco e tente de novo.',
  cc_rejected_card_disabled: 'Cartão desativado. Ligue para o banco ou use outro cartão.',
  cc_rejected_high_risk: 'Pagamento recusado por segurança. Tente o Pix ou outro cartão.',
  cc_rejected_duplicated_payment: 'Você já fez um pagamento igual a este.',
  cc_rejected_max_attempts: 'Muitas tentativas. Use outro cartão ou tente mais tarde.'
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { erro: 'Método não permitido.' }); }
  const f = L.faltando();
  if (f.length) return L.json(res, 503, { erro: 'Pagamento online ainda não configurado.', faltando: f });
  const auth = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+/.test(auth)) return L.json(res, 401, { erro: 'Entre no sistema para pagar.' });
  const b = await L.corpo(req);
  const id = String(b.pagamento_id || '');
  const token = String(b.token || ''), metodo = String(b.payment_method_id || ''), emissor = String(b.issuer_id || ''), cpf = String(b.cpf || '').replace(/\D/g, '');
  if (!L.UUID.test(id)) return L.json(res, 400, { erro: 'Cobrança inválida.' });
  if (!/^[A-Za-z0-9]{16,80}$/.test(token) || !/^[a-z0-9_]{2,30}$/.test(metodo) || (emissor && !/^\d{1,10}$/.test(emissor))) return L.json(res, 400, { erro: 'Dados do cartão inválidos. Preencha de novo.' });
  if (cpf.length !== 11) return L.json(res, 400, { erro: 'Informe o CPF do titular do cartão.' });

  let c;
  try { c = await L.lerCobranca(auth, id); } catch (_) { return L.json(res, 502, { erro: 'Não foi possível consultar a cobrança.' }); }
  if (c.erro === 401) return L.json(res, 401, { erro: 'Sessão expirada. Entre de novo.' });
  if (c.erro) return L.json(res, 502, { erro: 'Não foi possível consultar a cobrança.' });
  const g = c.g;
  if (!g) return L.json(res, 404, { erro: 'Cobrança não encontrada.' });
  if (g.status !== 'pendente' && g.status !== 'atrasado') return L.json(res, 409, { erro: 'Esta cobrança não está em aberto.' });
  const valor = Math.round(Number(g.valor) * 100) / 100;
  if (!(valor > 0)) return L.json(res, 409, { erro: 'Cobrança sem valor.' });
  const email = await L.emailDe(auth);
  if (!email) return L.json(res, 401, { erro: 'Sessão expirada. Entre de novo.' });
  const site = L.siteUrl(req);
  const corpo = {
    transaction_amount: valor, token, installments: 1, payment_method_id: metodo,
    description: g.tipo === 'mensagens' ? 'Agendio - ' + String(g.descricao || 'mensagens de WhatsApp').slice(0, 100) : 'Agendio - mensalidade',
    payer: { email, identification: { type: 'CPF', number: cpf } },
    external_reference: id, statement_descriptor: 'AGENDIO'
  };
  if (emissor) corpo.issuer_id = Number(emissor);
  if (site) corpo.notification_url = site + '/api/mp-webhook';
  const r = await L.mp('/v1/payments', { method: 'POST', body: JSON.stringify(corpo), headers: { 'X-Idempotency-Key': 'cartao-' + id + '-' + token.slice(0, 40) } });
  const d = r.dados || {};
  if (!r.ok || !d.status) {
    console.error('mp-cartao: MP respondeu', r.status, JSON.stringify(d).slice(0, 400));
    const m = L.motivoMp(r);
    return L.json(res, 502, { erro: 'O Mercado Pago não processou o cartão' + (r.status ? ' (erro ' + r.status + (m ? ': ' + m : '') + ')' : '') + '. Confira os dados e tente de novo.' });
  }
  if (d.status === 'approved') {
    let x = null;
    try { x = await P.confirmar(d); } catch (e) { console.error('mp-cartao confirmar:', e.message); }   // o aviso automático também registra
    if (!x || (!x.corpo.registrado && !x.corpo.repetido)) return L.json(res, 200, { status: 'in_process' });
    return L.json(res, 200, { status: 'approved' });
  }
  if (d.status === 'in_process' || d.status === 'pending') return L.json(res, 200, { status: 'in_process' });
  return L.json(res, 200, { status: 'rejected', erro: MOTIVO[d.status_detail] || 'O cartão foi recusado. Confira os dados ou tente outro cartão.' });
};
