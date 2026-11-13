// POST /api/mp-criar  { pagamento_id }  (cabeçalho Authorization: Bearer <login do usuário>)
// Cria (ou reaproveita) o checkout do Mercado Pago de uma cobrança do salão e devolve { url }.
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { erro: 'Método não permitido.' }); }
  const f = L.faltando();
  if (f.length) return L.json(res, 503, { erro: 'Pagamento online ainda não configurado.', faltando: f });
  const auth = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+/.test(auth)) return L.json(res, 401, { erro: 'Entre no sistema para pagar.' });
  const b = await L.corpo(req);
  const id = String(b.pagamento_id || '');
  if (!L.UUID.test(id)) return L.json(res, 400, { erro: 'Cobrança inválida.' });
  const base = L.env('SUPABASE_URL').replace(/\/+$/, '');

  // 1) Quem é e o que pode ver: a leitura passa pela segurança do banco (RLS) com o login da própria pessoa.
  let g;
  try {
    const r = await fetch(base + '/rest/v1/pagamentos?select=id,valor,status,vencimento,link_pagamento,provedor,tipo,descricao&id=eq.' + id, {
      headers: { apikey: L.env('SUPABASE_ANON_KEY'), Authorization: auth }
    });
    if (r.status === 401 || r.status === 403) return L.json(res, 401, { erro: 'Sessão expirada. Entre de novo.' });
    if (!r.ok) return L.json(res, 502, { erro: 'Não foi possível consultar a cobrança.' });
    const l = await r.json();
    g = Array.isArray(l) ? l[0] : null;
  } catch (_) { return L.json(res, 502, { erro: 'Não foi possível consultar a cobrança.' }); }
  if (!g) return L.json(res, 404, { erro: 'Cobrança não encontrada.' });
  if (g.status !== 'pendente' && g.status !== 'atrasado') return L.json(res, 409, { erro: 'Esta cobrança não está em aberto.' });
  if (g.provedor === 'mercadopago' && g.link_pagamento) return L.json(res, 200, { url: g.link_pagamento, reaproveitado: true });
  const valor = Number(g.valor);
  if (!(valor > 0)) return L.json(res, 409, { erro: 'Cobrança sem valor.' });

  // 2) Checkout Pro: o valor vem do banco, nunca do navegador.
  const site = L.siteUrl(req);
  const venc = String(g.vencimento || '').split('-').reverse().join('/');
  const pref = {
    items: [{ id, title: g.tipo === 'mensagens' ? 'Agendio - ' + String(g.descricao || 'mensagens de WhatsApp').slice(0, 100) : 'Agendio - mensalidade' + (venc ? ' (vence ' + venc + ')' : ''), quantity: 1, currency_id: 'BRL', unit_price: Math.round(valor * 100) / 100 }],
    external_reference: id,
    notification_url: site + '/api/mp-webhook',
    back_urls: { success: site + '/?pg=ok', pending: site + '/?pg=pendente', failure: site + '/?pg=falha' },
    auto_return: 'approved',
    statement_descriptor: 'AGENDIO'
  };
  const r = await L.mp('/checkout/preferences', { method: 'POST', body: JSON.stringify(pref) });
  const url = r.dados && r.dados.init_point;
  if (!r.ok || !url) {
    // Mostra o motivo que o Mercado Pago deu (nunca contém chaves) para dar para corrigir sem adivinhar.
    const d = r.dados || {}, causa = Array.isArray(d.cause) && d.cause[0] ? (d.cause[0].description || d.cause[0].code) : '';
    const motivo = String(causa || d.message || d.error || '').slice(0, 160);
    console.error('mp-criar: MP respondeu', r.status, JSON.stringify(d).slice(0, 400));
    return L.json(res, 502, { erro: 'O Mercado Pago recusou criar o pagamento' + (r.status ? ' (erro ' + r.status + (motivo ? ': ' + motivo : '') + ')' : '') + '. Se continuar, avise o suporte.' });
  }
  try { await L.rpcServico('mp_gravar_link', { p_id: id, p_link: url }); }
  catch (e) {
    console.error('mp-criar: mp_gravar_link falhou', e.status, e.message);
    return L.json(res, 502, { erro: 'Não foi possível guardar o link do pagamento (erro ' + (e.status || '?') + ': ' + String(e.message || '').slice(0, 140) + '). Avise o suporte.' });
  }
  return L.json(res, 200, { url });
};
