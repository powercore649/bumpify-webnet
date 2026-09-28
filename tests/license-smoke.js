// tests/license-smoke.js — Smoke tests du système de licence
// Usage : node tests/license-smoke.js
process.env.NODE_ENV = 'test';
process.env.OWNER_IDS = '111111111111111111,222222222222222222';

// ─── Mock mongoose : modèle License en Map (sans serveur Mongo) ───────────────
const docs = new Map(); // clé → document
let seq = 0;

function makeDoc(data) {
  return {
    _id: `id_${++seq}`,
    ...data,
    save: async function () { docs.set(this.key, { ...this }); return this; },
  };
}

// Mock façon mongoose : findOne/find renvoient un objet Query-like (.lean() synchronement)
const LicenseModel = {
  create: async (data) => { const d = makeDoc(data); docs.set(d.key, d); return d; },
  findOne: (q) => {
    const hit = () => (q.key ? docs.get(q.key) : [...docs.values()].find(x => x.guildId === q.guildId)) || null;
    // Thenable façon mongoose : await Model.findOne(q) → Document (.save()),
    // et Model.findOne(q).lean() → doc plain.
    const p = Promise.resolve(hit()).then(d => d
      ? { ...d, save: async function () { docs.set(this.key, { ...this }); return this; } }
      : null);
    p.lean = async () => hit();
    return p;
  },
  findOneAndUpdate: async (q, upd) => {
    const d = [...docs.values()].find(x => x.guildId === q.guildId);
    if (!d) return null;
    Object.assign(d, upd.$set || {});
    return d;
  },
  updateMany: async (q, upd) => {
    let n = 0;
    for (const d of docs.values()) {
      if (d.guildId === q.guildId && d._id !== q._id.$ne) { Object.assign(d, upd.$set || {}); n++; }
    }
    return { modifiedCount: n };
  },
  updateOne: async (q, upd) => {
    const d = [...docs.values()].find(x => x.guildId === q.guildId);
    if (d) Object.assign(d, upd.$set || {});
    return { modifiedCount: d ? 1 : 0 };
  },
  find: (q = {}) => {
    const run = () => [...docs.values()]
      .filter(d => (q.guildId === undefined || (q.guildId && q.guildId.$ne !== null ? d.guildId !== null && d.guildId !== q.guildId.$ne : d.guildId === null))
        && (q.revoked === undefined || d.revoked === q.revoked));
    const qy = {
      lean: async () => run(),
      sort: () => qy,
      limit: () => qy,
    };
    return qy;
  },
  deleteOne: async () => ({}),
};

// Injection du mock AVANT le require de licenseGate : on remplace le module
// src/models/License dans le cache de require (technique standard, fiable).
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === '../models/License') {
    return require.resolve('../src/models/License');
  }
  return origResolve.call(this, request, ...args);
};
const licPath = require.resolve('../src/models/License');
require.cache[licPath] = { id: licPath, filename: licPath, loaded: true, exports: LicenseModel };

const licenseGate = require('../src/utils/licenseGate');
check('mock injecté dans licenseGate', typeof licenseGate.createLicense === 'function');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}

(async () => {
  // ─── 1. Génération de clés ────────────────────────────────────────────────────
  const l1 = await licenseGate.createLicense('111111111111111111');
  check('clé générée au bon format', /^BUMP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(l1.key), l1.key);
  check('clé sans caractères ambigus', !/[ILO01]/.test(l1.key.slice(5)), l1.key);
  check('clé illimitée par défaut', l1.expiresAt === null);

  const l2 = await licenseGate.createLicense('111111111111111111', { jours: 30, note: 'client test' });
  check('durée 30 jours appliquée', l2.expiresAt && l2.expiresAt.getTime() > Date.now() + 29 * 86_400_000);

  // ─── 2. Vérifications d'accès ─────────────────────────────────────────────────
  const guildA = '999888777666555444';
  const guildB = '123456789012345678';

  let a = await licenseGate.checkAccess(guildA, 'bump');
  check('bump verrouillé sans licence', a.ok === false && a.reason === 'none');

  a = await licenseGate.checkAccess(guildA, 'ban');
  check('ban (hors liste) toujours accessible', a.ok === true && a.reason === 'not_required');

  a = await licenseGate.checkAccess(guildB, 'interserveur');
  check('interserveur verrouillé sans licence', a.ok === false && a.reason === 'none');

  check('isLicenseRequired bump', licenseGate.isLicenseRequired('bump') === true);
  check('isLicenseRequired BUMP (casse)', licenseGate.isLicenseRequired('BUMP') === true);
  check('isLicenseRequired ping', licenseGate.isLicenseRequired('ping') === false);

  // ─── 3. Activation ────────────────────────────────────────────────────────────
  let res = await licenseGate.activateLicense(l1.key, guildA, 'Serveur A', '333333333333333333');
  check('activation réussie', res.ok === true && res.license.guildId === guildA);

  a = await licenseGate.checkAccess(guildA, 'bump');
  check('bump déverrouillé après activation', a.ok === true && a.reason === 'licensed');

  // Mauvaise clé
  res = await licenseGate.activateLicense('BUMP-ZZZZ-ZZZZ-ZZZZ-ZZZZ', guildB, 'B', '333');
  check('clé inexistante refusée', res.ok === false && res.reason === 'not_found');

  // Minuscules/espaces normalisés
  res = await licenseGate.activateLicense(`  ${l2.key.toLowerCase()}  `, guildB, 'Serveur B', '333');
  check('clé insensible casse + trim', res.ok === true);

  // Une clé = un serveur : l1 (liée à guildA) refuse guildB
  const l3 = await licenseGate.createLicense('222222222222222222');
  res = await licenseGate.activateLicense(l1.key, guildB, 'Serveur B', '333');
  check('clé déjà utilisée ailleurs refusée', res.ok === false && res.reason === 'used_elsewhere', JSON.stringify(res.reason));

  // Un serveur = une licence : activer une 2e clé remplace la 1re
  const l4 = await licenseGate.createLicense('222222222222222222');
  const l5 = await licenseGate.createLicense('222222222222222222');
  await licenseGate.activateLicense(l4.key, guildB, 'B', '333');
  res = await licenseGate.activateLicense(l5.key, guildB, 'B', '333');
  check('nouvelle activation remplace l\'ancienne (1/serveur)', res.ok === true);
  const rel4 = await LicenseModel.findOne({ key: l4.key }).lean();
  check('ancienne clé déliée (réutilisable)', rel4.guildId === null);

  // ─── 4. Révocation ────────────────────────────────────────────────────────────
  res = await licenseGate.revokeLicense(l5.key, '111111111111111111', 'test révo');
  check('révocation réussie', res.ok === true && res.license.revoked === true);

  a = await licenseGate.checkAccess(guildB, 'territoires');
  check('features reverrouillées après révocation', a.ok === false && a.reason === 'revoked');

  // ─── 5. Expiration ────────────────────────────────────────────────────────────
  const l6 = await licenseGate.createLicense('111111111111111111');
  docs.get(l6.key).expiresAt = new Date(Date.now() - 1000); // déjà expirée
  res = await licenseGate.activateLicense(l6.key, guildB, 'B', '333');
  check('clé expirée refusée à l\'activation', res.ok === false && res.reason === 'expired');

  // ─── 6. Délier ────────────────────────────────────────────────────────────────
  await licenseGate.unlinkGuild(guildA);
  a = await licenseGate.checkAccess(guildA, 'network');
  check('features reverrouillées après déliaison', a.ok === false && a.reason === 'none');
  const rel1 = await LicenseModel.findOne({ key: l1.key }).lean();
  check('clé déliée reste non révoquée', rel1 && !rel1.revoked && rel1.guildId === null, JSON.stringify(rel1));

  // ─── 7. isOwner ───────────────────────────────────────────────────────────────
  check('isOwner accepte OWNER_IDS', licenseGate.isOwner('111111111111111111') === true);
  check('isOwner refuse inconnu', licenseGate.isOwner('999999') === false);

  console.log(failures === 0 ? '\n🎉 Tous les tests licence passent.' : `\n💥 ${failures} test(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { console.error('💥', err); process.exit(1); });
