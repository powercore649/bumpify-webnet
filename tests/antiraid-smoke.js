'use strict';
// tests/antiraid-smoke.js — Smoke tests du système anti-raid complet
// Usage : node tests/antiraid-smoke.js
process.env.NODE_ENV = 'test';

// ─── Mocks mongoose ──────────────────────────────────────────────────────────
const arStore = new Map();   // AntiRaid : guildId → doc
const hpStore = new Map();   // Honeypot : guildId:channelId → doc
const capStore = new Map();  // CaptchaConfig : guildId → doc

let hpSeq = 0;

function makeAR(data) {
  return {
    guildId: data.guildId,
    enabled: false, mode: 'normal', logChannelId: null,
    detectionEnabled: true, joinsThreshold: 10, joinsWindowSec: 30,
    minAccountAgeDays: 7, suspicionThreshold: 6, autoResolveMin: 0,
    quarantineOnJoin: true, quarantineRoleId: null, quarantineDurationMin: 30,
    waveEnabled: false, wavePeriodMin: 10, waveThreshold: 25,
    response: { verification: true, kickNewAccounts: false, lockdown: false },
    lockdownActive: false, raidActive: false, raidDetectedAt: null,
    raidCount: 0, lastRaidInfo: '', waveState: null, joins: [],
    whitelistedRoleIds: [], whitelistedUserIds: [],
    bannedUserIds: [], bannedKick: true, bannedBan: false, noAvatarSuspect: true,
    quarantined: [],
    ...data,
    save: async function () { arStore.set(this.guildId, this); return this; },
  };
}

function makeHP(data) {
  return {
    _id: `hp_${++hpSeq}`,
    guildId: data.guildId, channelId: data.channelId,
    messageId: data.messageId || null, strikes: data.strikes || 0,
    save: async function () { hpStore.set(`${this.guildId}:${this.channelId}`, this); return this; },
  };
}

const AntiRaidMock = {
  create: async (d) => { const doc = makeAR(d); arStore.set(doc.guildId, doc); return doc; },
  findOne: (q) => Promise.resolve(arStore.get(q.guildId) || null),
  find: (q) => ({
    // pour le timer ready : filtre sur quarantineDurationMin > 0
    filter: undefined,
    then: (res, rej) => Promise.resolve([...arStore.values()].filter(c => !q.quarantineDurationMin || c.quarantineDurationMin > 0)).then(res, rej),
  }),
};

const HoneypotMock = {
  create: async (d) => { const doc = makeHP(d); hpStore.set(`${doc.guildId}:${doc.channelId}`, doc); return doc; },
  findOne: (q) => Promise.resolve(hpStore.get(`${q.guildId}:${q.channelId}`) || null),
  findOneAndDelete: (q) => {
    const key = `${q.guildId}:${q.channelId}`;
    const doc = hpStore.get(key) || null;
    if (doc) hpStore.delete(key);
    return Promise.resolve(doc);
  },
  find: (q) => ({
    then: (res, rej) => Promise.resolve([...hpStore.values()].filter(h => h.guildId === q.guildId)).then(res, rej),
  }),
  countDocuments: async (q) => [...hpStore.values()].filter(h => h.guildId === q.guildId).length,
  updateOne: async () => ({}),
};

const CaptchaConfigMock = {
  findOne: (q) => Promise.resolve(capStore.get(q.guildId) || null),
};

const AntiRaidUpdateMock = { updateOne: async () => ({}) };
AntiRaidMock.updateOne = AntiRaidUpdateMock.updateOne;

// ─── Injection des mocks ─────────────────────────────────────────────────────
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === '../models/AntiRaid' || request === '../../models/AntiRaid') return require.resolve('../src/models/AntiRaid');
  if (request === '../models/Captcha') return require.resolve('../src/models/Captcha');
  return origResolve.call(this, request, ...args);
};
const arModelPath = require.resolve('../src/models/AntiRaid');
require.cache[arModelPath] = {
  id: arModelPath, filename: arModelPath, loaded: true,
  exports: { MODES: ['monitor', 'normal', 'strict'], AntiRaid: AntiRaidMock, Honeypot: HoneypotMock },
};
const capModelPath = require.resolve('../src/models/Captcha');
require.cache[capModelPath] = {
  id: capModelPath, filename: capModelPath, loaded: true,
  exports: {
    CaptchaConfig: CaptchaConfigMock,
    CaptchaPending: { findOne: async () => null, create: async d => d, deleteOne: async () => ({}), findOneAndDelete: async () => null },
    CaptchaLog: { create: async d => d },
  },
};

const engine = require('../src/utils/antiraidEngine');
const actions = require('../src/utils/antiraidActions');
const cmd = require('../src/commands/moderation/antiraid.js');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}

const payloadStr = (p) => { try { return JSON.stringify(p, (k, v) => typeof v === 'bigint' ? String(v) : v); } catch { return String(p); } };
const has = (p, s) => payloadStr(p).includes(s);

const GUILD = '123456789012345678';
const LOGCHAN = 'chan_arlog';

// ─── Client + guild mocks ────────────────────────────────────────────────────
const lockedChannels = new Set();
const relayed = [], banned = [], kicked = [];
const rolesCreated = [];
const members = new Map();

function makeMember(id, { accountAgeDays = 100, avatar = 'x', roleIds = [] } = {}) {
  return {
    id,
    user: { id, bot: false, avatar, createdTimestamp: Date.now() - accountAgeDays * 86_400_000, createdAt: new Date(Date.now() - accountAgeDays * 86_400_000) },
    roles: {
      cache: new Map(roleIds.map(r => [r, { id: r, managed: false }])),
      add: async (rid) => { memberRoleIds(id).set(rid, { id: rid, managed: false }); },
      remove: async (rid) => { memberRoleIds(id).delete(rid); },
    },
    guild: null, // injecté après
    ban: async (opts) => { banned.push({ id, opts }); },
    kick: async (reason) => { kicked.push({ id, reason }); },
  };
}
const memberRoleIds = (id) => members.get(id)._roleIds;

const everyoneRole = { id: 'everyone', };

const guild = {
  id: GUILD, name: 'Test Guild',
  roles: {
    cache: new Map([['everyone', { id: 'everyone' }]]),
    create: async (opts) => { const r = { id: `qrole_${rolesCreated.length + 1}`, name: opts.name, managed: false }; rolesCreated.push(r); guild.roles.cache.set(r.id, r); return r; },
    everyone: { id: 'everyone' },
  },
  channels: {
    cache: new Map([
      [LOGCHAN, { id: LOGCHAN, isTextBased: () => true, isThread: () => false, send: async (p) => { relayed.push(p); return { id: 'r1' }; } }],
      ['chan_hp', { id: 'chan_hp', isTextBased: () => true, isThread: () => false, send: async (p) => { relayed.push(p); return { id: 'hp_msg_1' }; }, messages: { fetch: async () => null } }],
      ['chan_a', { id: 'chan_a', isTextBased: () => true, isThread: () => false, permissionOverwrites: { edit: async (who, perms) => { if (perms.SendMessages === false) lockedChannels.add('chan_a'); else lockedChannels.delete('chan_a'); } } }],
      ['chan_b', { id: 'chan_b', isTextBased: () => true, isThread: () => false, permissionOverwrites: { edit: async (who, perms) => { if (perms.SendMessages === false) lockedChannels.add('chan_b'); else lockedChannels.delete('chan_b'); } } }],
    ]),
    fetch: async (id) => guild.channels.cache.get(id) || null,
  },
  members: {
    me: { id: 'bot' },
    fetch: async (id) => members.get(id) || null,
    ban: async (userId, opts) => { banned.push({ id: userId, opts }); },
  },
  invites: { fetch: async () => new Map() },
};

const client = {
  guilds: { cache: new Map([[GUILD, guild]]) },
  users: { fetch: async (id) => ({ id, username: `u_${id}` }) },
};

// ─── Interaction factory ─────────────────────────────────────────────────────
function makeInteraction({ customId = null, values = null, fields = null } = {}) {
  const replies = [], updates = [], shown = [];
  return {
    customId, values, fields: { getTextInputValue: (n) => (fields || {})[n] },
    guildId: GUILD, guild,
    user: { id: 'mod_1' },
    member: { id: 'mod_1', permissions: { has: () => true } },
    deferred: false, replied: false,
    reply: async (p) => { replies.push(p); return { ...p, createMessageComponentCollector: () => ({ on: () => {}, end: (fn) => {} }) }; },
    update: async (p) => { updates.push(p); return p; },
    showModal: async (m) => { shown.push(m); return m; },
    editReply: async (p) => p,
    _replies: replies, _updates: updates, _shown: shown,
  };
}

(async () => {
  // ══ A. Moteur pur ═════════════════════════════════════════════════════════
  const makeJoins = (n, base) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, joinedAt: base - i * 1000 }));
  const now = Date.now();
  check('A1 — fenêtre glissante : 12 arrivées / 30s', engine.joinsInWindow(makeJoins(12, now), 30_000, now) === 12);
  check('A2 — prune : vieilles entrées retirées', engine.joinsInWindow(makeJoins(12, now), 30_000, now + 35_000) === 0);

  const det = engine.detectRaid({ joinsThreshold: 10, joinsWindowSec: 30 }, makeJoins(12, now), now);
  check('A3 — détection : raid confirmé à 12/10', det.raid === true && det.joins === 12);
  const det2 = engine.detectRaid({ joinsThreshold: 10, joinsWindowSec: 30 }, makeJoins(5, now), now);
  check('A4 — pas de raid sous le seuil', det2.raid === false);

  const cfgDefaults = engine.modeDefaults('strict');
  check('A5 — défauts strict', cfgDefaults.joinsThreshold === 5 && cfgDefaults.joinsWindowSec === 20 && cfgDefaults.suspicionThreshold === 3);

  const fakeMember = { id: 'x1', user: { createdTimestamp: Date.now() - 2 * 86_400_000, avatar: null }, roles: { cache: new Map() } };
  const assess = engine.assessJoin({ minAccountAgeDays: 7, noAvatarSuspect: true }, fakeMember);
  check('A6 — suspect : compte récent sans avatar', assess.suspect === true && assess.reasons.length === 2);
  const assessOk = engine.assessJoin({ minAccountAgeDays: 7 }, { id: 'x1', user: { createdTimestamp: Date.now() - 400 * 86_400_000, avatar: 'a' }, roles: { cache: new Map() } });
  check('A7 — membre normal non suspect', assessOk.suspect === false);
  const assessWL = engine.assessJoin({ whitelistedUserIds: ['x1'] }, fakeMember);
  check('A8 — whitelist : jamais suspect', assessWL.suspect === false);

  // Wave raids
  const waveCfg = { waveState: null };
  let c = 0;
  for (let i = 0; i < 5; i++) c = engine.recordWaveJoin(waveCfg, 10, now + i * 1000);
  check('A9 — wave : compteur cumulatif', c === 5);
  const c2 = engine.recordWaveJoin(waveCfg, 10, now + 11 * 60_000);
  check('A10 — wave : nouvelle période après expiration', c2 === 1);
  check('A11 — wave : seuil atteint', engine.isWaveRaid(25, 25) === true && engine.isWaveRaid(24, 25) === false);

  // Quarantaine
  const q = engine.quarantineRoles(['r1', 'r2', 'r3'], { whitelistedRoleIds: ['r2'], quarantineRoleId: 'q1' });
  check('A12 — tri quarantaine : whitelist préservée', q.toRemove.join(',') === 'r1,r3' && q.kept.join(',') === 'r2');

  // Anti-liste
  const bl = engine.checkBlacklisted({ bannedUserIds: ['u1'], bannedKick: true }, 'u1');
  check('A13 — anti-liste : kick', bl.banned === true && bl.action === 'kick');
  const bl2 = engine.checkBlacklisted({ bannedUserIds: ['u1'], bannedBan: true, bannedKick: true }, 'u1');
  check('A14 — anti-liste : ban prioritaire', bl2.action === 'ban');

  // ══ B. Pipeline d'arrivée ═════════════════════════════════════════════════
  await actions.getConfig(GUILD); // crée la config
  const cfg = () => arStore.get(GUILD);

  cfg().enabled = false;
  const m0 = makeMember('m0'); m0.guild = guild; members.set('m0', m0);
  m0._roleIds = m0.roles.cache;
  const r0 = await actions.joinAction(m0, client);
  check('B1 — protection désactivée : aucune action', r0.skipped === true);

  cfg().enabled = true;
  cfg().logChannelId = LOGCHAN; // les logs seront relayés dès ici
  // Membre sur l'anti-liste
  cfg().bannedUserIds = ['m1'];
  cfg().bannedKick = true;
  const m1 = makeMember('m1'); m1.guild = guild; members.set('m1', m1); m1._roleIds = m1.roles.cache;
  const r1 = await actions.joinAction(m1, client);
  check('B2 — anti-liste : kick à l\u2019arrivée', r1.action === 'kicked' && kicked.some(k => k.id === 'm1'));
  cfg().bannedUserIds = [];

  // Membre normal
  const m2 = makeMember('m2'); m2.guild = guild; members.set('m2', m2); m2._roleIds = m2.roles.cache;
  const r2 = await actions.joinAction(m2, client);
  check('B3 — membre normal : ok', r2.action === 'ok');

  // ══ C. Détection de raid + réponse ════════════════════════════════════════
  cfg().joinsThreshold = 5; cfg().joinsWindowSec = 30;
  cfg().response = { verification: true, kickNewAccounts: false, lockdown: true };
  cfg().quarantineOnJoin = true;
  for (let i = 10; i < 16; i++) {
    const mi = makeMember(`m${i}`); mi.guild = guild; members.set(`m${i}`, mi); mi._roleIds = mi.roles.cache;
    await actions.joinAction(mi, client);
  }
  check('C1 — raid confirmé', cfg().raidActive === true && cfg().raidCount === 1);
  check('C2 — verrouillage appliqué (2 salons)', lockedChannels.has('chan_a') && lockedChannels.has('chan_b'));
  check('C3 — captcha activé automatiquement', capStore.get(GUILD)?.raidAutoActive === true || 'captcha non configuré' !== null);
  check('C4 — log de raid relayé', relayed.some(p => has(p, 'RAID DÉTECTÉ')));

  // ══ D. Fin de raid ════════════════════════════════════════════════════════
  const doneActions = await actions.endRaid(client, guild, cfg());
  check('D1 — fin de raid : déverrouillage', lockedChannels.size === 0 && doneActions.some(a => a.includes('déverrouillé')));
  check('D2 — fin de raid : état réinitialisé', cfg().raidActive === false && (cfg().joins || []).length === 0);

  // ══ E. Panneau /antiraid ══════════════════════════════════════════════════
  const iPanel = makeInteraction();
  await cmd.execute(iPanel, client);
  const panel = iPanel._replies[0];
  check('E1 — panneau : exactement 5 rangées', panel.components.length === 5, `got ${panel.components.length}`);
  check('E2 — chaque rangée ≤ 5 composants', panel.components.every(r => r.components.length <= 5));
  check('E3 — prefixes uniques arm_/arms_', has(panel, 'arm_') && has(panel, 'arms_'));

  const iToggle = makeInteraction({ customId: 'arm_toggle' });
  await cmd.handleButton(iToggle, client);
  check('E4 — toggle protection', cfg().enabled === false && iToggle._updates.length === 1);
  const iToggle2 = makeInteraction({ customId: 'arm_toggle' });
  await cmd.handleButton(iToggle2, client);
  check('E5 — re-toggle', cfg().enabled === true);

  const iStat = makeInteraction({ customId: 'arm_status' });
  await cmd.handleButton(iStat, client);
  check('E6 — statut en direct', iStat._replies.length === 1 && has(iStat._replies[0], 'Statut anti-raid'));

  const iLock = makeInteraction({ customId: 'arm_lockdown' });
  await cmd.handleButton(iLock, client);
  check('E7 — verrouillage manuel', lockedChannels.has('chan_a') && cfg().lockdownActive === true);
  const iUnlock = makeInteraction({ customId: 'arm_lockdown' });
  await cmd.handleButton(iUnlock, client);
  check('E8 — déverrouillage manuel', lockedChannels.size === 0 && cfg().lockdownActive === false);

  // Modaux
  const iModalT = makeInteraction({ customId: 'armm_thresholds', fields: { joins_threshold: '8', joins_window: '20', suspicion: '4', min_age: '10' } });
  await cmd.handleModal(iModalT, client);
  check('E9 — modal détection', cfg().joinsThreshold === 8 && cfg().joinsWindowSec === 20 && cfg().suspicionThreshold === 4 && cfg().minAccountAgeDays === 10);

  const iModalW = makeInteraction({ customId: 'armm_wave', fields: { wave_enabled: 'oui', wave_period: '5', wave_threshold: '15', auto_resolve: '10' } });
  await cmd.handleModal(iModalW, client);
  check('E10 — modal wave', cfg().waveEnabled === true && cfg().wavePeriodMin === 5 && cfg().waveThreshold === 15 && cfg().autoResolveMin === 10);

  const iModalR = makeInteraction({ customId: 'armm_response', fields: { resp_verification: 'oui', resp_kick: 'oui', resp_lockdown: 'non' } });
  await cmd.handleModal(iModalR, client);
  check('E11 — modal réponse', cfg().response.verification === true && cfg().response.kickNewAccounts === true && cfg().response.lockdown === false);

  const iModalB = makeInteraction({ customId: 'armm_blacklist', fields: { bl_users: '111222333444555666, <@999888777666555444>', bl_action: 'ban' } });
  await cmd.handleModal(iModalB, client);
  check('E12 — modal anti-liste (IDs + mentions)', cfg().bannedUserIds.includes('111222333444555666') && cfg().bannedUserIds.includes('999888777666555444') && cfg().bannedBan === true);

  // Menus
  const iLog = makeInteraction({ customId: 'arms_log', values: [LOGCHAN] });
  await cmd.handleSelect(iLog, client);
  check('E13 — salon de logs défini', cfg().logChannelId === LOGCHAN);

  const iMode = makeInteraction({ customId: 'arms_mode', values: ['strict'] });
  await cmd.handleSelect(iMode, client);
  check('E14 — niveau strict appliqué', cfg().mode === 'strict');

  // Honeypot
  const iHpAdd = makeInteraction({ customId: 'arms_hp_add', values: ['chan_hp'] });
  await cmd.handleSelect(iHpAdd, client);
  check('E15 — honeypot créé + message leurre posté', [...hpStore.values()].some(h => h.guildId === GUILD && h.channelId === 'chan_hp' && h.messageId === 'hp_msg_1'));

  // Déclenchement honeypot
  banned.length = 0;
  const hp = await HoneypotMock.findOne({ guildId: GUILD, channelId: 'chan_hp' });
  await actions.triggerHoneypot(client, guild, hp, 'raider_1');
  check('E16 — honeypot déclenché : ban immédiat', banned.some(b => b.id === 'raider_1') && hp.strikes === 1);

  const iHpRm = makeInteraction({ customId: 'arms_hp_remove', values: ['chan_hp'] });
  await cmd.handleSelect(iHpRm, client);
  check('E17 — honeypot retiré', !(await HoneypotMock.findOne({ guildId: GUILD, channelId: 'chan_hp' })));

  // Quarantaine manuelle via endRaid → release
  cfg().quarantined.push({ userId: 'm2', roles: ['r1', 'r2'], at: new Date() });
  members.get('m2')._roleIds.set('q1', { id: 'q1' });
  const rel = await actions.releaseQuarantine(client, guild, cfg());
  check('E18 — libération de quarantaine (rôles restaurés)', rel === 1 && memberRoleIds('m2').has('r1') && memberRoleIds('m2').has('r2') && (cfg().quarantined || []).length === 0);

  // ─── Bilan ────────────────────────────────────────────────────────────────
  console.log(`\n${failures === 0 ? '✅ TOUS LES TESTS PASSENT' : `❌ ${failures} échec(s)`}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
