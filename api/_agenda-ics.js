// Agenda no celular: GET /api/agenda-ics?t=<código>  -> calendário (.ics) que o Google Agenda / Apple Calendário assinam.
// O código é secreto (32 caracteres) e mostra só horário, serviço e primeiro nome da cliente.
const L = require('./_lib');

const esc = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
// Linhas do .ics não passam de 75 bytes: o resto continua na linha seguinte começando com espaço.
function dobra(l) {
  const b = Buffer.from(l, 'utf8');
  if (b.length <= 75) return l;
  const partes = []; let i = 0, lim = 75;
  while (i < b.length) {
    let f = Math.min(i + lim, b.length);
    while (f < b.length && (b[f] & 0xc0) === 0x80) f--; // não corta no meio de uma letra acentuada
    partes.push(b.slice(i, f).toString('utf8')); i = f; lim = 74;
  }
  return partes.join('\r\n ');
}
function montar(d) {
  const agora = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const nome = 'Agenda ' + d.salao + (d.prof ? ' - ' + d.prof : '');
  const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Agendio//Agenda//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + esc(nome), 'X-WR-TIMEZONE:America/Sao_Paulo', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  (d.itens || []).forEach(a => {
    if (!/^\d{8}T\d{6}Z$/.test(a.ini) || !/^\d{8}T\d{6}Z$/.test(a.fim)) return;
    const t = String(a.servico || 'Atendimento') + (a.cliente ? ' - ' + a.cliente : '');
    const desc = [a.prof ? 'Profissional: ' + a.prof : '', a.status === 'confirmado' ? 'Confirmado pela cliente' : ''].filter(Boolean).join('\n');
    l.push('BEGIN:VEVENT', 'UID:' + String(a.id).replace(/[^A-Za-z0-9_-]/g, '') + '@agendio.tec.br', 'DTSTAMP:' + agora,
      'DTSTART:' + a.ini, 'DTEND:' + a.fim, 'SUMMARY:' + esc(t));
    if (desc) l.push('DESCRIPTION:' + esc(desc));
    if (a.sala) l.push('LOCATION:' + esc(a.sala));
    l.push('END:VEVENT');
  });
  l.push('END:VCALENDAR');
  return l.map(dobra).join('\r\n') + '\r\n';
}

async function feed(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return L.json(res, 405, { erro: 'Método não permitido.' }); }
  if (L.faltandoBase().length) return L.json(res, 503, { erro: 'Serviço não configurado.' });
  let t = '';
  try { t = String((req.query && req.query.t) || new URL(req.url, 'http://x').searchParams.get('t') || ''); } catch (_) {}
  if (!/^[a-f0-9]{32}$/.test(t)) return L.json(res, 404, { erro: 'Link inválido.' });
  let d;
  try { d = await L.rpcServico('agenda_feed_dados', { p_token: t }); }
  catch (_) { return L.json(res, 502, { erro: 'Não foi possível ler a agenda agora.' }); }
  if (!d) return L.json(res, 404, { erro: 'Link inválido ou trocado. Gere um novo no sistema.' });
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="agenda.ics"');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.end(req.method === 'HEAD' ? '' : montar(d));
}
module.exports = { feed, montar };
