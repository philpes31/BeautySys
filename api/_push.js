// Web Push sem dependências: criptografia aes128gcm (RFC 8291) e identificação VAPID (RFC 8292) com o módulo "crypto" do Node.
const crypto = require('crypto');
const L = require('./_lib');

const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

// Chaves VAPID: criadas uma vez e guardadas no banco (só o servidor lê). A pública vai para o navegador.
async function chaves() {
  let c = await L.rpcServico('push_config_ler', {});
  if (c && c.publica && c.privada) return c;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  const d = privateKey.export({ format: 'jwk' }).d;
  c = await L.rpcServico('push_config_gravar', { p_publica: b64u(pub), p_privada: d });
  return c;
}

function jwtVapid(endpoint, c, assunto) {
  const aud = new URL(endpoint).origin;
  const cab = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const cor = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: assunto }));
  const pub = deb64u(c.publica);
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: c.privada }, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(cab + '.' + cor), { key, dsaEncoding: 'ieee-p1363' });
  return cab + '.' + cor + '.' + b64u(sig);
}

function criptografar(texto, p256dh, auth) {
  const uaPub = deb64u(p256dh), segredoAuth = deb64u(auth);
  if (uaPub.length !== 65 || uaPub[0] !== 4 || segredoAuth.length < 8) throw new Error('assinatura do aparelho inválida');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const segredo = ecdh.computeSecret(uaPub);
  const salt = crypto.randomBytes(16);
  const ikm = hkdf(segredoAuth, segredo, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cifra = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const dados = Buffer.concat([cifra.update(Buffer.concat([Buffer.from(texto, 'utf8'), Buffer.from([2])])), cifra.final(), cifra.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, dados]);
}

// Envia um aviso a um aparelho. Devolve { ok, status, morto } (morto = o aparelho não existe mais).
async function enviar(ap, aviso, c, assunto, ttl) {
  try {
    if (!/^https:\/\//.test(ap.endpoint || '')) return { ok: false, status: 0, morto: true };
    const corpo = criptografar(JSON.stringify(aviso), ap.p256dh, ap.auth);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    let r;
    try {
      r = await fetch(ap.endpoint, {
        method: 'POST', body: corpo, signal: ctl.signal,
        headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', 'Content-Length': String(corpo.length), TTL: String(ttl || 86400), Urgency: 'normal',
          Authorization: 'vapid t=' + jwtVapid(ap.endpoint, c, assunto) + ', k=' + c.publica }
      });
    } finally { clearTimeout(t); }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, morto: r.status === 404 || r.status === 410 };
  } catch (e) { return { ok: false, status: 0, morto: false, erro: String(e.message || e).slice(0, 80) }; }
}

// Pega os avisos pendentes da fila (o banco marca como enviados) e manda para os aparelhos certos.
async function processar(assunto, limite) {
  const c = await chaves();
  const itens = await L.rpcServico('push_pegar', { p_limite: limite || 20 });
  let enviados = 0, falhas = 0, removidos = 0;
  for (const it of Array.isArray(itens) ? itens : []) {
    const aviso = { titulo: it.titulo, corpo: it.corpo, url: it.url, tipo: it.tipo };
    for (const ap of it.aparelhos || []) {
      const r = await enviar(ap, aviso, c, assunto);
      if (r.ok) enviados++; else falhas++;
      if (r.morto) { try { await L.rpcServico('push_remover', { p_endpoint: ap.endpoint }); removidos++; } catch (_) {} }
    }
  }
  return { avisos: Array.isArray(itens) ? itens.length : 0, enviados, falhas, removidos };
}
module.exports = { chaves, enviar, processar, criptografar, jwtVapid, b64u, deb64u };
