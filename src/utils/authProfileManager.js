// utils/authProfileManager.js — Logique centrale du système d'authentification personnel
'use strict';

const crypto = require('crypto');
const AuthProfile = require('../models/AuthProfile');

const MAX_LOGS = 50;
const PIN_LOCK_THRESHOLD = 5;
const PIN_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 min
const MAX_PASSKEYS = 5;
const FORGOT_DELAY_MS = 60 * 60 * 1000; // 1h de délai de sûreté avant réinitialisation

// ─── Clé de chiffrement AES-256-GCM pour les secrets 2FA ────────────────────
// Doit être une chaîne hex de 64 caractères (32 octets) dans .env → AUTH_ENCRYPTION_KEY
function getEncKey() {
  const raw = process.env.AUTH_ENCRYPTION_KEY;
  if (!raw || raw.length !== 64) {
    throw new Error(
      "AUTH_ENCRYPTION_KEY manquant ou invalide dans .env (doit être une chaîne hex de 64 caractères). " +
      "Générez-en une avec: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(raw, 'hex');
}

function encrypt(text) {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(payloadB64) {
  const key = getEncKey();
  const buf = Buffer.from(payloadB64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ─── Hachage PIN / codes de secours (scrypt) ─────────────────────────────────
function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(secret), salt, 64).toString('hex');
  return { hash, salt };
}

function verifySecret(secret, hash, salt) {
  if (!hash || !salt) return false;
  const attempt = crypto.scryptSync(String(secret), salt, 64).toString('hex');
  const a = Buffer.from(attempt, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ─── Force du PIN ─────────────────────────────────────────────────────────
function isPinWeak(pin) {
  const s = String(pin);
  if (/^(\d)\1+$/.test(s)) return true; // tous les chiffres identiques
  const ascending = '0123456789';
  const descending = '9876543210';
  if (ascending.includes(s) || descending.includes(s)) return true; // séquentiel
  const common = ['1234', '0000', '1111', '1212', '2580', '123456', '654321', '000000'];
  if (common.includes(s)) return true;
  return false;
}

// ─── Récupération / création du profil ───────────────────────────────────
async function getOrCreateProfile(userId) {
  let profile = await AuthProfile.findOne({ userId });
  if (!profile) profile = await AuthProfile.create({ userId });
  return profile;
}

// ─── Logs ──────────────────────────────────────────────────────────────────
async function addLog(profile, action, detail = '') {
  profile.logs.unshift({ action, detail, date: new Date() });
  if (profile.logs.length > MAX_LOGS) profile.logs = profile.logs.slice(0, MAX_LOGS);
  await profile.save();
}

const LOG_LABELS = {
  pin_set:        '🔢 Code PIN défini',
  pin_changed:    '🔢 Code PIN modifié',
  pin_failed:     '⚠️ Tentative de PIN échouée',
  pin_locked:     '🔒 Compte verrouillé (trop de tentatives)',
  twofa_enabled:  '⏱️ 2FA activée',
  twofa_disabled: '⏱️ 2FA désactivée',
  passkey_added:  '🔑 Passkey ajoutée',
  passkey_used:   '🔑 Passkey utilisée',
  passkey_revoked:'🔑 Passkey révoquée',
  forgot_requested: '🆘 Réinitialisation demandée',
  forgot_completed: '🆘 Tous les moyens d\'authentification ont été réinitialisés',
  forgot_cancelled: '🆘 Demande de réinitialisation annulée',
};

function formatLog(entry) {
  const label = LOG_LABELS[entry.action] || entry.action;
  const ts = Math.floor(new Date(entry.date).getTime() / 1000);
  return `<t:${ts}:R> — ${label}${entry.detail ? ` · ${entry.detail}` : ''}`;
}

// ─── Grade de sécurité ────────────────────────────────────────────────────
// F: rien configuré · E: PIN faible seul · D: PIN correct seul
// C: PIN + (2FA ou Passkey) · B: PIN + 2FA + Passkey · A: B + PIN fort + aucun verrou récent
function computeGrade(profile) {
  const hasPin = !!profile.pin?.isSet;
  const pinWeak = !!profile.pin?.weak;
  const has2FA = !!profile.twoFA?.enabled;
  const activePasskeys = (profile.passkeys || []).filter(p => !p.used).length;
  const hasPasskey = activePasskeys > 0;

  let grade = 'F';
  if (hasPin && pinWeak) grade = 'E';
  else if (hasPin && !pinWeak) grade = 'D';
  if (hasPin && (has2FA || hasPasskey)) grade = 'C';
  if (hasPin && has2FA && hasPasskey) grade = 'B';
  if (hasPin && !pinWeak && has2FA && hasPasskey) grade = 'A';

  const GRADE_META = {
    A: { emoji: '🟩', color: 0x57F287, tip: 'Excellent ! Votre compte est très bien protégé.' },
    B: { emoji: '🟦', color: 0x5865F2, tip: 'Très bon niveau de sécurité.' },
    C: { emoji: '🟨', color: 0xFEE75C, tip: 'Ajoutez une Passkey ou activez la 2FA pour améliorer votre grade.' },
    D: { emoji: '🟧', color: 0xF39C12, tip: 'Activez la 2FA pour améliorer votre grade de sécurité.' },
    E: { emoji: '🟧', color: 0xE67E22, tip: 'Votre code PIN est trop simple. Changez-le puis activez la 2FA.' },
    F: { emoji: '🟥', color: 0xED4245, tip: 'Aucune protection configurée ! Définissez un code PIN dès maintenant.' },
  };

  return { grade, ...GRADE_META[grade] };
}

// ─── PIN : vérification avec verrouillage anti-bruteforce ───────────────────
async function checkPin(profile, attempt) {
  if (profile.pin.lockedUntil && profile.pin.lockedUntil > new Date()) {
    const remaining = Math.ceil((profile.pin.lockedUntil.getTime() - Date.now()) / 60000);
    return { ok: false, locked: true, remainingMinutes: remaining };
  }

  const valid = verifySecret(attempt, profile.pin.hash, profile.pin.salt);
  if (valid) {
    profile.pin.failedAttempts = 0;
    profile.pin.lockedUntil = null;
    await profile.save();
    return { ok: true };
  }

  profile.pin.failedAttempts = (profile.pin.failedAttempts || 0) + 1;
  await addLog(profile, 'pin_failed');
  if (profile.pin.failedAttempts >= PIN_LOCK_THRESHOLD) {
    profile.pin.lockedUntil = new Date(Date.now() + PIN_LOCK_DURATION_MS);
    profile.pin.failedAttempts = 0;
    await addLog(profile, 'pin_locked');
  } else {
    await profile.save();
  }
  return { ok: false, locked: false };
}

module.exports = {
  encrypt,
  decrypt,
  hashSecret,
  verifySecret,
  isPinWeak,
  getOrCreateProfile,
  addLog,
  formatLog,
  computeGrade,
  checkPin,
  MAX_PASSKEYS,
  FORGOT_DELAY_MS,
};
