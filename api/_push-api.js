// /api/push-chave (GET), /api/push-enviar (POST) e /api/push-teste (POST, logado). Chamados por /api/x?a=...
const L = require('./_lib');
const P = require('./_push');

module.exports = async (req, res) => {
  if (L.faltandoBase().length) return L.json(res, 503, { erro: 'Avisos ainda não configurados.' });
  let a = '';
  try { a = String((req.query && req.query.a) || new URL(req.url, 'http://x').searchParams.get('a') || ''); } catch (_) {}
  const assunto = (L.siteUrl(req) || 'https://www.agendio.tec.br').replace(/^http:/, 'https:');
  try {
    if (a === 'push-chave') {
      if (req.method !== 'GET') return L.json(res, 405, { erro: 'Método não permitido.' });
      const c = await P.chaves();
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return L.json(res, 200, { chave: c.publica });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { erro: 'Método não permitido.' }); }
    if (a === 'push-enviar') {
      // Sem login de propósito: só envia o que já está na fila (criada pelo banco). Chamado pela página de agendamento e pela rotina diária.
      const r = await P.processar(assunto, 20);
      return L.json(res, 200, { ok: true, enviados: r.enviados });
    }
    if (a === 'push-teste') {
      const auth = String(req.headers.authorization || '');
      if (!/^Bearer\s+\S+/.test(auth)) return L.json(res, 401, { erro: 'Entre no sistema para testar.' });
      const r = await fetch(L.env('SUPABASE_URL').replace(/\/+$/, '') + '/rest/v1/push_inscricoes?select=endpoint,p256dh,auth', { headers: { apikey: L.env('SUPABASE_ANON_KEY'), Authorization: auth } });
      if (r.status === 401 || r.status === 403) return L.json(res, 401, { erro: 'Sessão expirada. Entre de novo.' });
      if (!r.ok) return L.json(res, 502, { erro: 'Não foi possível consultar os seus aparelhos.' });
      const lista = await r.json();
      if (!Array.isArray(lista) || !lista.length) return L.json(res, 409, { erro: 'Ligue os avisos neste aparelho primeiro.' });
      const c = await P.chaves();
      let ok = 0, mortos = 0, ult = 0;
      for (const ap of lista) {
        const x = await P.enviar(ap, { titulo: 'Agendio: aviso de teste', corpo: 'Se você recebeu isto, os avisos estão funcionando.', url: '/saas', tipo: 'teste' }, c, assunto, 600);
        if (x.ok) ok++; else ult = x.status;
        if (x.morto) { mortos++; try { await L.rpcServico('push_remover', { p_endpoint: ap.endpoint }); } catch (_) {} }
      }
      if (!ok) return L.json(res, 502, { erro: mortos ? 'Este aparelho não aceita mais avisos. Desligue e ligue de novo.' : 'O serviço de avisos do aparelho não respondeu' + (ult ? ' (erro ' + ult + ')' : '') + '. Tente de novo.' });
      return L.json(res, 200, { ok: true, enviados: ok });
    }
    return L.json(res, 404, { erro: 'não encontrado' });
  } catch (e) {
    console.error('push:', e.message);
    return L.json(res, 500, { erro: 'Falha ao enviar os avisos.' });
  }
};
