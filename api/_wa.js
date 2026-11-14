// Envio de mensagens pelo WhatsApp Business (API oficial da Meta). Fica DESLIGADO até existirem as chaves:
//   WHATSAPP_TOKEN (token permanente) e WHATSAPP_PHONE_ID (ID do número). Opcional: WHATSAPP_IDIOMA (padrão pt_BR).
// Mensagens que o salão inicia precisam de MODELOS aprovados pela Meta; os nomes estão em fila_whatsapp.modelo:
//   lembrete_agendamento  {{1}} nome, {{2}} dia, {{3}} hora, {{4}} serviço, {{5}} salão
//   pedido_aceito         mesmas 5 variáveis
//   pedido_recusado       mesmas 5 variáveis
// Opcional: WHATSAPP_MODELO_LEMBRETE_LINK = nome de um modelo de lembrete com as mesmas 5 variáveis e um botão
//   "Visitar site" com URL https://SEU-SITE/a/{{1}} (o {{1}} do botão recebe "endereco?m=codigo"). Se não existir, usa o lembrete sem botão.
const L = require('./_lib');
const GRAPH = 'https://graph.facebook.com/v21.0';

const limpa = v => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 120) || '-';

const SUFIXO = /^[a-z0-9-]{1,60}\?m=[a-z0-9]{32}$/;

function montar(m) {
  const ps = Array.isArray(m.params) ? m.params : [];
  const corpo = ps.slice(0, 5).map(t => ({ type: 'text', text: limpa(t) }));
  let nome = m.modelo;
  const components = [{ type: 'body', parameters: corpo }];
  const modeloLink = L.env('WHATSAPP_MODELO_LEMBRETE_LINK');
  if (m.modelo === 'lembrete_agendamento' && modeloLink && /^[a-z0-9_]{1,60}$/.test(modeloLink) && typeof ps[5] === 'string' && SUFIXO.test(ps[5])) {
    nome = modeloLink;
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: ps[5] }] });
  }
  return { nome, components };
}

async function enviarUma(m) {
  const t = montar(m);
  const body = {
    messaging_product: 'whatsapp', to: '55' + m.telefone, type: 'template',
    template: { name: t.nome, language: { code: L.env('WHATSAPP_IDIOMA') || 'pt_BR' }, components: t.components }
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
module.exports = { enviarFila, enviarUma, limpa, montar };
