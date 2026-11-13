// POST /api/sinal-criar  { pedido_id }   (público: quem chama é a cliente, sem login)
// Cria o checkout do Mercado Pago do SALÃO para pagar o sinal de um pedido. O valor vem do banco.
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { erro: 'Método não permitido.' }); }
  if (L.faltandoBase().length) return L.json(res, 503, { erro: 'Pagamento online ainda não configurado.' });
  const b = await L.corpo(req);
  const id = String(b.pedido_id || '');
  if (!L.UUID.test(id)) return L.json(res, 400, { erro: 'Pedido inválido.' });
  let c;
  try { c = await L.rpcServico('sinal_contexto', { p_id: id }); }
  catch (_) { return L.json(res, 502, { erro: 'Não foi possível consultar o pedido.' }); }
  if (!c) return L.json(res, 404, { erro: 'Pedido não encontrado.' });
  if (c.sinal_status === 'pago') return L.json(res, 409, { erro: 'O sinal deste pedido já foi pago.' });
  if (c.status !== 'pendente' || c.sinal_status !== 'aguardando') return L.json(res, 409, { erro: 'O tempo para pagar o sinal acabou. Faça um novo pedido.' });
  const fim = new Date(c.criado_em).getTime() + Number(c.expira_min) * 60000;
  if (!(fim > Date.now() + 60000)) return L.json(res, 409, { erro: 'O tempo para pagar o sinal acabou. Faça um novo pedido.' });
  if (!c.token) return L.json(res, 409, { erro: 'Este salão não está recebendo sinal online agora. Fale com ele pelo WhatsApp.' });
  if (c.sinal_link) return L.json(res, 200, { url: c.sinal_link, reaproveitado: true });
  const valor = Math.round(Number(c.sinal_valor) * 100) / 100;
  if (!(valor >= 1)) return L.json(res, 409, { erro: 'Pedido sem sinal.' });
  const site = L.siteUrl(req);
  const volta = site + '/a/' + encodeURIComponent(c.slug || '') + '?p=' + id;
  const pref = {
    items: [{ id, title: String('Sinal - ' + c.salao + ' (' + c.servico + ')').slice(0, 120), quantity: 1, currency_id: 'BRL', unit_price: valor }],
    external_reference: id,
    notification_url: site + '/api/sinal-webhook?p=' + id,
    back_urls: { success: volta + '&sinal=ok', pending: volta + '&sinal=pendente', failure: volta + '&sinal=falha' },
    auto_return: 'approved',
    expires: true,
    expiration_date_to: new Date(fim).toISOString(),
    statement_descriptor: String(c.salao || 'SINAL').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 13) || 'SINAL'
  };
  const r = await L.mpCom(c.token, '/checkout/preferences', { method: 'POST', body: JSON.stringify(pref) });
  if (r.status === 401 || r.status === 403) return L.json(res, 409, { erro: 'O salão precisa reconectar o Mercado Pago. Fale com ele pelo WhatsApp.' });
  const url = r.dados && r.dados.init_point;
  if (!r.ok || !url) return L.json(res, 502, { erro: 'O Mercado Pago não respondeu. Tente de novo em instantes.' });
  try { await L.rpcServico('sinal_gravar_link', { p_id: id, p_link: url }); } catch (_) { /* o link continua válido */ }
  return L.json(res, 200, { url });
};
