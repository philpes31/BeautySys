// E-mails periódicos para a dona do salão: relatório do mês (todo dia 1, até o dia 7 se falhar) e cópia de segurança semanal (segunda e terça).
// Cada salão liga ou desliga em Salão > Seus dados. A cópia vem desligada. Cada e-mail é enviado uma única vez por período.
const L = require('./_lib');
const E = require('./_email');

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const dif = (atual, antes) => {
  atual = Number(atual) || 0; antes = Number(antes) || 0;
  if (!antes) return atual ? 'primeiro mês com faturamento' : '';
  const p = Math.round((atual - antes) / antes * 100);
  return (p >= 0 ? '+' : '') + p + '% sobre o mês anterior (' + E.brl(antes) + ')';
};
const linha = (nome, valor, extra) => '<tr><td style="padding:6px 0;color:#7a6670">' + E.esc(nome) + '</td><td style="padding:6px 0;text-align:right"><b>' + E.esc(valor) + '</b>' + (extra ? '<br><span style="font-size:12px;color:#7a6670">' + E.esc(extra) + '</span>' : '') + '</td></tr>';

function montarMensal(it, site) {
  const d = it.dados || {};
  const m = /^(\d{4})-(\d{2})/.exec(String(it.chave || '')); const nomeMes = m ? MESES[Number(m[2]) - 1] + ' de ' + m[1] : 'mês passado';
  const tops = (d.servicos_top || []).map(x => '<li>' + E.esc(x.servico) + ': ' + Number(x.qtd) + (Number(x.qtd) === 1 ? ' vez' : ' vezes') + ' (' + E.esc(E.brl(x.valor)) + ')</li>').join('');
  const nomes = (d.sumidas_nomes || []).map(n => String(n)).join(', ');
  const corpo = '<p>Olá! Este é o resumo de <b>' + E.esc(nomeMes) + '</b> do salão <b>' + E.esc(it.nome) + '</b>.</p>'
    + '<table style="width:100%;border-collapse:collapse;margin:8px 0">'
    + linha('Faturamento total', E.brl(d.faturamento_total), dif(d.faturamento_total, d.faturamento_anterior))
    + linha('Serviços', E.brl(d.faturamento_servicos), Number(d.atendimentos) + (Number(d.atendimentos) === 1 ? ' atendimento' : ' atendimentos'))
    + linha('Venda de produtos', E.brl(d.faturamento_vendas))
    + linha('Clientes novas', String(Number(d.clientes_novas) || 0))
    + linha('Clientes que sumiram (2 a 12 meses sem vir)', String(Number(d.clientes_sumidas) || 0), nomes ? 'Ex.: ' + nomes : '') + '</table>'
    + (tops ? '<p style="margin:14px 0 4px"><b>Serviços que mais renderam</b></p><ul style="margin:0;padding-left:18px">' + tops + '</ul>' : '<p>Nenhum atendimento concluído no período.</p>')
    + '<p style="color:#7a6670;font-size:13px;margin-top:14px">Para não receber mais, desligue em Salão &gt; Seus dados.</p>';
  const texto = 'Resumo de ' + nomeMes + ' do salão ' + it.nome + '\nFaturamento: ' + E.brl(d.faturamento_total) + '\nClientes novas: ' + (Number(d.clientes_novas) || 0) + '\nClientes que sumiram: ' + (Number(d.clientes_sumidas) || 0);
  return { assunto: 'Resumo de ' + nomeMes + ' do seu salão', html: E.layout('Resumo de ' + nomeMes, corpo, { url: site ? site + '/saas' : '', texto: 'Abrir o Agendio' }), texto };
}

async function mensais(site) {
  const r = { enviados: 0, falhas: 0 };
  if (!E.configurado()) return Object.assign(r, { desligado: true });
  const lista = await L.rpcServico('cron_relatorios_mensais', {});
  for (const it of (Array.isArray(lista) ? lista : []).slice(0, 60)) {
    const m = montarMensal(it, site);
    const x = await E.enviar({ para: it.email, assunto: m.assunto, html: m.html, texto: m.texto });
    if (!x.ok) { r.falhas++; console.error('relatório mensal falhou:', x.erro); continue; }
    try { await L.rpcServico('cron_marcar_email', { p_tenant: it.tenant_id, p_tipo: 'relatorio_mensal', p_chave: it.chave }); } catch (e) { console.error('marcar relatório:', e.message); }
    r.enviados++;
  }
  return r;
}

async function backups(site) {
  const r = { enviados: 0, falhas: 0, grandes: 0 };
  if (!E.configurado()) return Object.assign(r, { desligado: true });
  const lista = await L.rpcServico('cron_backups_semanais', {});
  for (const it of (Array.isArray(lista) ? lista : []).slice(0, 20)) {
    try {
      const dados = await L.rpcServico('backup_dados', { p_tenant: it.tenant_id });
      const buf = Buffer.from(JSON.stringify(dados, null, 1), 'utf8');
      if (buf.length > 18 * 1024 * 1024) { r.grandes++; console.error('backup muito grande para e-mail:', it.tenant_id); continue; }
      const dia = L.dataSP();
      const corpo = '<p>Olá! Segue a cópia de segurança semanal do salão <b>' + E.esc(it.nome) + '</b>, com clientes, atendimentos, despesas, contas a pagar, produtos, vendas e pacotes.</p>'
        + '<p><b>Cuidado:</b> o arquivo tem dados pessoais das suas clientes. Guarde em local seguro e apague este e-mail se não precisar mais dele. Quem recebe este arquivo é responsável por protegê-lo (LGPD).</p>'
        + '<p style="color:#7a6670;font-size:13px">Para parar de receber, desligue em Salão &gt; Seus dados.</p>';
      const x = await E.enviar({ para: it.email, assunto: 'Cópia de segurança do seu salão (' + dia + ')', html: E.layout('Cópia de segurança semanal', corpo), texto: 'Cópia de segurança semanal do salão ' + it.nome + ' em anexo. O arquivo tem dados pessoais das suas clientes: guarde com cuidado.',
        anexos: [{ nome: 'agendio-copia-' + dia + '.json', base64: buf.toString('base64') }] });
      if (!x.ok) { r.falhas++; console.error('backup semanal falhou:', x.erro); continue; }
      await L.rpcServico('cron_marcar_email', { p_tenant: it.tenant_id, p_tipo: 'backup_semanal', p_chave: it.chave });
      r.enviados++;
    } catch (e) { r.falhas++; console.error('backup semanal:', e.message); }
  }
  return r;
}
module.exports = { mensais, backups, montarMensal };
