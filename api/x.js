// Um único endpoint (limite de 12 funções do plano gratuito da Vercel) que repassa para os tratadores certos.
// Os endereços antigos continuam funcionando por causa dos "rewrites" do vercel.json (ex.: /api/wa-config → /api/x?a=wa-config).
const H = {
  'wa-conectar': require('./_wa-conectar'),
  'wa-config': require('./_wa-config'),
  'wa-signup': require('./_wa-signup'),
  'email-teste': require('./_email-teste'),
  'atend-cobrar': (rq, rs) => require('./_atend-cob').cobrar(rq, rs),
  'atend-webhook': (rq, rs) => require('./_atend-cob').webhook(rq, rs),
  'clube-cobrar': (rq, rs) => require('./_clube-cob').cobrar(rq, rs),
  'clube-webhook': (rq, rs) => require('./_clube-cob').webhook(rq, rs),
  'agenda-ics': (rq, rs) => require('./_agenda-ics').feed(rq, rs),
  'mp-config': require('./_mp-config'),
  'mp-conectar': require('./_mp-conectar'),
  'push-chave': require('./_push-api'),
  'push-enviar': require('./_push-api'),
  'push-teste': require('./_push-api')
};
module.exports = async (req, res) => {
  let a = '';
  try { a = String((req.query && req.query.a) || new URL(req.url, 'http://x').searchParams.get('a') || ''); } catch (e) {}
  const h = Object.prototype.hasOwnProperty.call(H, a) ? H[a] : null;
  if (!h) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); return res.end('{"erro":"não encontrado"}'); }
  return h(req, res);
};
