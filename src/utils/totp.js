// utils/totp.js — Implémentation autonome TOTP (RFC 6238) + Base32 (RFC 4648)
// Aucune dépendance externe : uniquement le module 'crypto' natif de Node.js.
'use strict';

const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ─── Base32 ────────────────────────────────────────────────────────────────
function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');

  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.substring(i, i + 5).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return output;
}

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// ─── Génération du secret ────────────────────────────────────────────────────
function generateSecret(byteLength = 20) {
  return base32Encode(crypto.randomBytes(byteLength));
}

// ─── URI otpauth:// (à saisir manuellement ou scanner via QR externe) ────────
function generateURI(secretBase32, accountLabel, issuer = 'Bumpify') {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ─── Calcul d'un code TOTP pour un compteur donné ────────────────────────────
function hotp(secretBase32, counter, digits = 6) {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  // Écrit le compteur 64 bits big-endian
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);

  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binCode % 10 ** digits).padStart(digits, '0');
}

function generateTOTP(secretBase32, { period = 30, digits = 6, forTime = Date.now() } = {}) {
  const counter = Math.floor(forTime / 1000 / period);
  return hotp(secretBase32, counter, digits);
}

// ─── Vérification avec fenêtre de tolérance (± window pas de temps) ─────────
function verifyTOTP(secretBase32, token, { period = 30, digits = 6, window = 1, forTime = Date.now() } = {}) {
  if (!token || !/^\d+$/.test(String(token).trim())) return false;
  const cleanToken = String(token).trim().padStart(digits, '0');
  const counter = Math.floor(forTime / 1000 / period);

  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const candidate = hotp(secretBase32, counter + errorWindow, digits);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(cleanToken))) {
      return true;
    }
  }
  return false;
}

module.exports = { base32Encode, base32Decode, generateSecret, generateURI, generateTOTP, verifyTOTP };
