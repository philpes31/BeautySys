
// Envio de mensagens pelo WhatsApp Business (API oficial da Meta). Fica DESLIGADO até existirem as chaves:
//   WHATSAPP_TOKEN (token permanente) e WHATSAPP_PHONE_ID (ID do número). Opcional: WHATSAPP_IDIOMA (padrão pt_BR).
// Mensagens que o salão inicia precisam de MODELOS aprovados pela Meta; os nomes estão em fila_whatsapp.modelo:
//   lembrete_agendamento  {{1}} nome, {{2}} dia, {{3}} hora, {{4}} serviço, {{5}} salão
//   pedido_aceito         mesmas 5 variáveis
//   pedido_recusado       mesmas 5 variáveis
const L = require('./_lib');
const GRAPH = 'https://graph.facebook.com/v21.0';

const limpa = v => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 120) || '-';

async function enviarUma(m) {
  const body = {
    messaging_product: 'whatsapp', to: '55' + m.telefone, type: 'template',
    template: { name: m.modelo, language: { code: L.env('WHATSAPP_IDIOMA') || 'pt_BR' },
      components: [{ type: 'body', parameters: (Array.isArray(m.params) ? m.params : []).map(t => ({ type: 'text', text: limpa(t) })) }] }
  };
  const r = await fetch(GRAPH + '/' + L.env('WHATSAPP_PHONE_ID') + '/messages', {
    method: 'POST', headers: { Authorization: 'Bearer ' + L.env('WHATSAPP_TOKEN'), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  let j = null; try { j = await r.json(); } catch (_) { j = null; }
  if (r.ok) return { ok: true };
  const msg = String((j && j.error && (j.error.message || j.error.type)) || ('HTTP ' + r.status)).slice(0, 250);
  return { ok: false, erro: msg, definitivo: r.status >= 400 && r.status < 500 && r.status !== 429 };
}

async function enviarFila() {
  if (!L.env('WHATSAPP_TOKEN') || !L.env('WHATSAPP_PHONE_ID')) return { ligado: false };
  const lote = await L.rpcServico('wa_pegar', { p_limite: 30 });
  let enviados = 0, falhas = 0;
  for (const m of (lote || [])) {
    let r;
    try { r = await enviarUma(m); } catch (e) { r = { ok: false, erro: 'rede: ' + String(e.message || e).slice(0, 200), definitivo: false }; }
    try { await L.rpcServico('wa_resultado', { p_id: m.id, p_ok: r.ok, p_erro: r.erro || null, p_definitivo: !!r.definitivo }); } catch (_) { /* volta sozinho após 30 min */ }
    if (r.ok) enviados++; else falhas++;
  }
  return { ligado: true, enviados, falhas };
}
module.exports = { enviarFila, enviarUma, limpa };
