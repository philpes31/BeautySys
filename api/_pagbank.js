// PagBank (PagSeguro) do SALÃO: cria o link de pagamento (Checkout) e confere o pagamento.
// O token é o do próprio salão (o dinheiro cai direto na conta dele). Nunca usamos o token da plataforma aqui.
// Não confiamos no aviso (webhook): sempre buscamos o pedido no PagBank com o token do salão e conferimos pedido, valor e moeda.
const L = require('./_lib');

const BASE = () => (L.env('PAGBANK_API') || 'https://api.pagseguro.com').replace(/\/+$/, '');
const TOKEN_OK = /^[A-Za-z0-9._-]{20,200}$/;

async function pb(token, caminho, opc) {
  const r = await fetch(BASE() + caminho, Object.assign({}, opc, {
    headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' }, opc && opc.headers)
  }));
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { j = null; }
  return { ok: r.ok, status: r.status, dados: j };
}

// Confere se o token é aceito pelo PagBank sem criar nada: consulta um checkout que não existe.
// 401 = token inválido; 404 = token aceito (o checkout é que não existe).
async function validarToken(token) {
  const r = await pb(token, '/checkouts/CHEC_00000000-0000-0000-0000-000000000000', { method: 'GET' });
  if (r.status === 401) return 'invalido';
  if (r.status === 403) return 'sem-permissao';
  if (r.status >= 500 || r.status === 0) return 'erro';
  return 'ok';
}

// Cria o link de pagamento. valor em reais. Devolve { url } ou { status } em caso de erro.
async function criarCheckout(token, o) {
  const corpo = {
    reference_id: String(o.ref),
    items: [{ name: String(o.titulo).slice(0, 100), quantity: 1, unit_amount: Math.round(Number(o.valor) * 100) }],
    soft_descriptor: String(o.descritor || 'AGENDIO').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 17) || 'AGENDIO',
    payment_notification_urls: [o.notificar],
    expiration_date: new Date(o.expira).toISOString()
  };
  if (o.volta) corpo.redirect_url = o.volta;
  const r = await pb(token, '/checkouts', { method: 'POST', body: JSON.stringify(corpo) });
  const links = (r.dados && Array.isArray(r.dados.links)) ? r.dados.links : [];
  const pay = links.find(l => l && String(l.rel).toUpperCase() === 'PAY');
  const url = pay && /^https:\/\//.test(String(pay.href || '')) ? String(pay.href) : '';
  return { ok: r.ok, status: r.status, url };
}

const ehPedido = id => /^ORDE_[A-Za-z0-9-]{10,60}$/.test(String(id || ''));
const FORMAS = { PIX: 'Pix', CREDIT_CARD: 'Cartão de crédito', DEBIT_CARD: 'Cartão de débito' };

// Lê o pedido no PagBank e diz se a cobrança "ref" foi paga. Não acredita no corpo do aviso.
//  -> { estado: 'ignorar'|'erro'|'aguardando'|'pago', motivo, valor, forma, parcelas, pid }
async function conferir(token, ref, corpoAviso) {
  const id = String((corpoAviso && corpoAviso.id) || '');
  if (!ehPedido(id)) return { estado: 'ignorar', motivo: 'aviso sem pedido' };
  const r = await pb(token, '/orders/' + encodeURIComponent(id), { method: 'GET' });
  if (r.status === 404) return { estado: 'ignorar', motivo: 'pedido não encontrado' };
  if (!r.ok) return { estado: 'erro', motivo: 'PagBank indisponível' };
  return analisar(r.dados || {}, ref);
}
function analisar(order, ref) {
  if (String(order.reference_id || '') !== String(ref)) return { estado: 'ignorar', motivo: 'pedido de outra cobrança' };
  const cs = Array.isArray(order.charges) ? order.charges : [];
  const c = cs.find(x => x && String(x.status).toUpperCase() === 'PAID');
  if (!c) return { estado: 'aguardando', motivo: 'sem pagamento aprovado' };
  const a = c.amount || {};
  if (String(a.currency || 'BRL').toUpperCase() !== 'BRL') return { estado: 'ignorar', motivo: 'moeda diferente' };
  const cents = Number(a.value);
  if (!Number.isInteger(cents) || cents <= 0) return { estado: 'ignorar', motivo: 'valor inválido' };
  const m = c.payment_method || {};
  const tipo = String(m.type || '').toUpperCase();
  const parc = Math.min(12, Math.max(1, parseInt(m.installments, 10) || 1));
  const hex = String(c.id || '').replace(/^CHAR_/, '').replace(/[^A-Fa-f0-9]/g, '').toLowerCase();
  return { estado: 'pago', valor: cents / 100, forma: FORMAS[tipo] || 'Outro', parcelas: tipo === 'CREDIT_CARD' ? parc : 1, pid: 'pb' + (hex || String(order.id || '').replace(/[^A-Za-z0-9]/g, '')).slice(0, 28) };
}

module.exports = { BASE, TOKEN_OK, pb, validarToken, criarCheckout, conferir, analisar, ehPedido };
