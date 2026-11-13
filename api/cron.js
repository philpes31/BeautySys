// GET /api/cron  (a Vercel chama uma vez por dia; veja vercel.json)
// Gera as cobranças que vencem em até 7 dias, marca vencidos/atrasados, vence sinais não pagos,
// limpa a lista de espera antiga, coloca os lembretes de amanhã na fila e envia a fila de WhatsApp (se as chaves existirem).
const L = require('./_lib');
const W = require('./_wa');

module.exports = async (req, res) => {
  const seg = L.env('CRON_SECRET');
  if (!seg) return L.json(res, 503, { erro: 'CRON_SECRET não configurado.' });
  if (String(req.headers.authorization || '') !== 'Bearer ' + seg) return L.json(res, 401, { erro: 'Não autorizado.' });
  if (!L.env('SUPABASE_URL') || !L.env('SUPABASE_SERVICE_KEY')) return L.json(res, 503, { erro: 'Supabase não configurado.' });
  try {
    const situacoes = await L.rpcServico('cron_atualizar_situacoes', {});
    const geradas = await L.rpcServico('cron_gerar_cobrancas', {});
    let sinais = null, lembretes = null, whatsapp = null, espera = null;
    try { sinais = await L.rpcServico('sinal_expirar', {}); } catch (e) { console.error('cron sinal:', e.message); }
    try { lembretes = await L.rpcServico('cron_enfileirar_whatsapp', {}); } catch (e) { console.error('cron lembretes:', e.message); }
    try { espera = await L.rpcServico('cron_limpar_espera', {}); } catch (e) { console.error('cron espera:', e.message); }
    try { whatsapp = await W.enviarFila(); } catch (e) { console.error('cron whatsapp:', e.message); }
    return L.json(res, 200, { ok: true, situacoes, cobrancas_geradas: geradas, sinais_expirados: sinais, lembretes_na_fila: lembretes, espera_removida: espera, whatsapp });
  } catch (e) {
    console.error('cron:', e.message);
    return L.json(res, 500, { erro: 'Falha na rotina diária.' });
  }
};
