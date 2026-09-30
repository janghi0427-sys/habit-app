/* 동기 SHA-256 (ASCII 입력용). PIN 해시에만 사용. */
(function (root) {
  'use strict';
  function sha256(s) {
    var mp = Math.pow, mw = mp(2, 32), i, j, r = '', words = [], bitLen = s.length * 8;
    var hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [], pc = k.length, isC = {};
    for (var c = 2; pc < 64; c++) {
      if (!isC[c]) {
        for (i = 0; i < 313; i += c) isC[i] = c;
        hash[pc] = (mp(c, 0.5) * mw) | 0; k[pc++] = (mp(c, 1 / 3) * mw) | 0;
      }
    }
    hash = hash.slice(0, 8);
    var H0 = hash.slice();
    s += '\x80';
    while (s.length % 64 - 56) s += '\x00';
    for (i = 0; i < s.length; i++) { j = s.charCodeAt(i); words[i >> 2] |= j << ((3 - i) % 4) * 8; }
    words[words.length] = (bitLen / mw) | 0; words[words.length] = bitLen;
    hash = H0.slice();
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), old = hash; hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ (~e & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash);
        hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + old[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (hash[i] >> (j * 8)) & 255; r += (b < 16 ? '0' : '') + b.toString(16); }
    return r;
  }
  function stretch(secret, salt) { var h = secret + ':' + salt; for (var i = 0; i < 2000; i++) h = sha256(h + salt); return h; }
  var api = { sha256: sha256, stretch: stretch };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Sha = api;
})(typeof window !== 'undefined' ? window : this);
