// GET /api/saude — diz se as funções do servidor estão no ar e quais configurações já existem.
// Mostra só "configurado / faltando" (nunca o valor). Serve para você conferir a Vercel sem abrir o painel.
const L = require('./_lib');

// Testes de verdade (?testar=1): pergunta ao Supabase e ao Mercado Pago se as chaves funcionam. Nunca devolve chaves.
async function testes() {
  const out = [];
  const tenta = async (nome, fn) => { try { out.push(Object.assign({ nome }, await fn())); } catch (e) { out.push({ nome, ok: false, dica: 'Não consegui conversar com o serviço (' + String(e.message || e).slice(0, 80) + ').' }); } };
  const base = L.env('SUPABASE_URL').replace(/\/+$/, '');
  if (L.faltandoBase().length === 0) {
    await tenta('Supabase aceita a chave pública (anon)', async () => {
      // /auth/v1/settings é público e só responde 200 se a chave for válida (o /rest/v1/ raiz recusa chaves novas e daria alarme falso)
      const r = await fetch(base + '/auth/v1/settings', { headers: { apikey: L.env('SUPABASE_ANON_KEY') } });
      return r.status < 400 ? { ok: true } : { ok: false, dica: 'O Supabase recusou a chave SUPABASE_ANON_KEY (erro ' + r.status + '). Copie de novo em Project Settings > API.' };
    });
    await tenta('Supabase aceita a chave de serviço e o SQL de pagamentos está instalado', async () => {
      try {
        const r = await L.rpcServico('mp_dados_cobranca', { p_id: '00000000-0000-0000-0000-000000000000' });
        return { ok: true };
      } catch (e) {
        if (e.status === 404) return { ok: false, dica: 'Falta rodar o agendio-TUDO.sql no Supabase (a função de pagamentos não existe).' };
        const motivo = String(e.message || '').slice(0, 140);
        if (/permission denied|must be owner|not allowed/i.test(motivo)) return { ok: false, dica: 'A chave entrou, mas o banco negou a permissão (' + motivo + '). Rode de novo o agendio-TUDO.sql inteiro no Supabase (SQL Editor > Run) e teste outra vez.' };
        if (e.status === 401 || e.status === 403) return { ok: false, dica: 'O Supabase recusou a SUPABASE_SERVICE_KEY (' + e.status + ': ' + motivo + '). Use a chave "secret" (sb_secret_…) ou "service_role", inteira e sem espaços, não a publishable/anon.' };
        return { ok: false, dica: 'Erro ' + (e.status || '') + ' ao falar com o Supabase.' };
      }
    });
  }
  if (L.env('MP_ACCESS_TOKEN')) {
    await tenta('Mercado Pago aceita o Access Token da plataforma', async () => {
      const r = await L.mp('/users/me', { method: 'GET' });
      if (r.ok) return { ok: true, extra: r.dados && r.dados.site_id ? 'conta do país ' + r.dados.site_id : '' };
      if (r.status === 401 || r.status === 403) return { ok: false, dica: 'O Mercado Pago recusou o token. Gere de novo em Suas integrações > Credenciais de produção e cole em MP_ACCESS_TOKEN.' };
      return { ok: false, dica: 'O Mercado Pago respondeu erro ' + r.status + '.' };
    });
  }
  return out;
}

module.exports = async (req, res) => {
  const tem = n => !!L.env(n);
  const base = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY'];
  const mp = ['MP_ACCESS_TOKEN'];
  const wa = ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID'];
  const cron = ['CRON_SECRET'];
  const falta = l => l.filter(n => !tem(n));
  const grupo = (nome, l, como) => ({ nome, pronto: falta(l).length === 0, faltando: falta(l), como });
  const g = [
    grupo('Banco de dados (Supabase)', base, 'Vercel → Settings → Environment Variables'),
    grupo('Mensalidade pelo Mercado Pago', mp.concat(base), 'Coloque o Access Token de produção em MP_ACCESS_TOKEN'),
    grupo('Rotina diária (cron)', cron.concat(base), 'Crie CRON_SECRET com uma senha longa qualquer'),
    grupo('WhatsApp automático', wa.concat(base), 'Só depois de configurar o WhatsApp Business (guia)')
  ];
  const q = String(req.url || '').includes('testar=1');
  const resp = { ok: true, api: 'no ar', hora: new Date().toISOString(), site: L.siteUrl(req), webhook: L.siteUrl(req) + '/api/mp-webhook', grupos: g };
  if (q) resp.testes = await testes();
  return L.json(res, 200, resp);
};
