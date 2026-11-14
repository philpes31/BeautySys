// GET /api/mp-config  -> { public_key }   A chave pública do Mercado Pago (feita para ficar no navegador). Vem da Vercel, não do código.
const L = require('./_lib');
module.exports = async (req, res) => {
  const k = L.env('MP_PUBLIC_KEY');
  if (!/^(APP_USR|TEST)-[A-Za-z0-9-]{20,80}$/.test(k)) return L.json(res, 200, { public_key: '' });
  return L.json(res, 200, { public_key: k });
};
