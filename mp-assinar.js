// POST /api/mp-assinar  { acao: 'criar' | 'cancelar' }  (Authorization: Bearer <login do proprietário>)
// Cria a assinatura automática (débito mensal no cartão) no Mercado Pago da plataforma e devolve { url } para autorizar.
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { erro: 'Método não permitido.' }); }
  const f = L.faltando();
  if (f.length) return L.json(res, 503, { erro: 'Pagamento online ainda não configurado.', faltando: f });
  const auth = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+/.test(auth)) return L.json(res, 401, { erro: 'Entre no sistema para continuar.' });
  const b = await L.corpo(req);
  const acao = b.acao === 'cancelar' ? 'cancelar' : 'criar';
  const base = L.env('SUPABASE_URL').replace(/\/+$/, '');

  // Quem é e qual o plano: a função do banco confere se é o proprietário e traz o valor do plano.
  let d;
  try {
    const r = await fetch(base + '/rest/v1/rpc/minha_assinatura_dados', {
      method: 'POST', headers: { apikey: L.env('SUPABASE_ANON_KEY'), Authorization: auth, 'Content-Type': 'application/json' }, body: '{}'
    });
    const j = await r.json().catch(() => null);
    if (r.status === 401) return L.json(res, 401, { erro: 'Sessão expirada. Entre de novo.' });
    if (!r.ok) return L.json(res, r.status === 404 ? 404 : 403, { erro: (j && j.message) || 'Não foi possível confirmar o seu plano.' });
    d = j;
  } catch (_) { return L.json(res, 502, { erro: 'Não foi possível consultar o seu plano.' }); }

  const ass = d.assinatura || null;
  if (acao === 'cancelar') {
    if (!ass || !ass.preapproval_id || ass.status === 'cancelada') return L.json(res, 409, { erro: 'Não há assinatura automática para cancelar.' });
    const r = await L.mp('/preapproval/' + encodeURIComponent(ass.preapproval_id), { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
    if (!r.ok) return L.json(res, 502, { erro: 'O Mercado Pago não respondeu. Tente de novo em instantes.' });
    try { await L.rpcServico('mp_assinatura_atualizar', { p_preapproval: ass.preapproval_id, p_status: 'cancelled' }); } catch (_) {}
    return L.json(res, 200, { ok: true });
  }

  if (ass && ass.status === 'autorizada') return L.json(res, 409, { erro: 'Sua assinatura automática já está ativa.' });
  const valor = Math.round(Number(d.valor) * 100) / 100;
  if (!(valor > 0)) return L.json(res, 409, { erro: 'Seu plano ainda não tem valor mensal.' });
  const site = L.siteUrl(req);
  const corpo = {
    reason: 'Agendio - plano ' + (d.plano_nome || ''),
    external_reference: d.tenant_id,
    payer_email: d.email,
    back_url: site + '/?pg=assinatura',
    status: 'pending',
    auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: valor, currency_id: 'BRL' }
  };
  // Se o salão ainda tem dias pagos, o primeiro débito só acontece no vencimento (sem cobrar duas vezes).
  if (d.vencimento && /^\d{4}-\d{2}-\d{2}$/.test(d.vencimento)) {
    const dt = new Date(d.vencimento + 'T12:00:00-03:00');
    if (dt.getTime() > Date.now() + 36e5 * 24) corpo.auto_recurring.start_date = dt.toISOString();
  }
  const r = await L.mp('/preapproval', { method: 'POST', body: JSON.stringify(corpo) });
  const url = r.dados && r.dados.init_point, id = r.dados && r.dados.id;
  if (!r.ok || !url || !id) return L.json(res, 502, { erro: 'O Mercado Pago não respondeu. Tente de novo em instantes.' });
  try { await L.rpcServico('mp_assinatura_gravar', { p_tenant: d.tenant_id, p_preapproval: String(id), p_plano: d.plano_id, p_valor: valor }); }
  catch (_) { return L.json(res, 502, { erro: 'Não foi possível guardar a assinatura.' }); }
  return L.json(res, 200, { url });
};
