// POST /api/email-teste — só administrador da plataforma. Envia um e-mail de teste para EMAIL_ADMIN.
const L = require('./_lib');
const E = require('./_email');

async function souAdmin(req) {
  const auth = String((req.headers && req.headers.authorization) || '');
  if (!/^Bearer\s+\S+/.test(auth) || L.faltandoBase().length) return false;
  try {
    const r = await fetch(L.env('SUPABASE_URL').replace(/\/+$/, '') + '/rest/v1/rpc/sou_admin_plataforma', {
      method: 'POST', headers: { apikey: L.env('SUPABASE_ANON_KEY'), Authorization: auth, 'Content-Type': 'application/json' }, body: '{}'
    });
    return r.ok && (await r.json()) === true;
  } catch (_) { return false; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return L.json(res, 405, { erro: 'Use POST.' });
  if (!(await souAdmin(req))) return L.json(res, 403, { erro: 'Só o administrador da plataforma.' });
  if (!E.configurado()) return L.json(res, 200, { ok: false, erro: 'Faltam RESEND_API_KEY e EMAIL_REMETENTE na Vercel (depois, Redeploy).' });
  const para = L.env('EMAIL_ADMIN');
  if (!/^[^\s@]+@[^\s@]+$/.test(para)) return L.json(res, 200, { ok: false, erro: 'Falta EMAIL_ADMIN (seu e-mail) na Vercel.' });
  const x = await E.enviar({ para, assunto: 'Teste de e-mail do Agendio', html: E.layout('Deu certo!', '<p>Se você está lendo isto, os e-mails automáticos do Agendio estão funcionando.</p>'), texto: 'Deu certo! Os e-mails automáticos do Agendio estão funcionando.' });
  return L.json(res, 200, x.ok ? { ok: true, enviado_para: para } : { ok: false, erro: x.erro });
};
