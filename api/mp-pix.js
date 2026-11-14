// POST /api/mp-pix  { pagamento_id, acao?: 'criar' | 'conferir' }  (Authorization: Bearer <login do usuário>)
// criar: gera um Pix do Mercado Pago para a cobrança e devolve o QR Code (sem sair do Agendio).
// conferir: pergunta ao Mercado Pago se o Pix da cobrança já foi pago e, se sim, libera.
const L = require('./_lib');
const P = require('./_pag');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { erro: 'Método não permitido.' }); }
  const f = L.faltando();
  if (f.length) return L.json(res, 503, { erro: 'Pagamento online ainda não configurado.', faltando: f });
  const auth = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+/.test(auth)) return L.json(res, 401, { erro: 'Entre no sistema para pagar.' });
  const b = await L.corpo(req);
  const id = String(b.pagamento_id || '');
  if (!L.UUID.test(id)) return L.json(res, 400, { erro: 'Cobrança inválida.' });

  let c;
  try { c = await L.lerCobranca(auth, id); } catch (_) { return L.json(res, 502, { erro: 'Não foi possível consultar a cobrança.' }); }
  if (c.erro === 401) return L.json(res, 401, { erro: 'Sessão expirada. Entre de novo.' });
  if (c.erro) return L.json(res, 502, { erro: 'Não foi possível consultar a cobrança.' });
  const g = c.g;
  if (!g) return L.json(res, 404, { erro: 'Cobrança não encontrada.' });

  if (b.acao === 'conferir') {
    if (g.status === 'pago') return L.json(res, 200, { pago: true });
    const r = await L.mp('/v1/payments/search?external_reference=' + id + '&sort=date_created&criteria=desc&limit=10', { method: 'GET' });
    if (!r.ok) return L.json(res, 502, { erro: 'O Mercado Pago não respondeu. Tente de novo.' });
    const ok = ((r.dados && r.dados.results) || []).find(p => p && p.status === 'approved' && String(p.external_reference) === id);
    if (!ok) return L.json(res, 200, { pago: false });
    try { await P.confirmar(ok); } catch (e) { console.error('mp-pix conferir:', e.message); return L.json(res, 500, { erro: 'Falha ao registrar o pagamento.' }); }
    return L.json(res, 200, { pago: true });
  }

  if (g.status !== 'pendente' && g.status !== 'atrasado') return L.json(res, 409, { erro: 'Esta cobrança não está em aberto.' });
  const valor = Math.round(Number(g.valor) * 100) / 100;
  if (!(valor > 0)) return L.json(res, 409, { erro: 'Cobrança sem valor.' });
  const email = await L.emailDe(auth);
  if (!email) return L.json(res, 401, { erro: 'Sessão expirada. Entre de novo.' });
  const site = L.siteUrl(req);
  const corpo = {
    transaction_amount: valor,
    description: g.tipo === 'mensagens' ? 'Agendio - ' + String(g.descricao || 'mensagens de WhatsApp').slice(0, 100) : 'Agendio - mensalidade',
    payment_method_id: 'pix',
    payer: { email },
    external_reference: id,
    statement_descriptor: 'AGENDIO'
  };
  if (site) corpo.notification_url = site + '/api/mp-webhook';
  // Mesma cobrança no mesmo dia = mesmo Pix (não gera vários QR se a pessoa abrir a tela de novo).
  const r = await L.mp('/v1/payments', { method: 'POST', body: JSON.stringify(corpo), headers: { 'X-Idempotency-Key': 'pix-' + id + '-' + L.dataSP() } });
  const d = r.dados || {}, t = d.point_of_interaction && d.point_of_interaction.transaction_data;
  if (!r.ok || !t || !t.qr_code) {
    console.error('mp-pix: MP respondeu', r.status, JSON.stringify(d).slice(0, 400));
    const m = L.motivoMp(r);
    return L.json(res, 502, { erro: 'O Mercado Pago não gerou o Pix' + (r.status ? ' (erro ' + r.status + (m ? ': ' + m : '') + ')' : '') + '. Se continuar, avise o suporte.' });
  }
  return L.json(res, 200, { qr: String(t.qr_code), qr_base64: String(t.qr_code_base64 || ''), expira: d.date_of_expiration || null, valor });
};
