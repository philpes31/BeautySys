// GET /api/cron  (a Vercel chama uma vez por dia; veja vercel.json)
// Gera as cobranças que vencem em até 7 dias, marca vencidos/atrasados, bloqueia quem passou do prazo (se ligado), vence sinais não pagos,
// cobra as mensagens de WhatsApp enviadas no mês anterior, limpa a lista de espera antiga, coloca os lembretes de amanhã na fila e envia a fila de WhatsApp (se as chaves existirem).
const L = require('./_lib');
const W = require('./_wa');
const A = require('./_avisos');

module.exports = async (req, res) => {
  const seg = L.env('CRON_SECRET');
  if (!seg) return L.json(res, 503, { erro: 'CRON_SECRET não configurado.' });
  if (String(req.headers.authorization || '') !== 'Bearer ' + seg) return L.json(res, 401, { erro: 'Não autorizado.' });
  if (!L.env('SUPABASE_URL') || !L.env('SUPABASE_SERVICE_KEY')) return L.json(res, 503, { erro: 'Supabase não configurado.' });
  try {
    const situacoes = await L.rpcServico('cron_atualizar_situacoes', {});
    const geradas = await L.rpcServico('cron_gerar_cobrancas', {});
    let bloqueados = null;
    try { bloqueados = await L.rpcServico('cron_bloquear_vencidos', {}); } catch (e) { console.error('cron bloquear:', e.message); }
    let msgsCobradas = null;
    try { msgsCobradas = await L.rpcServico('cron_cobrar_mensagens', {}); } catch (e) { console.error('cron cobrar mensagens:', e.message); }
    let sinais = null, lembretes = null, whatsapp = null, espera = null;
    try { sinais = await L.rpcServico('sinal_expirar', {}); } catch (e) { console.error('cron sinal:', e.message); }
    try { lembretes = await L.rpcServico('cron_enfileirar_whatsapp', {}); } catch (e) { console.error('cron lembretes:', e.message); }
    try { espera = await L.rpcServico('cron_limpar_espera', {}); } catch (e) { console.error('cron espera:', e.message); }
    try { whatsapp = await W.enviarFila(); } catch (e) { console.error('cron whatsapp:', e.message); }
    let tokens = null;
    try { tokens = await require('./_wa-renovar').renovarTodos(); } catch (e) { console.error('cron renovar token:', e.message); }
    let push = null;
    try { await L.rpcServico('cron_push_aniversarios', {}); push = await require('./_push').processar((L.siteUrl(req) || 'https://www.agendio.tec.br').replace(/^http:/, 'https:'), 50); } catch (e) { console.error('cron push:', e.message); }
    let relatorios = null, copias = null;
    try { relatorios = await require('./_relatorios').mensais(L.siteUrl(req)); } catch (e) { console.error('cron relatórios:', e.message); }
    try { copias = await require('./_relatorios').backups(L.siteUrl(req)); } catch (e) { console.error('cron cópias:', e.message); }
    let emails = null, resumo = null;
    try { emails = await A.processar({ site: L.siteUrl(req) }); } catch (e) { console.error('cron emails:', e.message); }
    try { resumo = await A.resumoAdmin(L.siteUrl(req)); } catch (e) { console.error('cron resumo:', e.message); }
    return L.json(res, 200, { ok: true, emails, resumo_admin: resumo, situacoes, cobrancas_geradas: geradas, saloes_bloqueados: bloqueados, cobrancas_mensagens: msgsCobradas, sinais_expirados: sinais, lembretes_na_fila: lembretes, avisos_celular: push, espera_removida: espera, whatsapp, tokens_whatsapp: tokens, relatorios_mensais: relatorios, copias_semanais: copias });
  } catch (e) {
    console.error('cron:', e.message);
    return L.json(res, 500, { erro: 'Falha na rotina diária.' });
  }
};
