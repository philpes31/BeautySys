// Envia os e-mails automáticos pendentes (cobrança, teste, recibo) e o resumo de alertas para o administrador.
const L = require('./_lib');
const E = require('./_email');

// tipos: lista opcional (ex.: ['recibo']); site: endereço do sistema
async function processar({ tipos, site, limite } = {}) {
  const r = { enviados: 0, falhas: 0, ignorados: 0 };
  if (!E.configurado()) return Object.assign(r, { desligado: true });
  const lista = await L.rpcServico('cron_emails_pendentes', { p_tipos: tipos && tipos.length ? tipos : null });
  for (const it of (Array.isArray(lista) ? lista : []).slice(0, limite || 60)) {
    const m = E.montar(it, site);
    if (!m) { r.ignorados++; continue; }
    const x = await E.enviar({ para: it.email, assunto: m.assunto, html: m.html, texto: m.texto });
    if (!x.ok) { r.falhas++; console.error('aviso por e-mail falhou:', it.tipo, x.erro); continue; }
    try { await L.rpcServico('cron_marcar_email', { p_tenant: it.tenant_id, p_tipo: it.tipo, p_chave: it.chave }); } catch (e) { console.error('marcar e-mail:', e.message); }
    r.enviados++;
  }
  return r;
}

// Um e-mail por dia com os alertas (urgente e atenção) da plataforma
async function resumoAdmin(site) {
  const para = L.env('EMAIL_ADMIN');
  if (!E.configurado() || !/^[^\s@]+@[^\s@]+$/.test(para)) return { desligado: true };
  const hoje = L.dataSP();
  if (await L.rpcServico('cron_email_enviado', { p_tenant: null, p_tipo: 'admin_resumo', p_chave: hoje })) return { ja_enviado: true };
  const al = (await L.rpcServico('cron_alertas', {})) || [];
  const rel = al.filter(a => a && (a.nivel === 'erro' || a.nivel === 'aviso'));
  if (!rel.length) return { enviados: 0 };
  const itens = rel.map(a => '<li style="margin:0 0 8px"><b>' + E.esc(a.titulo) + '</b>' + (a.detalhe ? '<br><span style="color:#7a6670">' + E.esc(a.detalhe) + '</span>' : '') + '</li>').join('');
  const titulo = rel.length + (rel.length === 1 ? ' alerta' : ' alertas') + ' no Agendio';
  const x = await E.enviar({ para, assunto: titulo, html: E.layout(titulo, '<ul style="padding-left:18px;margin:0">' + itens + '</ul>', { url: site ? site + '/saas' : '', texto: 'Abrir a Plataforma' }),
    texto: titulo + '\n\n' + rel.map(a => '- ' + a.titulo + (a.detalhe ? ' (' + a.detalhe + ')' : '')).join('\n') });
  if (!x.ok) { console.error('resumo admin falhou:', x.erro); return { enviados: 0, falha: x.erro }; }
  try { await L.rpcServico('cron_marcar_email', { p_tenant: null, p_tipo: 'admin_resumo', p_chave: hoje }); } catch (_) {}
  return { enviados: 1, alertas: rel.length };
}

// Aviso imediato para o administrador (ex.: pagamento recebido e não registrado)
async function avisarAdmin(assunto, linhas) {
  const para = L.env('EMAIL_ADMIN');
  if (!E.configurado() || !/^[^\s@]+@[^\s@]+$/.test(para)) return false;
  const x = await E.enviar({ para, assunto, html: E.layout(assunto, linhas.map(l => '<p>' + E.esc(l) + '</p>').join('')), texto: assunto + '\n\n' + linhas.join('\n') });
  return x.ok;
}

// Lembrete por e-mail para as clientes (24 h antes). O salão liga em Horários; só vai para quem tem e-mail na ficha. Um lembrete por atendimento.
async function lembretesClientes(site) {
  const r = { enviados: 0, falhas: 0 };
  if (!E.configurado()) return Object.assign(r, { desligado: true });
  const lista = await L.rpcServico('cron_lembretes_email', {});
  for (const it of (Array.isArray(lista) ? lista : []).slice(0, 100)) {
    const nome = E.esc(it.cliente || ''), salao = E.esc(it.salao || 'seu salão');
    const titulo = 'Lembrete: seu horário é amanhã' + (it.hora ? ' às ' + it.hora : '');
    const corpo = '<p>Olá' + (nome ? ', ' + nome : '') + '! Passando para lembrar do seu horário no <b>' + salao + '</b>.</p>'
      + '<p><b>' + E.esc(it.data) + (it.hora ? ' às ' + E.esc(it.hora) : '') + '</b><br>' + E.esc(it.servico || '') + '</p>'
      + '<p>Precisa remarcar? Fale com o salão' + (it.whatsapp ? ' pelo WhatsApp ' + E.esc(it.whatsapp) : ' respondendo este e-mail') + '.</p>';
    const x = await E.enviar({ para: it.email, assunto: titulo + ' - ' + (it.salao || ''), html: E.layout(titulo, corpo, null).replace('porque é responsável por um salão no Agendio', 'porque você tem um horário marcado em ' + salao), responder: it.salao_email, texto: titulo + '\n' + (it.data || '') + ' ' + (it.hora || '') + ' - ' + (it.servico || '') + '\n' + (it.salao || '') });
    if (!x.ok) { r.falhas++; console.error('lembrete cliente falhou:', x.erro); continue; }
    try { await L.rpcServico('cron_marcar_email', { p_tenant: it.tenant_id, p_tipo: 'lembrete_cli', p_chave: it.chave }); } catch (e) { console.error('marcar lembrete:', e.message); }
    r.enviados++;
  }
  return r;
}
module.exports = { processar, resumoAdmin, avisarAdmin, lembretesClientes };
