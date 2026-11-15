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
  const x = await E.enviar({ para, assunto: titulo, html: E.layout(titulo, '<ul style="padding-left:18px;margin:0">' + itens + '</ul>', { url: site ? site + '/' : '', texto: 'Abrir a Plataforma' }),
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
module.exports = { processar, resumoAdmin, avisarAdmin };
