// Envio de e-mail pelo Resend (https://resend.com). Só funciona com RESEND_API_KEY configurada na Vercel.
const L = require('./_lib');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const dataBr = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };

function configurado() { return !!(L.env('RESEND_API_KEY') && L.env('EMAIL_REMETENTE')); }

// Casca visual simples (funciona em qualquer leitor de e-mail)
function layout(titulo, corpoHtml, botao) {
  return '<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f6f1f3;font-family:Arial,Helvetica,sans-serif;color:#2a1722">'
    + '<div style="max-width:560px;margin:0 auto;padding:24px 16px"><div style="font-size:24px;font-weight:700;margin-bottom:14px">Agendio</div>'
    + '<div style="background:#fff;border-radius:14px;padding:24px;line-height:1.55"><h1 style="font-size:20px;margin:0 0 12px">' + esc(titulo) + '</h1>' + corpoHtml
    + (botao && botao.url ? '<p style="margin:22px 0 4px"><a href="' + esc(botao.url) + '" style="background:#c85a86;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;display:inline-block">' + esc(botao.texto) + '</a></p>' : '')
    + '</div><p style="color:#7a6670;font-size:12px;margin:14px 4px">Você recebeu este e-mail porque é responsável por um salão no Agendio. Dúvidas? É só responder esta mensagem.</p></div></body></html>';
}

async function enviar({ para, assunto, html, texto, anexos, responder }) {
  if (!configurado()) return { ok: false, erro: 'E-mail não configurado.' };
  if (!/^[^\s@]+@[^\s@]+$/.test(String(para || ''))) return { ok: false, erro: 'Destinatário inválido.' };
  const corpo = { from: L.env('EMAIL_REMETENTE'), to: [String(para)], subject: String(assunto).slice(0, 200), html, text: texto || undefined };
  if (Array.isArray(anexos) && anexos.length) corpo.attachments = anexos.slice(0, 3).map(a => ({ filename: String(a.nome).slice(0, 80), content: a.base64 }));
  if (/^[^\s@]+@[^\s@]+$/.test(String(responder || ''))) corpo.reply_to = String(responder);
  else if (/^[^\s@]+@[^\s@]+$/.test(L.env('EMAIL_ADMIN'))) corpo.reply_to = L.env('EMAIL_ADMIN');
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + L.env('RESEND_API_KEY'), 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {}
    if (!r.ok) return { ok: false, erro: String((j && (j.message || j.error)) || ('Erro ' + r.status)).slice(0, 200), status: r.status };
    return { ok: true, id: j && j.id };
  } catch (e) { return { ok: false, erro: 'Falha de rede: ' + e.message }; }
}

// Monta assunto e texto de cada tipo de aviso. `site` é o endereço do sistema (https://...).
function montar(item, site) {
  const d = item.dados || {}, nome = esc(item.nome), irSalao = { url: site ? site + '/saas' : '', texto: 'Abrir o Agendio' };
  const dias = Number(d.dias);
  let assunto, titulo, corpo, botao = irSalao;
  switch (item.tipo) {
    case 'teste':
      assunto = dias === 0 ? 'Seu teste grátis do Agendio termina hoje' : dias === 1 ? 'Seu teste grátis do Agendio termina amanhã' : 'Faltam ' + dias + ' dias do seu teste grátis do Agendio';
      titulo = assunto;
      corpo = '<p>Olá! O teste grátis do salão <b>' + nome + '</b> vai até <b>' + esc(dataBr(d.vencimento)) + '</b>.</p><p>Para continuar usando sem perder agenda, clientes e histórico, escolha um plano em <b>Mais &gt; Salão &gt; Assinatura</b>. Leva 1 minuto, com Pix ou cartão.</p>';
      botao = { url: irSalao.url, texto: 'Escolher meu plano' }; break;
    case 'teste_fim':
      assunto = 'Seu teste grátis do Agendio terminou'; titulo = assunto;
      corpo = '<p>Olá! O teste do salão <b>' + nome + '</b> terminou. Seus dados estão guardados. Para continuar, escolha um plano e pague a primeira mensalidade (Pix ou cartão).</p>';
      botao = { url: irSalao.url, texto: 'Escolher meu plano' }; break;
    case 'vence':
      assunto = dias === 0 ? 'A mensalidade do Agendio vence hoje' : 'A mensalidade do Agendio vence em ' + dias + ' dias'; titulo = assunto;
      corpo = '<p>Olá! A mensalidade do salão <b>' + nome + '</b> no valor de <b>' + esc(brl(d.valor)) + '</b> vence em <b>' + esc(dataBr(d.vencimento)) + '</b>.</p><p>Para pagar: abra <b>Mais &gt; Salão &gt; Assinatura</b> e toque em <b>Pagar agora</b>. Se você ativou o débito automático, não precisa fazer nada.</p>';
      botao = { url: irSalao.url, texto: 'Pagar agora' }; break;
    case 'atraso':
      assunto = 'A mensalidade do Agendio está atrasada'; titulo = assunto;
      corpo = '<p>Olá! A mensalidade do salão <b>' + nome + '</b> (' + esc(brl(d.valor)) + ', venceu em ' + esc(dataBr(d.vencimento)) + ') está em aberto há <b>' + dias + (dias === 1 ? ' dia' : ' dias') + '</b>.</p>'
        + (d.bloqueio_em ? '<p>Se não for paga até <b>' + esc(dataBr(d.bloqueio_em)) + '</b>, o acesso ao sistema será suspenso. Ele volta assim que o pagamento for confirmado.</p>' : '')
        + '<p>Para regularizar: <b>Mais &gt; Salão &gt; Assinatura &gt; Pagar agora</b> (Pix ou cartão). Se já pagou, desconsidere este aviso.</p>';
      botao = { url: irSalao.url, texto: 'Pagar agora' }; break;
    case 'bloqueado':
      assunto = 'Acesso ao Agendio suspenso por falta de pagamento'; titulo = assunto;
      corpo = '<p>Olá! O acesso do salão <b>' + nome + '</b> foi suspenso porque a mensalidade não foi paga. Seus dados continuam guardados.</p><p>Responda este e-mail ou fale com o suporte para regularizar. Assim que o pagamento for confirmado, o acesso volta.</p>';
      botao = null; break;
    case 'recibo': {
      const desc = d.tipo === 'mensagens' ? (d.descricao || 'Mensagens de WhatsApp') : 'Mensalidade do Agendio · vencimento ' + dataBr(d.vencimento);
      assunto = 'Recibo do pagamento de ' + brl(d.valor) + ' no Agendio'; titulo = 'Pagamento recebido. Obrigado!';
      corpo = '<p>Recebemos o pagamento do salão <b>' + nome + '</b>.</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:6px 0;border-bottom:1px solid #eee">' + esc(desc) + '</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">' + esc(brl(d.valor)) + '</td></tr>'
        + (d.cupom && d.valor_original ? '<tr><td style="padding:6px 0;color:#7a6670">Cupom ' + esc(d.cupom) + ' (de ' + esc(brl(d.valor_original)) + ')</td><td></td></tr>' : '')
        + '<tr><td style="padding:6px 0;font-weight:700">Total pago</td><td style="padding:6px 0;text-align:right;font-weight:700">' + esc(brl(d.valor)) + '</td></tr></table><p style="color:#7a6670;font-size:13px">Data: ' + esc(dataBr(d.pago_em)) + '. Este e-mail é um recibo e não substitui nota fiscal.</p>';
      botao = null; break;
    }
    default: return null;
  }
  const texto = titulo + '\n\n' + corpo.replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim() + (botao && botao.url ? '\n\n' + botao.url : '');
  return { assunto, html: layout(titulo, corpo, botao), texto };
}

module.exports = { configurado, enviar, montar, layout, esc, brl, dataBr };
