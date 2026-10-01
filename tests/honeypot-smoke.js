'use strict';
// tests/honeypot-smoke.js — Smoke tests du honeypot autonome v3 (panel interactif)
// Usage : node tests/honeypot-smoke.js
process.env.NODE_ENV = 'test';

const fs = require('fs');

// ─── Mocks mongoose ──────────────────────────────────────────────────────────
const cfgStore = new Map();      // Honeypot : guildId → doc
const trigStore = new Map();     // HoneypotTrigger : _id → doc
let trigSeq = 0;
let seq = 0;

function makeCfg(data) {
  return {
    guildId: data.guildId,
    enabled: false, channelIds: [], logChannelId: null,
    action: 'mute', muteDuration: 7 * 24 * 60,
    deleteMessage: true, dmUser: true,
    warningMessage: '⚠️ **Avertissement**\nN\'envoyez pas de messages dans ce salon.',
    triggerLabel: '✅ Confirmer avoir lu',
    totalTriggered: 0,
    ...data,
    save: async function () { cfgStore.set(this.guildId, this); return this; },
  };
}

const HoneypotMock = {
  create: async (d) => { const doc = makeCfg(d); cfgStore.set(doc.guildId, doc); return doc; },
  findOne: (q) => Promise.resolve(cfgStore.get(q.guildId) || null),
  updateOne: async () => ({}),
};

const TrigMock = {
  create: async (d) => { const doc = { _id: `t_${++trigSeq}`, ...d }; trigStore.set(doc._id, doc); return doc; },
  countDocuments: async (q) => {
    let arr = [...trigStore.values()].filter(t => t.guildId === q.guildId);
    if (q.triggeredAt?.$gte) {
      const gte = new Date(q.triggeredAt.$gte).getTime();
      arr = arr.filter(t => new Date(t.triggeredAt).getTime() >= gte);
    }
    return arr.length;
  },
  aggregate: (pipeline) => Promise.resolve().then(() => {
    // Pipeline supporté : [$match guildId, $group action|channelId, ($sort/$limit pour channel)]
    let arr = [...trigStore.values()];
    for (const st of pipeline) {
      if (st.$match) arr = arr.filter(t => Object.entries(st.$match).every(([k, v]) => t[k] === v));
      if (st.$group) {
        const field = Object.values(st.$group)[0].replace('$', '');
        const counts = {};
        arr.forEach(t => { counts[t[field]] = (counts[t[field]] || 0) + 1; });
        arr = Object.entries(counts).map(([k, v]) => ({ _id: k, count: v }));
      }
      if (st.$sort) arr = [...arr].sort((a, b) => b.count - a.count);
      if (st.$limit) arr = arr.slice(0, st.$limit);
    }
    return arr;
  }),
  find: (q) => ({
    sort: () => ({
      limit: () => ({
        lean: async () => [...trigStore.values()].filter(t => t.guildId === q.guildId).slice(0, 10),
      }),
    }),
  }),
  deleteMany: async (q) => { [...trigStore.values()].filter(t => t.guildId === q.guildId).forEach(t => trigStore.delete(t._id)); },
};

// ─── Injection des mocks ─────────────────────────────────────────────────────
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === '../models/Honeypot' || request === '../../models/Honeypot') return require.resolve('../src/models/Honeypot');
  if (request === '../models/HoneypotTrigger' || request === '../../models/HoneypotTrigger') return require.resolve('../src/models/HoneypotTrigger');
  return origResolve.call(this, request, ...args);
};
const hpModelPath = require.resolve('../src/models/Honeypot');
require.cache[hpModelPath] = { id: hpModelPath, filename: hpModelPath, loaded: true, exports: HoneypotMock };
const trigModelPath = require.resolve('../src/models/HoneypotTrigger');
require.cache[trigModelPath] = { id: trigModelPath, filename: trigModelPath, loaded: true, exports: TrigMock };

const cmd = require('../src/commands/moderation/honeypot.js');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}

const payloadStr = (p) => { try { return JSON.stringify(p, (k, v) => typeof v === 'bigint' ? String(v) : v); } catch { return String(p); } };
const has = (p, s) => payloadStr(p).includes(s);

const GUILD = '123456789012345678';

// ─── Mocks Discord ───────────────────────────────────────────────────────────
let collectorHandlers = {};
const sentLogs = [], timedOut = [], kicked = [], banned = [], dms = [], sentWarns = [];

function makeInteraction(overrides = {}) {
  const i = {
    customId: '', values: [],
    user: { id: overrides.userId || 'admin1', tag: 'admin#1', send: async (p) => { dms.push(p); } },
    member: {
      id: overrides.userId || 'admin1',
      permissions: { has: () => true },
      moderatable: true, kickable: true, bannable: true,
      timeout: async (ms, reason) => { timedOut.push({ id: overrides.userId || 'admin1', ms, reason }); },
      kick: async (reason) => { kicked.push({ id: overrides.userId || 'admin1', reason }); },
      ban: async (opts) => { banned.push({ id: overrides.userId || 'admin1', opts }); },
    },
    guild: {
      id: GUILD, name: 'Test Guild',
      iconURL: () => null,
      members: { me: { permissions: { has: (p) => p === 'ManageChannels' || p === 16n } } },
      roles: { everyone: { id: 'everyone' } },
      channels: {
        cache: new Map([
          ['chan_hp1', { id: 'chan_hp1', send: async (p) => { sentWarns.push(p); return { id: 'warn1', pin: async () => {} }; } }],
          ['chan_log', { id: 'chan_log', send: async (p) => { sentLogs.push(p); } }],
        ]),
        create: async (opts) => ({
          id: `chan_new_${++seq}`, ...opts,
          send: async (p) => ({ id: 'warn_new', pin: async () => {} }),
        }),
      },
    },
    channel: { id: 'chan_hp1' },
    fields: null,
    message: null,
    _replies: [], _updates: [], _shown: [], _followUps: [],
    reply: async (p) => { i._replies.push(p); return { createMessageComponentCollector: () => ({ on: (e, fn) => { collectorHandlers[e] = fn; } }) }; },
    update: async (p) => { i._updates.push(p); },
    showModal: async (m) => { i._shown.push(m); },
    followUp: async (p) => { i._followUps.push(p); },
    ...overrides,
  };
  return i;
}

function makeMessage(userId = 'raider1', { admin = false } = {}) {
  const member = {
    id: userId,
    permissions: { has: (p) => admin && (p === 'Administrator' || p === 8n) },
    moderatable: true, kickable: true, bannable: true,
    timeout: async (ms, reason) => { timedOut.push({ id: userId, ms, reason }); },
    kick: async (reason) => { kicked.push({ id: userId, reason }); },
    ban: async (opts) => { banned.push({ id: userId, opts }); },
  };
  return {
    guild: makeInteraction().guild,
    member,
    author: { id: userId, tag: `raid${userId}#0`, send: async (p) => { dms.push(p); } },
    channel: { id: 'chan_hp1' },
    content: 'spam spam spam',
    delete: async () => { deletedMessages.push(userId); },
  };
}
const deletedMessages = [];

// ═════════════════════════════════════════════════════════════════════════════
(async () => {
  collectorHandlers = {};

  // ══ A. Panneau ═══════════════════════════════════════════════════════════
  const iPanel = makeInteraction();
  await cmd.execute(iPanel);
  const panel = iPanel._replies[0];
  check('A1 — panneau : 5 rangées, aucune > 5 composants', panel.components.length === 5 && panel.components.every(r => r.components.length <= 5), `rows=${panel.components.length}`);
  check('A2 — panneau : un seul écran (tous réglages visibles)', has(panel, '_hp_toggle') && has(panel, '_hp_action') && has(panel, '_hp_duration') && has(panel, '_hp_channels_add') && has(panel, '_hp_logs') && has(panel, '_hp_advanced') && has(panel, '_hp_stats') && has(panel, '_hp_refresh'));
  check('A3 — panneau : précise l\'indépendance avec l\'anti-raid', has(panel, 'anti-raid'));

  // ══ B. Toggles & réglages rapides ═════════════════════════════════════════
  const iToggle = makeInteraction({ customId: '_hp_toggle' });
  await cmd.handleButton(iToggle, {});
  check('B1 — toggle sans salon : refusé avec explication', has(iToggle._replies[0], 'Aucun salon configuré'));

  const iAdd = makeInteraction({ customId: '_hp_channels_add', values: ['chan_hp1'] });
  await cmd.handleSelect(iAdd, {});
  check('B2 — ajout salon piège via menu', cfgStore.get(GUILD).channelIds.includes('chan_hp1') && iAdd._updates.length === 1);

  const iToggle2 = makeInteraction({ customId: '_hp_toggle' });
  await cmd.handleButton(iToggle2, {});
  check('B3 — toggle : activé', cfgStore.get(GUILD).enabled === true);

  const iToggle3 = makeInteraction({ customId: '_hp_toggle' });
  await cmd.handleButton(iToggle3, {});
  check('B4 — toggle : désactivé', cfgStore.get(GUILD).enabled === false);
  await cmd.handleButton(makeInteraction({ customId: '_hp_toggle' }), {});
  check('B5 — re-toggle : réactivé', cfgStore.get(GUILD).enabled === true);

  const iAct = makeInteraction({ customId: '_hp_action', values: ['ban'] });
  await cmd.handleSelect(iAct, {});
  check('B6 — sanction : ban sélectionné', cfgStore.get(GUILD).action === 'ban');

  const iDur = makeInteraction({ customId: '_hp_duration', values: ['60'] });
  await cmd.handleSelect(iDur, {});
  check('B7 — durée : 1h sélectionnée', cfgStore.get(GUILD).muteDuration === 60);

  const iLogs = makeInteraction({ customId: '_hp_logs', values: ['chan_log'] });
  await cmd.handleSelect(iLogs, {});
  check('B8 — salon de logs défini', cfgStore.get(GUILD).logChannelId === 'chan_log');

  const iDel = makeInteraction({ customId: '_hp_delete_toggle' });
  await cmd.handleButton(iDel, {});
  check('B9 — toggle suppression message', cfgStore.get(GUILD).deleteMessage === false);

  const iDm = makeInteraction({ customId: '_hp_dm_toggle' });
  await cmd.handleButton(iDm, {});
  check('B10 — toggle DM', cfgStore.get(GUILD).dmUser === false);

  // Retour aux défauts utiles pour la suite
  await cmd.handleSelect(makeInteraction({ customId: '_hp_duration', values: ['10080'] }), {});
  await cmd.handleSelect(makeInteraction({ customId: '_hp_action', values: ['mute'] }), {});

  // ══ C. Vue salons + autocreation + publication ═══════════════════════════
  const iView = makeInteraction({ customId: '_hp_channels_view' });
  await cmd.handleButton(iView, {});
  check('C1 — vue gérer salons : menu de retrait', has(iView._updates[0], '_hp_channels_remove'));

  const iRemove = makeInteraction({ customId: '_hp_channels_remove', values: ['chan_hp1'] });
  await cmd.handleSelect(iRemove, {});
  check('C2 — retrait salon', cfgStore.get(GUILD).channelIds.length === 0);
  await cmd.handleSelect(makeInteraction({ customId: '_hp_channels_add', values: ['chan_hp1'] }), {});

  const iAuto = makeInteraction({ customId: '_hp_autocreate' });
  await cmd.handleButton(iAuto, {});
  const cfgAfterAuto = cfgStore.get(GUILD);
  check('C3 — création auto : salon ajouté', cfgAfterAuto.channelIds.some(id => id.startsWith('chan_new_')));
  check('C4 — création auto : avertissement publié dans le nouveau salon', has(iAuto._followUps[0] || iAuto._updates[0] || {}, 'Salon créé'));

  const iPub = makeInteraction({ customId: '_hp_publish' });
  await cmd.handleButton(iPub, {});
  check('C5 — publication : message envoyé', has(iPub._replies[0], 'Message publié'));
  check('C6 — avertissement publié : contient le bouton piège hp_trap_click', sentWarns.some(w => has(w, 'hp_trap_click')));

  // ══ D. Modal avertissement & bouton ═══════════════════════════════════════
  const iAdvBtn = makeInteraction({ customId: '_hp_advanced' });
  await cmd.handleButton(iAdvBtn, {});
  check('D1 — bouton avancé : modale (message + libellé bouton)', iAdvBtn._shown.length === 1 && has(iAdvBtn._shown[0], 'hp_advanced_modal') && has(iAdvBtn._shown[0], 'hp_trigger'));

  const fields = (map) => ({ getTextInputValue: (id) => map[id] });
  const iModal = makeInteraction({ fields: fields({ hp_message: 'Nouvel avertissement de test', hp_trigger: '🎁 Réclamer' }) });
  await cmd.handleAdvancedModal(iModal);
  check('D2 — modal : message + libellé sauvegardés', cfgStore.get(GUILD).warningMessage === 'Nouvel avertissement de test' && cfgStore.get(GUILD).triggerLabel === '🎁 Réclamer');

  // ══ E. Sanctions — flux membre ════════════════════════════════════════════
  cfgStore.get(GUILD).dmUser = true; cfgStore.get(GUILD).deleteMessage = true;

  const msg1 = makeMessage('raider1');
  await cmd.handleTrigger(msg1, cfgStore.get(GUILD));
  check('E1 — message piège : mute appliqué (7 jours)', timedOut.some(t => t.id === 'raider1' && t.ms === 7 * 24 * 60 * 60 * 1000));
  check('E2 — message supprimé', deletedMessages.includes('raider1'));
  check('E3 — DM envoyé', dms.some(d => has(d, 'Sanction automatique')));
  check('E4 — log de sanction envoyé', sentLogs.length >= 1 && has(sentLogs[sentLogs.length - 1], 'raider1#0'));

  // Admin protégé
  const msgAdmin = makeMessage('admin2', { admin: true });
  await cmd.handleTrigger(msgAdmin, cfgStore.get(GUILD));
  check('E5 — admin : jamais sanctionné', !timedOut.some(t => t.id === 'admin2'));

  // Bouton piège
  const iTrap = makeInteraction({ userId: 'trapper1' });
  iTrap.customId = 'hp_trap_click';
  iTrap.member.permissions.has = () => false;
  iTrap.member.moderatable = true;
  await cmd.handleButtonTrigger(iTrap);
  check('E6 — bouton piège : sanction appliquée', timedOut.some(t => t.id === 'trapper1'));
  check('E7 — trappeur : DM reçu', dms.filter(d => has(d, 'Sanction automatique')).length >= 2);

  // Admin sur le bouton
  const iTrapAdmin = makeInteraction({ userId: 'admin9' });
  iTrapAdmin.customId = 'hp_trap_click';
  iTrapAdmin.member.permissions.has = (p) => p === 'Administrator' || p === 8n;
  await cmd.handleButtonTrigger(iTrapAdmin);
  check('E8 — admin sur bouton : refus poli', has(iTrapAdmin._replies[0], 'administrateurs'));

  // ══ F. Statistiques ═══════════════════════════════════════════════════════
  const iStats = makeInteraction({ customId: '_hp_stats' });
  await cmd.handleButton(iStats, {});
  check('F1 — stats : écran avec historique', has(iStats._updates[0], 'Statistiques détaillées'));

  const iClear = makeInteraction({ customId: '_hp_stats_clear' });
  await cmd.handleButton(iClear, {});
  check('F2 — vider historique : OK', trigStore.size === 0);

  // ══ G. Indépendance avec l'anti-raid ══════════════════════════════════════
  const antiRaidSrc = fs.readFileSync(require.resolve('../src/models/AntiRaid.js'), 'utf8');
  const honeypotSrc = fs.readFileSync(require.resolve('../src/models/Honeypot.js'), 'utf8');
  const msgCreateSrc = fs.readFileSync(require.resolve('../src/events/messages/messageCreate.js'), 'utf8');
  const icSrc = fs.readFileSync(require.resolve('../src/events/core/interactionCreate.js'), 'utf8');

  check('G1 — deux modèles distincts (pas de collision mongoose)', antiRaidSrc.includes("mongoose.model('AntiRaidHoneypot'") && honeypotSrc.includes("mongoose.model('Honeypot'"));
  check('G2 — messageCreate : les deux systèmes sont interrogés', msgCreateSrc.includes("require('../../models/AntiRaid')") && msgCreateSrc.includes("require('../../models/Honeypot')"));
  check('G3 — panel honeypot : routeur persistant _hp_ présent', icSrc.includes("id.startsWith('_hp_')"));

  console.log(failures === 0 ? '\n✅ TOUS LES TESTS PASSENT' : `\n💥 ${failures} ÉCHEC(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => { console.error('💥 Erreur fatale :', err); process.exit(1); });
