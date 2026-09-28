// utils/licenseGate.js — Portail de licence Bumpify.
//
// Une clé de licence (générée par l'owner via /license-admin, activée via
// /license activer) est nécessaire pour accéder aux systèmes phares du bot :
// bump, inter-serveur, territoires, etc. (LICENSE_REQUIRED_COMMANDS).
//
// Une seule licence par serveur : l'activation d'une nouvelle clé remplace
// l'ancienne. Révocation, expiration ou déliaison → les features se
// reverrouillent immédiatement (cache invalidé). Un cache mémoire de 60 s
// évite une requête Mongo par interaction, comme utils/premium.js.
const License = require('../models/License');

// ── Commandes verrouillées par la licence ─────────────────────────────────────
// Noms racines des commandes slash (et de leur équivalent préfixe) qui exigent
// une licence valide. Tout le reste du bot reste accessible gratuitement.
const LICENSE_REQUIRED_COMMANDS = [
  'bump',          // réseau de bump
  'interserveur',  // chat inter-serveur
  'territoires',   // guerre de territoires inter-serveurs
  'network',       // stats du réseau
  'topserveurs',   // classement des serveurs du réseau
];

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans I/L/O/0/1 : clés non ambiguës

function getOwnerIds() {
  return (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
}

function isOwner(userId) {
  return getOwnerIds().includes(userId);
}

// ── Génération de clé — BUMP-XXXX-XXXX-XXXX-XXXX ──────────────────────────────
function generateKey() {
  const block = () => Array.from(
    { length: 4 },
    () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
  ).join('');
  return `BUMP-${block()}-${block()}-${block()}-${block()}`;
}

// Crée une nouvelle clé (régénère en cas de collision, très improbable).
async function createLicense(ownerId, { jours = null, note = '' } = {}) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await License.create({
        key: generateKey(),
        createdBy: ownerId,
        expiresAt: jours ? new Date(Date.now() + jours * 86_400_000) : null,
        note,
      });
    } catch (err) {
      if (err?.code === 11000) continue; // clé dupliquée → on régénère
      throw err;
    }
  }
  throw new Error('Impossible de générer une clé unique après 10 tentatives.');
}

// ── Statut de licence d'un serveur (avec cache 60 s) ──────────────────────────
// { status: 'none' | 'active' | 'expired' | 'revoked', license: doc|null }
const cache = new Map(); // guildId -> { value, checkedAt }
const CACHE_TTL = 60_000;

async function getLicenseStatus(guildId) {
  if (!guildId) return { status: 'none', license: null };

  const cached = cache.get(guildId);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL) return cached.value;

  const doc = await License.findOne({ guildId }).lean();
  let value;
  if (!doc) {
    value = { status: 'none', license: null };
  } else if (doc.revoked) {
    value = { status: 'revoked', license: doc };
  } else if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
    value = { status: 'expired', license: doc };
    // Marque l'expiration en base en tâche de fond (best-effort).
    License.updateOne({ _id: doc._id }, { revoked: true, revokedAt: new Date(), revokedReason: 'Expirée automatiquement' })
      .catch(() => {});
  } else {
    value = { status: 'active', license: doc };
  }

  cache.set(guildId, { value, checkedAt: Date.now() });
  return value;
}

// true si le serveur a une licence valide (active, non expirée, non révoquée).
async function isLicensed(guildId) {
  return (await getLicenseStatus(guildId)).status === 'active';
}

// true si la commande racine est verrouillée par licence.
function isLicenseRequired(commandName) {
  return LICENSE_REQUIRED_COMMANDS.includes(String(commandName || '').toLowerCase());
}

// Vérification complète pour une commande dans un serveur :
// → { ok, reason: 'not_required'|'licensed'|'no_license'|'expired'|'revoked' }
async function checkAccess(guildId, commandName) {
  if (!isLicenseRequired(commandName)) return { ok: true, reason: 'not_required' };
  const { status } = await getLicenseStatus(guildId);
  if (status === 'active') return { ok: true, reason: 'licensed' };
  return { ok: false, reason: status };
}

// ── Activation / gestion ──────────────────────────────────────────────────────
// Active une clé sur un serveur. Une seule licence par serveur : toute licence
// précédemment liée à ce serveur est déliée (guildId remis à null).
async function activateLicense(rawKey, guildId, guildName, activatedBy) {
  const key = String(rawKey || '').trim().toUpperCase();
  const license = await License.findOne({ key });
  if (!license) return { ok: false, reason: 'not_found' };
  if (license.revoked) return { ok: false, reason: 'revoked', license };
  if (license.expiresAt && new Date(license.expiresAt) < new Date()) return { ok: false, reason: 'expired', license };
  if (license.guildId && license.guildId !== guildId) {
    return { ok: false, reason: 'used_elsewhere', license };
  }

  // Délie toute autre licence attachée à CE serveur (1 serveur = 1 licence).
  await License.updateMany(
    { guildId, _id: { $ne: license._id } },
    { $set: { guildId: null, guildName: null, activatedBy: null, activatedAt: null } },
  );

  license.guildId = guildId;
  license.guildName = guildName || null;
  license.activatedBy = activatedBy;
  license.activatedAt = new Date();
  await license.save();

  invalidate(guildId);
  return { ok: true, license };
}

async function revokeLicense(key, revokedBy, reason = '') {
  const license = await License.findOne({ key: String(key).trim().toUpperCase() });
  if (!license) return { ok: false, reason: 'not_found' };
  const affectedGuild = license.guildId;
  license.revoked = true;
  license.revokedAt = new Date();
  license.revokedBy = revokedBy;
  license.revokedReason = reason || 'Révoquée par l\'owner';
  await license.save();
  if (affectedGuild) invalidate(affectedGuild);
  return { ok: true, license, affectedGuild };
}

// Délie la licence d'un serveur sans révoquer la clé (réutilisable ailleurs).
async function unlinkGuild(guildId) {
  const res = await License.updateOne(
    { guildId },
    { $set: { guildId: null, guildName: null, activatedBy: null, activatedAt: null } },
  );
  invalidate(guildId);
  return res;
}

async function listLicenses(filter = {}) {
  return License.find(filter).sort({ createdAt: -1 }).limit(100).lean();
}

function invalidate(guildId) {
  if (guildId) cache.delete(guildId);
}

// Amorce le cache au démarrage (comme blacklist.initCache).
async function initCache() {
  const docs = await License.find({ guildId: { $ne: null }, revoked: false }).lean();
  const now = Date.now();
  for (const doc of docs) {
    const status = doc.expiresAt && new Date(doc.expiresAt) < new Date()
      ? { status: 'expired', license: doc }
      : { status: 'active', license: doc };
    cache.set(doc.guildId, { value: status, checkedAt: now });
  }
  console.log(`✅ Licences chargées : ${docs.length} serveur(s) sous licence`);
}

module.exports = {
  LICENSE_REQUIRED_COMMANDS,
  generateKey,
  createLicense,
  getLicenseStatus,
  isLicensed,
  isLicenseRequired,
  checkAccess,
  activateLicense,
  revokeLicense,
  unlinkGuild,
  listLicenses,
  invalidate,
  initCache,
  getOwnerIds,
  isOwner,
};
