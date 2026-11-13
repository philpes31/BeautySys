/* Agendio: Pix "copia e cola" (BR Code estático) + QR code, sem biblioteca externa.
   window.AgendioPix.payload({chave,nome,cidade}, valor) -> texto do Pix
   window.AgendioPix.qrSvg(texto) -> <svg> pronto (preto sobre branco, com margem)
   window.AgendioPix.normalizaChave(tipo, texto) -> {ok, chave, erro} */
(function (w) {
  'use strict';

  /* ---------- Pix (BR Code) ---------- */
  function crc16(s) {
    var c = 0xFFFF, i, j;
    for (i = 0; i < s.length; i++) {
      c ^= s.charCodeAt(i) << 8;
      for (j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
    }
    return ('0000' + c.toString(16).toUpperCase()).slice(-4);
  }
  function tlv(id, v) { return id + ('0' + v.length).slice(-2) + v; }
  function limpa(s, n) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ')
      .replace(/ +/g, ' ').trim().toUpperCase().slice(0, n).trim();
  }
  function payload(p, valor) {
    var chave = String(p && p.chave || '').trim();
    var nome = limpa(p && p.nome, 25) || 'RECEBEDOR';
    var cidade = limpa(p && p.cidade, 15) || 'BRASIL';
    var v = Number(valor);
    var conta = tlv('00', 'br.gov.bcb.pix') + tlv('01', chave);
    var s = '000201' + '010211' + tlv('26', conta) + '52040000' + '5303986' +
      (v > 0 ? tlv('54', v.toFixed(2)) : '') + '5802BR' + tlv('59', nome) + tlv('60', cidade) + tlv('62', tlv('05', '***')) + '6304';
    return s + crc16(s);
  }
  function normalizaChave(tipo, txt) {
    var t = String(txt || '').trim(), d = t.replace(/\D/g, '');
    if (tipo === 'cpf_cnpj') {
      if (d.length === 11 || d.length === 14) return { ok: true, chave: d };
      return { ok: false, erro: 'O CPF tem 11 números e o CNPJ tem 14.' };
    }
    if (tipo === 'celular') {
      if (d.length >= 12 && d.slice(0, 2) === '55') d = d.slice(2);
      if (d.length === 10 || d.length === 11) return { ok: true, chave: '+55' + d };
      return { ok: false, erro: 'Informe o celular com DDD (10 ou 11 números).' };
    }
    if (tipo === 'email') {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) && t.length <= 77) return { ok: true, chave: t.toLowerCase() };
      return { ok: false, erro: 'E-mail inválido.' };
    }
    if (tipo === 'aleatoria') {
      if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(t)) return { ok: true, chave: t.toLowerCase() };
      return { ok: false, erro: 'A chave aleatória tem este formato: 123e4567-e12b-12d1-a456-426655440000.' };
    }
    return { ok: false, erro: 'Escolha o tipo da chave.' };
  }

  /* ---------- QR code (modo bytes, correção M, versões 1 a 14) ---------- */
  var EC = { 1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0], 4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0],
    6: [16, 4, 27, 0, 0], 7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37], 10: [26, 4, 43, 1, 44],
    11: [30, 1, 50, 4, 51], 12: [22, 6, 36, 2, 37], 13: [22, 8, 37, 1, 38], 14: [24, 4, 40, 5, 41] };
  var AL = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46],
    10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66] };
  var EXP = new Array(512), LOG = new Array(256);
  (function () { var x = 1, i; for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; } for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }
  function rsGen(n) {
    var g = [1], i, j;
    for (i = 0; i < n; i++) {
      var ng = new Array(g.length + 1); for (j = 0; j < ng.length; j++) ng[j] = 0;
      for (j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); }
      g = ng;
    }
    return g;
  }
  function rsEnc(data, n) {
    var g = rsGen(n), r = [], i, j;
    for (i = 0; i < n; i++) r.push(0);
    for (i = 0; i < data.length; i++) {
      var f = data[i] ^ r[0]; r.shift(); r.push(0);
      if (f) for (j = 0; j < n; j++) r[j] ^= gmul(g[j + 1], f);
    }
    return r;
  }
  function bch(v, g, bits) { var d = v << bits, i; var top = function (x) { var n = 0; while (x) { n++; x >>>= 1; } return n; };
    var gl = top(g); while (top(d) - gl >= 0) d ^= g << (top(d) - gl); return (v << bits) | d; }

  function utf8(s) { var u = unescape(encodeURIComponent(s)), a = [], i; for (i = 0; i < u.length; i++) a.push(u.charCodeAt(i)); return a; }

  function qrMatrix(text) {
    var bytes = utf8(text), ver = 0, v, e, cap;
    for (v = 1; v <= 14; v++) {
      e = EC[v]; cap = e[1] * e[2] + e[3] * e[4];
      if (4 + (v < 10 ? 8 : 16) + 8 * bytes.length <= cap * 8) { ver = v; break; }
    }
    if (!ver) throw new Error('Texto grande demais para o QR.');
    e = EC[ver]; cap = e[1] * e[2] + e[3] * e[4];
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(function (b) { put(b, 8); });
    var maxBits = cap * 8; put(0, Math.min(4, maxBits - bits.length));
    while (bits.length % 8) bits.push(0);
    var cw = [], i, j;
    for (i = 0; i < bits.length; i += 8) { var b = 0; for (j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; cw.push(b); }
    for (i = 0; cw.length < cap; i++) cw.push(i % 2 ? 0x11 : 0xEC);
    // blocos + correção de erros
    var blocks = [], ecs = [], pos = 0, n;
    for (n = 0; n < e[1] + e[3]; n++) {
      var len = n < e[1] ? e[2] : e[4], d = cw.slice(pos, pos + len); pos += len; blocks.push(d); ecs.push(rsEnc(d, e[0]));
    }
    var out = [], maxD = Math.max(e[2], e[4]);
    for (i = 0; i < maxD; i++) blocks.forEach(function (d) { if (i < d.length) out.push(d[i]); });
    for (i = 0; i < e[0]; i++) ecs.forEach(function (c) { out.push(c[i]); });

    var size = 17 + 4 * ver, base = [], res = [];
    for (i = 0; i < size; i++) { base.push(new Array(size).fill(null)); res.push(new Array(size).fill(false)); }
    function set(r, c, val) { if (r >= 0 && c >= 0 && r < size && c < size) { base[r][c] = val; res[r][c] = true; } }
    function finder(r0, c0) {
      var r, c; for (r = -1; r <= 7; r++) for (c = -1; c <= 7; c++) {
        var on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        set(r0 + r, c0 + c, on);
      }
    }
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
    for (i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    var al = AL[ver];
    al.forEach(function (r0) { al.forEach(function (c0) {
      if ((r0 === 6 && c0 === 6) || (r0 === 6 && c0 === al[al.length - 1]) || (r0 === al[al.length - 1] && c0 === 6)) return;
      var r, c; for (r = -2; r <= 2; r++) for (c = -2; c <= 2; c++) set(r0 + r, c0 + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
    }); });
    for (i = 0; i < 9; i++) { res[8][i] = true; res[i][8] = true; }
    for (i = 0; i < 8; i++) { res[8][size - 1 - i] = true; res[size - 1 - i][8] = true; }
    set(size - 8, 8, true);
    if (ver >= 7) {
      var vb = bch(ver, 0x1F25, 12);
      for (i = 0; i < 18; i++) { var m = (vb >> i) & 1; set(Math.floor(i / 3), i % 3 + size - 11, !!m); set(i % 3 + size - 11, Math.floor(i / 3), !!m); }
    }
    var masks = [
      function (r, c) { return (r + c) % 2 === 0; }, function (r) { return r % 2 === 0; }, function (r, c) { return c % 3 === 0; },
      function (r, c) { return (r + c) % 3 === 0; }, function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
      function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; }, function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
      function (r, c) { return ((r * c) % 3 + (r + c) % 2) % 2 === 0; }];
    function build(mk) {
      var m = base.map(function (row) { return row.slice(); });
      var inc = -1, row = size - 1, bi = 7, by = 0, col, c2;
      for (col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        for (;;) {
          for (c2 = 0; c2 < 2; c2++) {
            if (!res[row][col - c2]) {
              var dark = by < out.length ? ((out[by] >>> bi) & 1) === 1 : false;
              if (masks[mk](row, col - c2)) dark = !dark;
              m[row][col - c2] = dark; bi--; if (bi === -1) { by++; bi = 7; }
            }
          }
          row += inc; if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
        }
      }
      var fb = bch(mk, 0x537, 10) ^ 0x5412;   // nível M = 00
      for (i = 0; i < 15; i++) {
        var md = ((fb >> i) & 1) === 1;
        if (i < 6) m[i][8] = md; else if (i < 8) m[i + 1][8] = md; else m[size - 15 + i][8] = md;
        if (i < 8) m[8][size - i - 1] = md; else if (i < 9) m[8][15 - i] = md; else m[8][15 - i - 1] = md;
      }
      m[size - 8][8] = true;
      return m;
    }
    function penalty(m) {
      var p = 0, r, c, run, k, dark = 0;
      for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) dark++;
      for (k = 0; k < 2; k++) for (r = 0; r < size; r++) {
        run = 1;
        for (c = 1; c <= size; c++) {
          var a = c < size ? (k ? m[c][r] : m[r][c]) : null, b = k ? m[c - 1][r] : m[r][c - 1];
          if (a === b) run++; else { if (run >= 5) p += 3 + run - 5; run = 1; }
        }
      }
      for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) { var q = m[r][c]; if (q === m[r][c + 1] && q === m[r + 1][c] && q === m[r + 1][c + 1]) p += 3; }
      var pat = [1, 0, 1, 1, 1, 0, 1];
      for (k = 0; k < 2; k++) for (r = 0; r < size; r++) for (c = 0; c <= size - 7; c++) {
        var ok = true; for (i = 0; i < 7; i++) { var z = k ? m[c + i][r] : m[r][c + i]; if ((z ? 1 : 0) !== pat[i]) { ok = false; break; } }
        if (!ok) continue;
        var l = true, rr = true;
        for (i = 1; i <= 4; i++) { var x1 = c - i, x2 = c + 6 + i;
          if (x1 >= 0 && (k ? m[x1][r] : m[r][x1])) l = false; if (x2 < size && (k ? m[x2][r] : m[r][x2])) rr = false; }
        if (l || rr) p += 40;
      }
      p += 10 * Math.floor(Math.abs(dark * 20 / (size * size) - 10));
      return p;
    }
    var best = null, bp = 1e9, mk;
    for (mk = 0; mk < 8; mk++) { var mm = build(mk), pp = penalty(mm); if (pp < bp) { bp = pp; best = mm; } }
    return best;
  }

  function qrSvg(text, label) {
    var m = qrMatrix(text), n = m.length, q = 4, d = '', r, c;
    for (r = 0; r < n; r++) for (c = 0; c < n; c++) if (m[r][c]) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
    var t = n + 2 * q;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + t + ' ' + t + '" shape-rendering="crispEdges" role="img" aria-label="' +
      (label || 'QR code do Pix') + '"><rect width="' + t + '" height="' + t + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  w.AgendioPix = { payload: payload, qrSvg: qrSvg, qrMatrix: qrMatrix, crc16: crc16, normalizaChave: normalizaChave };
})(typeof window !== 'undefined' ? window : globalThis);
