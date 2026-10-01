'use strict';
// tests/captcha-smoke.js — Smoke tests du captcha refondu (100% fonctionnel)
// Usage : node tests/captcha-smoke.js
process.env.NODE_ENV = 'test';

// ─── Mocks mongoose (models/Captcha) ─────────────────────────────────────────
const cfgStore = new Map();     // CaptchaConfig : guildId → doc
const pendingStore = new Map(); // CaptchaPending : userId → doc
const logStore = [];

function makeCfg(data) {
  return {
    guildId: data.guildId,
    enabled: false, channelId: null, logChannelId: null,
    roleBefore: null, roleAfter: null, bypassRoleId: null,
    security: 'mixed', codeLength: 6, attempts: 3, kickOnFail: true,
    timeout: 10, imageMode: true, caseSensitive: false, maxRegenerations: 2,
    minAccountAgeDays: 0, dmOnKick: false,
    imageDistortionLevel: 'normal', activeOnRaid: true, raidAutoActive: false,
    ...data,
    save: async function () { cfgStore.set(this.guildId, this); return this; },
  };
}

function makePending(data) {
  const doc = {
    _id: `p_${pendingStore.size + 1}`,
    userId: data.userId, guildId: data.guildId, code: data.code,
    attempts: 0, regenerations: 0, expiresAt: data.expiresAt,
    messageId: data.messageId || null, channelId: data.channelId || null,
    save: async function () { pendingStore.set(this.userId, this); return this; },
  };
  return doc;
}

const CaptchaConfigMock = {
  create: async (d) => { const doc = makeCfg(d); cfgStore.set(doc.guildId, doc); return doc; },
  findOne: (q) => Promise.resolve(cfgStore.get(q.guildId) || null),
};
const CaptchaPendingMock = {
  create: async (d) => { const doc = makePending(d); pendingStore.set(doc.userId, doc); return doc; },
  findOne: (q) => Promise.resolve(pendingStore.get(q.userId) || null),
  findOneAndDelete: (q) => {
    const doc = pendingStore.get(q.userId) || null;
    if (doc) pendingStore.delete(q.userId);
    return Promise.resolve(doc);
  },
  deleteOne: (q) => {
    // q peut contenir userId OU _id (usage réel du code)
    for (const [uid, doc] of pendingStore) {
      if ((q.userId && uid === q.userId) || (q._id && String(doc._id) === String(q._id))) {
        pendingStore.delete(uid);
        return Promise.resolve({ deletedCount: 1 });
      }
    }
    return Promise.resolve({ deletedCount: 0 });
  },
};
const CaptchaLogMock = { create: async (d) => { logStore.push({ date: new Date(), ...d }); return d; } };

// ─── Mock captchaImage (canvas natif indisponible en local) ──────────────────
let renderCalls = 0, lastRenderLevel = null;
const captchaImageMock = {
  renderCaptchaImage: (text, opts = {}) => {
    renderCalls++;
    lastRenderLevel = opts.level || 'normal';
    return Buffer.from(`PNGFAKE:${text}`);
  },
  WIDTH: 320, HEIGHT: 130,
};

// ─── Injection des mocks ─────────────────────────────────────────────────────
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === '../../models/Captcha' || request === '../models/Captcha') return require.resolve('../src/models/Captcha');
  if (request === '../../utils/captchaImage' || request === '../utils/captchaImage') return require.resolve('../src/utils/captchaImage');
  return origResolve.call(this, request, ...args);
};
const capModelPath = require.resolve('../src/models/Captcha');
require.cache[capModelPath] = {
  id: capModelPath, filename: capModelPath, loaded: true,
  exports: { CaptchaConfig: CaptchaConfigMock, CaptchaPending: CaptchaPendingMock, CaptchaLog: CaptchaLogMock },
};
const imgPath = require.resolve('../src/utils/captchaImage');
require.cache[imgPath] = { id: imgPath, filename: imgPath, loaded: true, exports: captchaImageMock };

const cmd = require('../src/commands/configuration/captcha.js');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}

const payloadStr = (p) => { try { return JSON.stringify(p, (k, v) => typeof v === 'bigint' ? String(v) : v); } catch { return String(p); } };
const has = (p, s) => payloadStr(p).includes(s);

const GUILD = '123456789012345678';
const CHAN = 'chan_captcha';
const LOGCHAN = 'chan_caplog';

// ─── Mocks Discord ───────────────────────────────────────────────────────────
const chanMessages = new Map();
let msgSeq = 0;
const sentPayloads = [], deletedMsgs = [], dmsSent = [];

const captchaChannel = {
  id: CHAN, name: 'captcha', isTextBased: () => true,
  permissionsFor: () => ({ has: () => true }),
  send: async (p) => {
    sentPayloads.push(p);
    const m = { id: `cap_msg_${++msgSeq}`, delete: async () => { deletedMsgs.push(m.id); } };
    chanMessages.set(m.id, m);
    return m;
  },
  messages: { fetch: async (id) => chanMessages.get(id) || null, delete: async (id) => { deletedMsgs.push(id); } },
};

const guild = {
  id: GUILD, name: 'Test Guild', members: { me: { id: 'bot' } },
  channels: { cache: new Map([[CHAN, captchaChannel], [LOGCHAN, { id: LOGCHAN, isTextBased: () => true, send: async (p) => logPayloads.push(p) }]]), fetch: async (id) => (id === CHAN ? captchaChannel : null) },
};
const logPayloads = [];

const client = {
  guilds: { cache: new Map([[GUILD, guild]]) },
  users: { fetch: async (id) => ({ id, username: `user_${id}`, send: async (p) => dmsSent.push({ uid: id, p }) }) },
};

function makeMember(id, { accountAgeDays = 365, roleIds = [], avatar = 'x' } = {}) {
  const roleCache = new Map(roleIds.map(r => [r, { id: r, managed: false }]));
  roleCache.map = (fn) => [...roleCache.values()].map(fn); // simule discord.js Collection (itére sur les valeurs)
  return {
    id,
    user: { id, bot: false, username: `user_${id}`, tag: `user_${id}#0001`, avatar, createdAt: new Date(Date.now() - accountAgeDays * 86_400_000), createdTimestamp: Date.now() - accountAgeDays * 86_400_000, displayAvatarURL: () => 'http://a' },
    roles: {
      cache: roleCache,
      add: async (rid) => { roleCache.set(rid, { id: rid }); },
      remove: async (rid) => { roleCache.delete(rid); },
    },
    guild,
    kick: async (reason) => { kicked.push({ id, reason }); },
  };
}
const kicked = [];

// ─── Interaction factory ─────────────────────────────────────────────────────
function makeInteraction({ customId = null, values = null, fields = null, userId = '111' } = {}) {
  const replies = [], updates = [], shown = [];
  return {
    customId, values,
    fields: { getTextInputValue: (n) => (fields || {})[n] },
    guildId: GUILD, guild, client,
    user: { id: userId, username: `user_${userId}`, send: async (p) => dmsSent.push({ uid: userId, p }), displayAvatarURL: () => 'http://a' },
    member: makeMember(userId),
    deferred: false, replied: false,
    reply: async (p) => { replies.push(p); return { ...p, delete: async () => {}, createMessageComponentCollector: () => ({ on: () => {} }) }; },
    update: async (p) => { updates.push(p); return p; },
    showModal: async (m) => { shown.push(m); return m; },
    editReply: async (p) => p,
    _replies: replies, _updates: updates, _shown: shown,
  };
}

(async () => {
  // ══ A. Panneau de configuration ═══════════════════════════════════════════
  await CaptchaConfigMock.create({ guildId: GUILD });
  const cfg = () => cfgStore.get(GUILD);

  // Capture le collecteur interne du panneau pour tester toggles/menus/modaux
  const collectorHandlers = {};
  const iPanel = makeInteraction();
  iPanel._replyResult = null;
  iPanel.reply = async (p) => {
    iPanel._replies.push(p);
    return { createMessageComponentCollector: () => ({ on: (e, fn) => { collectorHandlers[e] = fn; } }) };
  };
  await cmd.execute(iPanel);
  const panel = iPanel._replies[0];
  check('A1 — panneau : 4 rangées (≤ 5), aucune > 5 composants', panel.components.length === 4 && panel.components.every(r => r.components.length <= 5), `rows=${panel.components.length}`);
  check('A2 — panneau en un seul écran', !has(panel, 'captcha_back') && has(panel, 'captcha_toggle_raid'));

  const iToggle = makeInteraction({ customId: 'captcha_toggle' });
  await collectorHandlers.collect(iToggle);
  check('A3 — toggle activation (collecteur interne)', cfg().enabled === true && iToggle._updates.length === 1);

  const iRaid = makeInteraction({ customId: 'captcha_toggle_raid' });
  await collectorHandlers.collect(iRaid);
  check('A4 — toggle auto-sur-raid', cfg().activeOnRaid === false);

  const iDist = makeInteraction({ customId: 'captcha_distortion_select', values: ['extreme'] });
  await collectorHandlers.collect(iDist);
  check('A5 — niveau anti-OCR sélectionné', cfg().imageDistortionLevel === 'extreme');

  // Retour aux défauts pour la suite
  const iRaid2 = makeInteraction({ customId: 'captcha_toggle_raid' });
  await collectorHandlers.collect(iRaid2);
  const iDist2 = makeInteraction({ customId: 'captcha_distortion_select', values: ['normal'] });
  await collectorHandlers.collect(iDist2);
  check('A6 — retoggles', cfg().activeOnRaid === true && cfg().imageDistortionLevel === 'normal');

  // ══ B. Flux membre : envoi du captcha ═════════════════════════════════════
  cfg().enabled = true; cfg().channelId = CHAN; cfg().logChannelId = LOGCHAN;
  const member = makeMember('111');
  await cmd.sendCaptcha(member, cfg(), client);
  check('B1 — captcha envoyé (message posté)', sentPayloads.length >= 1 && has(sentPayloads[0], 'captcha_answer_111'));
  check('B2 — pending créé en base', pendingStore.has('111'));
  check('B3 — log "sent" enregistré', logStore.some(l => l.action === 'sent'));
  check('B4 — code jamais en clair dans le message (mode image)', !has(sentPayloads[0], 'Entrez exactement'));

  // ══ C. Bypass & âge minimum ═══════════════════════════════════════════════
  const memberBypass = makeMember('222', { roleIds: ['bypass_r'] });
  cfg().bypassRoleId = 'bypass_r';
  cfg().roleAfter = 'verified_r';
  const sentBefore = sentPayloads.length;
  await cmd.sendCaptcha(memberBypass, cfg(), client);
  check('C1 — bypass : aucun captcha envoyé', sentPayloads.length === sentBefore);
  check('C2 — bypass : rôle after attribué directement', memberBypass.roles.cache.has('verified_r'));
  cfg().bypassRoleId = null; cfg().roleAfter = null;

  cfg().minAccountAgeDays = 30;
  const memberYoung = makeMember('333', { accountAgeDays: 2 });
  await cmd.sendCaptcha(memberYoung, cfg(), client);
  check('C3 — compte trop récent : kick', kicked.some(k => k.id === '333'));
  cfg().minAccountAgeDays = 0;

  // ══ D. Réponse au captcha ═════════════════════════════════════════════════
  // Rejoue un captcha pour 111 et récupère le code réel depuis le store
  await cmd.sendCaptcha(member, cfg(), client);
  const pending = pendingStore.get('111');
  check('D1 — pending disponible pour le test', !!pending?.code);

  // Modal ouvert par le bon utilisateur
  const iAns = makeInteraction({ customId: 'captcha_answer_111' });
  await cmd.verifyCaptcha(iAns);
  check('D2 — bouton Répondre → modal', iAns._shown.length === 1 && has(iAns._shown[0], 'captcha_submit_111'));

  // Mauvais utilisateur refusé
  const iAnsWrong = makeInteraction({ customId: 'captcha_answer_111', userId: '999' });
  await cmd.verifyCaptcha(iAnsWrong);
  check('D3 — captcha destiné à un autre : refusé', has(iAnsWrong._replies[0], 'ne vous est pas destiné'));

  // Réponse correcte
  const iOK = makeInteraction({ customId: `captcha_submit_111`, fields: { captcha_input: pending.code }, userId: '111' });
  await cmd.handleCaptchaSubmit(iOK);
  check('D4 — bonne réponse : pending supprimé', !pendingStore.has('111'));
  check('D5 — bonne réponse : log success', logStore.some(l => l.action === 'success'));

  // Réponse incorrecte puis épuisement
  await cmd.sendCaptcha(member, cfg(), client);
  const p2 = pendingStore.get('111');
  cfg().attempts = 2; cfg().kickOnFail = false;
  const iBad1 = makeInteraction({ customId: 'captcha_submit_111', fields: { captcha_input: 'WRONG' }, userId: '111' });
  await cmd.handleCaptchaSubmit(iBad1);
  check('D6 — mauvaise réponse : tentative comptée, reste 1', p2.attempts === 1 && has(iBad1._replies[0], 'tentative'));
  const iBad2 = makeInteraction({ customId: 'captcha_submit_111', fields: { captcha_input: 'WRONG' }, userId: '111' });
  await cmd.handleCaptchaSubmit(iBad2);
  check('D7 — tentatives épuisées : pending supprimé', !pendingStore.has('111') && p2.attempts === 2);

  // Kick après échec
  cfg().kickOnFail = true;
  await cmd.sendCaptcha(member, cfg(), client);
  const p3 = pendingStore.get('111');
  cfg().attempts = 1;
  const iBad3 = makeInteraction({ customId: 'captcha_submit_111', fields: { captcha_input: 'NOPE' }, userId: '111' });
  await cmd.handleCaptchaSubmit(iBad3);
  await new Promise(r => setTimeout(r, 2300)); // attend le kick différé (2s)
  check('D8 — échec final : kick appliqué', kicked.some(k => k.id === '111'));
  cfg().attempts = 3;

  // ══ E. Régénération ═══════════════════════════════════════════════════════
  await cmd.sendCaptcha(member, cfg(), client);
  const p4 = pendingStore.get('111');
  const codeBefore = p4.code;
  cfg().maxRegenerations = 2;
  const iRegen = makeInteraction({ customId: 'captcha_regen_111', userId: '111' });
  await cmd.handleRegenerate(iRegen);
  check('E1 — régénération : nouveau code différent', pendingStore.get('111').code !== codeBefore && pendingStore.get('111').regenerations === 1);
  check('E2 — régénération : log registered', logStore.some(l => l.action === 'regenerated'));

  pendingStore.get('111').regenerations = 5; // au-delà de la limite
  const iRegen2 = makeInteraction({ customId: 'captcha_regen_111', userId: '111' });
  await cmd.handleRegenerate(iRegen2);
  check('E3 — limite de régénérations atteinte : refusé', has(iRegen2._replies[0], 'limite'));

  // ══ F. Mode texte & niveaux anti-OCR ══════════════════════════════════════
  cfg().imageMode = false;
  const before = sentPayloads.length;
  await cmd.sendCaptcha(makeMember('444'), cfg(), client);
  check('F1 — mode texte : code affiché en clair voulu (repli explicite)', has(sentPayloads[sentPayloads.length - 1], 'Entrez exactement') && sentPayloads.length === before + 1);
  cfg().imageMode = true;

  cfg().imageDistortionLevel = 'extreme';
  renderCalls = 0;
  await cmd.sendCaptcha(makeMember('555'), cfg(), client);
  check('F2 — niveau anti-OCR extrême transmis au moteur d\u2019image', renderCalls === 1 && lastRenderLevel === 'extreme');

  // ══ G. Modaux de configuration ════════════════════════════════════════════
  const iAdv = makeInteraction({ customId: 'captcha_advanced_modal', fields: { captcha_attempts: '5', captcha_timeout: '15', captcha_length: '8', captcha_kick: 'oui' } });
  await cmd.handleAdvancedModal(iAdv);
  check('G1 — modal paramètres appliqué', cfg().attempts === 5 && cfg().timeout === 15 && cfg().codeLength === 8 && cfg().kickOnFail === true);

  const iAb = makeInteraction({ customId: 'captcha_antibot_modal', fields: { captcha_regens: '3', captcha_min_age: '7', captcha_case: 'oui', captcha_dm: 'non' } });
  await cmd.handleAntiBotModal(iAb);
  check('G2 — modal anti-bot appliqué', cfg().maxRegenerations === 3 && cfg().minAccountAgeDays === 7 && cfg().caseSensitive === true && cfg().dmOnKick === false);

  // ─── Bilan ────────────────────────────────────────────────────────────────
  console.log(`\n${failures === 0 ? '✅ TOUS LES TESTS PASSENT' : `❌ ${failures} échec(s)`}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
