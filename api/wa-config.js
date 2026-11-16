// GET /api/wa-config — diz se o "Conectar com o Facebook" está disponível e devolve os IDs públicos necessários (nunca o segredo).
const L = require('./_lib');
module.exports = async (req, res) => {
  const app = L.env('META_APP_ID'), cfg = L.env('META_CONFIG_ID');
  const ativo = !!(app && cfg && L.env('META_APP_SECRET') && /^[0-9]{5,30}$/.test(app) && /^[0-9]{5,30}$/.test(cfg));
  res.setHeader('Cache-Control', 'no-store');
  return L.json(res, 200, ativo ? { ativo: true, app_id: app, config_id: cfg } : { ativo: false });
};
