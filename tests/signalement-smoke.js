// tests/signalement-smoke.js — Smoke tests du système de signalement
// Usage : node tests/signalement-smoke.js
process.env.NODE_ENV = 'test';

// ─── Mocks mongoose : Config + Report en Maps ─────────────────────────────────
const cfgStore = new Map();  // guildId → doc
const repStore = new Map();  // _id → doc
let seq = 0;

function makeCfg(data) {
  return {
    guildId: data.guildId,
    enabled: false,
    logChannelId: null,
    types: { member: true, message: true },
    rolesAllowed: [],
    cooldownSec: 60,
    anonymous: false,
    autoAlertUser: true,
    stats: { total: 0, pending: 0, resolved: 0, rejected: 0 },
    updatedAt: new Date(),
    ...data,
    save: async function () { cfgStore.set(this.guildId, this); return this; },
  };
}

function makeReport(data) {
  const base = {
    _id: `rep_${String(++seq).padStart(6, '0')}`,
    guildId: null, reporterId: null, targetId: null, targetType: 'member',
    reason: 'autre', details: '', proofUrl: '', messageId: null,
    channelId: null, contextUrl: '', staffMsgId: null,
    status: 'pending', handledBy: null, handledAt: null,
    action: '', note: '', createdAt: new Date(),
    ...data,
  };
  base.save = async function () { repStore.set(this._id, this); return this; };
  return base;
}

const ConfigMock = {
  create: async (d) => { const doc = makeCfg(d); cfgStore.set(doc.guildId, doc); return doc; },
  findOne: (q) => Promise.resolve(cfgStore.get(q.guildId) || null),
};

const ReportMock = {
  create: async (d) => { const doc = makeReport(d); repStore.set(doc._id, doc); return doc; },
  findById: async (id) => repStore.get(id) || null,
  find: (q) => ({
    sort: () => ({ limit: () => ({ lean: async () => [...repStore.values()].filter(r => r.guildId === q.guildId && (q.status === undefined || r.status === q.status)) }) }),
  }),
};

const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === '../../models/Signalement') return require.resolve('../src/models/Signalement');
  return origResolve.call(this, request, ...args);
};
const modelPath = require.resolve('../src/models/Signalement');
require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: { Config: ConfigMock, Report: ReportMock } };

const cmd = require('../src/commands/configuration/signalement.js');

// Traduction bigint → nom pour le mock de permissions
const { PermissionFlagsBits } = require('discord.js');
const PERM_NAME = new Map(Object.entries(PermissionFlagsBits).map(([n, v]) => [v, n]));

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}

const payloadStr = (p) => { try { return JSON.stringify(p); } catch { return String(p); } };
const has = (p, s) => payloadStr(p).includes(s);

const GUILD = '123456789012345678';
const STAFF = 'staff_chan_1';

// ─── Fabrique d'interactions ──────────────────────────────────────────────────
function makeInteraction({ customId = null, values = null, fields = null, memberPerms = [], fromDM = false } = {}) {
  const replies = [], updates = [], shown = [], sentToChannels = [], dmSent = [], editedMessages = [];
  const guild = {
    id: GUILD, name: 'Test Guild',
    channels: {
      fetch: async (cid) => cid === 'gone'
        ? null
        : {
          id: cid, isTextBased: () => true,
          send: async (p) => { sentToChannels.push({ cid, p }); return { id: `msg_${sentToChannels.length}`, url: `https://discord.com/channels/x/${cid}/m${sentToChannels.length}` }; },
        },
    },
    members: {
      fetch: async (uid) => uid === '404'
        ? null
        : { id: uid, user: { id: uid, tag: `user_${uid}` }, ban: async () => {}, send: async (p) => { dmSent.push({ uid, p }); } },
    },
  };
  return {
    customId, values, fields,
    guildId: fromDM ? null : GUILD,
    guild: fromDM ? { id: GUILD, name: 'Test Guild' } : guild,
    inGuild: () => !fromDM,
    channelId: fromDM ? null : 'chan_public',
    user: { id: '999', tag: 'reporter', send: async (p) => { dmSent.push({ uid: '999', p }); } },
    member: { id: '999', roles: { cache: new Map() }, permissions: { has: (p) => memberPerms.includes(PERM_NAME.get(p)) } },
    memberPermissions: { has: (p) => memberPerms.includes(PERM_NAME.get(p)) },
    message: { edit: async (p) => { editedMessages.push(p); return p; } },
    deferred: false, replied: false,
    reply: async (p) => { replies.push(p); return p; },
    update: async (p) => { updates.push(p); return p; },
    showModal: async (m) => { shown.push(m); return m; },
    followUp: async (p) => { replies.push(p); return p; },
    _replies: replies, _updates: updates, _shown: shown, _sent: sentToChannels, _dm: dmSent, _edited: editedMessages,
  };
}

const fieldsOf = (map) => ({ getTextInputValue: (n) => map[n] });

(async () => {
  const { _internal: I } = cmd;

  // ─── 1. Commande unique sans sous-commande ───────────────────────────────────
  const json = cmd.data.toJSON();
  check('commande unique (aucune sous-commande)', (json.options || []).length === 0);

  // ─── 2. execute() → panneau ──────────────────────────────────────────────────
  const it0 = makeInteraction();
  await cmd.execute(it0);
  check('execute → panneau envoyé', it0._replies.length === 1 && has(it0._replies[0], 'Panneau des signalements'));
  check('config créée', cfgStore.has(GUILD));
  check('panneau : 5 rows max (limite Discord)', it0._replies[0].components.length === 5 && it0._replies[0].components.length <= 5, String(it0._replies[0].components.length));
  check('cooldown : bouton sig_cooldown présent', has(it0._replies[0], 'sig_cooldown'));

  // ─── 3. Toggles du panneau ───────────────────────────────────────────────────
  const itT = makeInteraction({ customId: 'sig_toggle' });
  await cmd.handleButton(itT);
  check('sig_toggle → activé', cfgStore.get(GUILD).enabled === true && has(itT._updates[0], 'activé'));

  const itA = makeInteraction({ customId: 'sig_anon_toggle' });
  await cmd.handleButton(itA);
  check('sig_anon_toggle → anonymat ON', cfgStore.get(GUILD).anonymous === true);

  const itD = makeInteraction({ customId: 'sig_dm_toggle' });
  await cmd.handleButton(itD);
  check('sig_dm_toggle → accusé DM OFF', cfgStore.get(GUILD).autoAlertUser === false);

  // ─── 4. Menus de config ──────────────────────────────────────────────────────
  const itL = makeInteraction({ customId: 'sigs_log', values: [STAFF] });
  await cmd.handleSelect(itL);
  check('sigs_log → salon configuré', cfgStore.get(GUILD).logChannelId === STAFF);

  const itCD = makeInteraction({ customId: 'sigs_cooldown', values: ['15'] });
  await cmd.handleSelect(itCD);
  check('sigs_cooldown → 15s', cfgStore.get(GUILD).cooldownSec === 15);

  const itTy = makeInteraction({ customId: 'sigs_types', values: ['member'] });
  await cmd.handleSelect(itTy);
  check('sigs_types → message désactivé', cfgStore.get(GUILD).types.member === true && cfgStore.get(GUILD).types.message === false);

  const itR = makeInteraction({ customId: 'sigs_roles', values: ['role_1'] });
  await cmd.handleSelect(itR);
  check('sigs_roles → restreint', JSON.stringify(cfgStore.get(GUILD).rolesAllowed) === JSON.stringify(['role_1']));

  // ─── 5. Publication du bouton public ────────────────────────────────────────
  const itP = makeInteraction({ customId: 'sigs_public', values: ['pub_chan'] });
  await cmd.handleSelect(itP);
  check('sigs_public → message publié avec bouton', itP._sent.length === 1 && has(itP._sent[0].p, 'sig_open_generic'));

  // ─── 6. Flux membre : bouton public → motif → modal → signalement ───────────
  cfgStore.get(GUILD).types.message = true;
  cfgStore.get(GUILD).rolesAllowed = []; // reset : le membre mock n'a aucun rôle
  const itOpen = makeInteraction({ customId: 'sig_open_generic' });
  await cmd.handleButton(itOpen);
  check('sig_open → menu motif (étape 1)', itOpen._replies.length === 1 && has(itOpen._replies[0], 'sigr_libre'));
  check('8 motifs proposés', itOpen._replies[0].components[0].toJSON().components[0].options.length === 8);

  const itReason = makeInteraction({ customId: 'sigr_libre', values: ['spam'] });
  await cmd.handleReasonMenu(itReason);
  check('menu motif → modal étape 2 (motif encodé)', itReason._shown.length === 1 && has(itReason._shown[0], 'sigm_submit_spam_libre'));

  // Signalement libre (type "free") — motif encodé dans le customId
  const itSub = makeInteraction({ customId: 'sigm_submit_spam_libre', fields: fieldsOf({ sigm_details: 'Il spamme #general', sigm_proof: '' }) });
  await cmd.handleModal(itSub, {});
  const freeRep = [...repStore.values()].find(r => r.reporterId === '999');
  check('signalement libre créé', Boolean(freeRep) && freeRep.reason === 'spam' && freeRep.targetType === 'free');
  check('livré au salon staff', itSub._sent.length === 1 && itSub._sent[0].cid === STAFF && has(itSub._sent[0].p, 'Harcèlement') === false);
  check('confirmation envoyée', itSub._replies.length >= 1 && has(itSub._replies[0], 'Signalement envoyé'));
  check('stats mises à jour', cfgStore.get(GUILD).stats.total === 1 && cfgStore.get(GUILD).stats.pending === 1);

  // Anonymat actif → l'embed staff ne contient pas l'ID du signaleur
  cfgStore.get(GUILD).cooldownSec = 0; // pas de cooldown pour ces envois de test
  cfgStore.get(GUILD).anonymous = true;
  const itSub2 = makeInteraction({ customId: 'sigm_submit_autre_libre', fields: fieldsOf({ sigm_details: 'test anon', sigm_proof: '' }) });
  await cmd.handleModal(itSub2, {});
  check('anonymat : pas de mention du signaleur', itSub2._sent.length === 1 && !has(itSub2._sent[0].p, '<@999>'));
  cfgStore.get(GUILD).anonymous = false;

  // ─── 7. Signalement ciblé d'un membre (sigr_m_<id>) ─────────────────────────
  const itReason2 = makeInteraction({ customId: 'sigr_m_555888777', values: ['harcelement'] });
  await cmd.handleReasonMenu(itReason2);
  check('menu motif ciblé → modal avec target', itReason2._shown.length === 1 && has(itReason2._shown[0], 'sigm_submit_harcelement_555888777'));

  const itSub3 = makeInteraction({ customId: 'sigm_submit_harcelement_555888777', fields: fieldsOf({ sigm_details: 'Insultes répétées', sigm_proof: 'https://img.example/p.png' }) });
  await cmd.handleModal(itSub3, {});
  const rep3 = [...repStore.values()].find(r => r.targetId === '555888777');
  check('signalement membre créé avec preuve', Boolean(rep3) && rep3.reason === 'harcelement' && rep3.proofUrl === 'https://img.example/p.png');
  check('boutons warn/ban ajoutés (membre visé)', has(itSub3._sent[0].p, 'sig_ban_') && has(itSub3._sent[0].p, 'sig_warn_'));

  // Accusé de réception DM désactivé → pas de DM
  check('accusé DM OFF → aucun DM', itSub3._dm.length === 0, JSON.stringify(itSub3._dm.length));

  // ─── 8. Cooldown ─────────────────────────────────────────────────────────
  cfgStore.get(GUILD).cooldownSec = 60;
  const itCD2 = makeInteraction({ customId: 'sigm_submit_spam_libre', fields: fieldsOf({ sigm_details: 'encore', sigm_proof: '' }) });
  await cmd.handleModal(itCD2, {});
  check('cooldown → refus', itCD2._replies.length === 1 && has(itCD2._replies[0], 'Trop de signalements') && itCD2._sent.length === 0);

  // ─── 9. Rôles restreints ────────────────────────────────────────────────
  cfgStore.get(GUILD).cooldownSec = 0;
  cfgStore.get(GUILD).rolesAllowed = ['role_1'];
  const itSub4 = makeInteraction({ customId: 'sigm_submit_spam_libre', fields: fieldsOf({ sigm_details: 'pas le rôle', sigm_proof: '' }) });
  await cmd.handleModal(itSub4, {});
  check('rôles restreints → refus', has(itSub4._replies[0], 'Non autorisé') && itSub4._sent.length === 0);
  cfgStore.get(GUILD).rolesAllowed = []; // reset pour la suite

  // ─── 10. Traitement staff ────────────────────────────────────────────────────
  const rep = freeRep;
  const itH = makeInteraction({ customId: `sig_handle_${rep._id}`, memberPerms: ['ManageMessages'] });
  await cmd.handleButton(itH);
  check('traiter → statut resolved', repStore.get(rep._id).status === 'resolved');
  check('traiter → message staff édité sans boutons', itH._edited.length === 1 && itH._edited[0].components.length === 0);
  check('stats : resolved+1, pending-1', cfgStore.get(GUILD).stats.resolved === 1 && cfgStore.get(GUILD).stats.pending === 2);

  const rep3b = repStore.get(rep3._id);
  const itB = makeInteraction({ customId: `sig_ban_${rep3b._id}`, memberPerms: ['BanMembers'] });
  await cmd.handleButton(itB);
  check('ban → resolved + action ban', repStore.get(rep3b._id).status === 'resolved' && repStore.get(rep3b._id).action === 'ban');

  const repAnon = [...repStore.values()].find(r => r.details === 'test anon');
  const itR2 = makeInteraction({ customId: `sig_reject_${repAnon._id}`, memberPerms: ['ManageMessages'] });
  await cmd.handleButton(itR2);
  check('rejeter → statut rejected', repStore.get(repAnon._id).status === 'rejected');

  // Double traitement refusé
  const itDbl = makeInteraction({ customId: `sig_handle_${rep._id}`, memberPerms: ['ManageMessages'] });
  await cmd.handleButton(itDbl);
  check('déjà traité → refus', has(itDbl._replies[0], 'Déjà traité'));

  // Sans permission → refus (report frais, jamais traité)
  const rep4 = await ReportMock.create({ guildId: GUILD, reporterId: '777', reason: 'spam', details: 'sans perm test' });
  const itNoPerm = makeInteraction({ customId: `sig_handle_${rep4._id}`, memberPerms: [] });
  await cmd.handleButton(itNoPerm);
  check('sans permission → refus', has(itNoPerm._replies[0], 'Permission manquante'));

  // ─── 11. Stats et liste ──────────────────────────────────────────────────────
  const itS = makeInteraction({ customId: 'sig_stats' });
  await cmd.handleButton(itS);
  check('sig_stats → embed stats', itS._replies.length === 1 && has(itS._replies[0], 'Statistiques des signalements'));

  const itList = makeInteraction({ customId: 'sig_list' });
  await cmd.handleButton(itList);
  check('sig_list → liste ou vide', itList._replies.length === 1);

  // ─── 12. Système désactivé → refus ───────────────────────────────────────────
  cfgStore.get(GUILD).enabled = false;
  cfgStore.get(GUILD).cooldownSec = 0;
  cfgStore.get(GUILD).rolesAllowed = [];
  const itOff = makeInteraction({ customId: 'sigm_submit_spam_libre', fields: fieldsOf({ sigm_details: 'x', sigm_proof: '' }) });
  await cmd.handleModal(itOff, {});
  check('système désactivé → refus', has(itOff._replies[0], 'désactivé'));

  console.log(failures === 0 ? '\n🎉 Tous les tests signalement passent.' : `\n💥 ${failures} test(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { console.error('💥', err); process.exit(1); });
