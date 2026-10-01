// tests/suggestion-smoke.js — Smoke tests du système de suggestions v2 (sans dashboard)
// Usage : node tests/suggestion-smoke.js
process.env.NODE_ENV = 'test';

// ─── Mocks mongoose : Suggestion + SuggestionConfig + SuggestionLog ───────────
const sugStore = new Map();  // _id → doc
const cfgStore = new Map();  // guildId → doc
const logStore = [];         // entrées de log
let seq = 0;
let msgSeq = 0;

const CATEGORY_KEYS = ['general', 'bot', 'serveur', 'design', 'regles'];

function makeSug(data) {
  const doc = {
    _id: `sug_${String(++seq).padStart(6, '0')}`,
    guildId: null, channelId: null, messageId: null, threadId: null,
    authorId: null, content: '', number: 0, category: 'general',
    anonymous: false, status: 'pending', upvotes: 0, downvotes: 0,
    voters: [], voteChoice: {}, reason: null, pinned: false,
    autoResolved: false, editedAt: null, resolvedAt: null, resolvedBy: null,
    createdAt: new Date(),
    ...data,
  };
  doc.save = async function () { sugStore.set(this._id, this); return this; };
  return doc;
}

function makeCfg(data) {
  return {
    guildId: data.guildId,
    channelId: null, logChannelId: null, enabled: false,
    cooldownMinutes: 0, requiredRoleId: null,
    anonymousAllowed: true, categoriesEnabled: [...CATEGORY_KEYS],
    autoThread: false, dmNotify: true,
    autoApproveAt: 0, autoDenyAt: 0, transcriptEnabled: true,
    logTypes: null,
    ...data,
    save: async function () { cfgStore.set(this.guildId, this); return this; },
  };
}

function findSug(q) {
  return [...sugStore.values()].filter(s =>
    (q.guildId === undefined || s.guildId === q.guildId)
    && (q.number === undefined || s.number === q.number)
    && (q.authorId === undefined || s.authorId === q.authorId)
  )[0] || null;
}

const SuggestionMock = {
  create: async (d) => { const doc = makeSug(d); sugStore.set(doc._id, doc); return doc; },
  findById: async (id) => sugStore.get(id) || null,
  findOne: (q) => {
    const found = findSug(q);
    return {
      sort: () => Promise.resolve(found),
      then: (res, rej) => Promise.resolve(found).then(res, rej),
    };
  },
  countDocuments: async (q) => [...sugStore.values()].filter(s => s.guildId === q.guildId).length,
  deleteOne: async (q) => { const d = q._id ? sugStore.get(q._id) : findSug(q); if (d) sugStore.delete(d._id); return { deletedCount: d ? 1 : 0 }; },
  find: (q) => ({ lean: async () => [...sugStore.values()].filter(s => s.guildId === q.guildId) }),
};

const ConfigMock = {
  create: async (d) => { const doc = makeCfg(d); cfgStore.set(doc.guildId, doc); return doc; },
  findOne: (q) => Promise.resolve(cfgStore.get(q.guildId) || null),
};

const LogMock = {
  create: async (d) => { logStore.push({ _id: `log_${logStore.length + 1}`, date: new Date(), ...d }); return d; },
  find: (q) => ({ sort: () => ({ lean: async () => logStore.filter(l => l.suggestionId === q.suggestionId) }) }),
};

// ─── Injection des mocks dans le cache de modules ─────────────────────────────
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === '../../models/Suggestion' || request === '../models/Suggestion') {
    return require.resolve('../src/models/Suggestion');
  }
  return origResolve.call(this, request, ...args);
};
const modelPath = require.resolve('../src/models/Suggestion');
require.cache[modelPath] = {
  id: modelPath, filename: modelPath, loaded: true,
  exports: { CATEGORY_KEYS, Suggestion: SuggestionMock, SuggestionConfig: ConfigMock, SuggestionLog: LogMock },
};

const cmd = require('../src/commands/communaute/suggestion.js');
const { LOG_TYPE_KEYS, isLogTypeEnabled } = require('../src/utils/suggestionLogger');
const { PermissionFlagsBits } = require('discord.js');
const PERM_NAME = new Map(Object.entries(PermissionFlagsBits).map(([n, v]) => [v, n]));

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}

const payloadStr = (p) => { try { return JSON.stringify(p, (k, v) => typeof v === 'bigint' ? String(v) : v); } catch { return String(p); } };
const has = (p, s) => payloadStr(p).includes(s);

const GUILD = '123456789012345678';
const SUGCHAN = 'chan_sug';
const LOGCHAN = 'chan_log';

// ─── Client + salon mock ──────────────────────────────────────────────────────
const published = [], relayed = [], dms = [];
const chanMsgs = new Map();

const sugChan = {
  id: SUGCHAN, isTextBased: () => true,
  send: async (p) => {
    const m = {
      id: `pub_${++msgSeq}`,
      _lastEdit: null,
      edit: async (np) => { m._lastEdit = np; return m; },
      startThread: async () => ({ id: 'th_1' }),
    };
    chanMsgs.set(m.id, m);
    published.push({ p, msg: m });
    return m;
  },
  messages: { fetch: async (id) => chanMsgs.get(id) || null },
};

const client = {
  users: {
    fetch: async (id) => ({
      id, username: `user_${id}`, displayAvatarURL: () => 'http://avatar',
      send: async (p) => { dms.push({ uid: id, p }); },
    }),
  },
  guilds: {
    cache: new Map([[GUILD, {
      id: GUILD,
      members: { fetch: async (id) => ({ id, displayName: `membre_${id}` }) },
      channels: {
        cache: new Map([[LOGCHAN, {
          id: LOGCHAN, isTextBased: () => true,
          send: async (p) => { relayed.push(p); return { id: 'relay_1' }; },
        }]]),
      },
    }]]),
  },
  channels: { fetch: async (id) => (id === SUGCHAN ? sugChan : null) },
};
client._chanMsgs = chanMsgs;

// ─── Fabrique d'interactions ──────────────────────────────────────────────────
function makeInteraction({ sub = null, opt = {}, customId = null, values = null, fields = null, modPerms = false, roles = [], userId = '111' } = {}) {
  const replies = [], updates = [], shown = [], followUps = [], edited = [];
  const permHas = (p) => modPerms || PERM_NAME.get(p) !== 'ManageGuild';
  return {
    customId, values,
    options: sub === null ? undefined : {
      getSubcommand: () => sub,
      getString: (n) => (opt[n] ?? null),
      getInteger: (n) => (opt[n] ?? null),
      getBoolean: (n) => (opt[n] ?? false),
    },
    fields: { getTextInputValue: (n) => (fields || {})[n] },
    client,
    guildId: GUILD,
    guild: {
      id: GUILD, name: 'Test Guild', iconURL: () => null,
      channels: { fetch: async (id) => (id === SUGCHAN ? sugChan : null) },
      members: { fetch: async (id) => ({ id, displayName: `membre_${id}` }) },
    },
    channelId: 'chan_here',
    user: { id: userId, username: `user_${userId}`, send: async (p) => { dms.push({ uid: userId, p }); } },
    member: { id: userId, roles: { cache: roles }, permissions: { has: permHas } },
    memberPermissions: { has: permHas },
    deferred: false, replied: false,
    reply: async (p) => { replies.push(p); return { ...p, createMessageComponentCollector: () => ({ on: () => {} }) }; },
    update: async (p) => { updates.push(p); return p; },
    showModal: async (m) => { shown.push(m); return m; },
    followUp: async (p) => { followUps.push(p); return p; },
    editReply: async (p) => { edited.push(p); return p; },
    _replies: replies, _updates: updates, _shown: shown, _followUps: followUps, _edited: edited,
  };
}

const cfg = () => cfgStore.get(GUILD);
const resetRelay = () => { relayed.length = 0; dms.length = 0; };

(async () => {
  // ══ A. Structure & limites Discord ════════════════════════════════════════
  const json = cmd.data.toJSON();
  check('A1 — 8 sous-commandes déclarées', json.options.length === 8 && json.options.map(o => o.name).join(',') === 'proposer,approuver,refuser,modifier,supprimer,top,stats,config', json.options.map(o => o.name).join(','));

  await ConfigMock.create({ guildId: GUILD });
  const iCfg = makeInteraction({ sub: 'config', modPerms: true });
  await cmd.execute(iCfg, client);
  const panel = iCfg._replies[0];
  check('A2 — panneau : exactement 5 rangées', panel.components.length === 5, `got ${panel.components.length}`);
  check('A3 — chaque rangée ≤ 5 composants', panel.components.every(r => r.components.length <= 5 && r.components.length >= 1));
  const panelStr = payloadStr(panel);
  check('A4 — prefixes customId uniques (sugc_)', !/sugpanel_|sugstats_|sug_set_channel|sug_toggle/.test(panelStr) && panelStr.includes('sugc_'));
  const logsMenuJson = panel.components[1].components[0].toJSON();
  check('A5 — menu logs : 13 options + maxValues = nb defaults (13)', logsMenuJson.options.length === LOG_TYPE_KEYS.length && logsMenuJson.max_values === LOG_TYPE_KEYS.length, `opts=${logsMenuJson.options.length} max=${logsMenuJson.max_values}`);

  // ══ B. Config — boutons ═══════════════════════════════════════════════════
  const iToggle = makeInteraction({ customId: 'sugc_toggle_enabled', modPerms: true });
  await cmd.handleButton(iToggle, client);
  check('B1 — activation du système', cfg().enabled === true && iToggle._updates.length === 1);

  cfg().autoThread = true; // défaut modèle = false : on aligne sur "activé" pour tester ON→OFF→ON
  for (const [btn, prop] of [['sugc_toggle_anon', 'anonymousAllowed'], ['sugc_toggle_autothread', 'autoThread'], ['sugc_toggle_dmnotify', 'dmNotify'], ['sugc_toggle_transcript', 'transcriptEnabled']]) {
    const i = makeInteraction({ customId: btn, modPerms: true });
    try { await cmd.handleButton(i, client); } catch (e) { console.log(`   [debug ${btn}]`, e.message); }
    check(`B2 — toggle ${prop}`, cfg()[prop] === false && i._updates.length === 1);
    const i2 = makeInteraction({ customId: btn, modPerms: true });
    try { await cmd.handleButton(i2, client); } catch (e) { console.log(`   [debug ${btn} retour]`, e.message); }
    check(`B3 — toggle ${prop} (retour)`, cfg()[prop] === true);
  }

  const iRef = makeInteraction({ customId: 'sugc_refresh', modPerms: true });
  await cmd.handleButton(iRef, client);
  check('B4 — actualiser le panneau', iRef._updates.length === 1 && iRef._updates[0].components.length === 5);

  const iAnti = makeInteraction({ customId: 'sugc_antiabuse', modPerms: true });
  await cmd.handleButton(iAnti, client);
  check('B5 — bouton anti-abus → modal', iAnti._shown.length === 1 && has(iAnti._shown[0], 'sugm_modal_cooldown'));

  const iThr = makeInteraction({ customId: 'sugc_thresholds', modPerms: true });
  await cmd.handleButton(iThr, client);
  check('B6 — bouton seuils → modal', iThr._shown.length === 1 && has(iThr._shown[0], 'sugm_modal_thresholds'));

  const iCat = makeInteraction({ customId: 'sugc_categories', modPerms: true });
  await cmd.handleButton(iCat, client);
  check('B7 — bouton catégories → menu éphémère', iCat._replies.length === 1 && has(iCat._replies[0], 'sugc_categories'));

  // ══ C. Config — menus ═════════════════════════════════════════════════════
  const iChan = makeInteraction({ customId: 'sugc_channel', values: [SUGCHAN], modPerms: true });
  await cmd.handleSelect(iChan, client);
  check('C1 — salon des suggestions défini + auto-activation', cfg().channelId === SUGCHAN && cfg().enabled === true && iChan._updates.length === 1);

  const iLog = makeInteraction({ customId: 'sugc_logchannel', values: [LOGCHAN], modPerms: true });
  await cmd.handleSelect(iLog, client);
  check('C2 — salon de logs défini', cfg().logChannelId === LOGCHAN);

  const iLt = makeInteraction({ customId: 'sugc_logtypes', values: ['created', 'approved'], modPerms: true });
  await cmd.handleSelect(iLt, client);
  check('C3 — logs avancés : seuls les types sélectionnés actifs', cfg().logTypes.created === true && cfg().logTypes.approved === true && cfg().logTypes.upvoted === false && cfg().logTypes.deleted === false);
  const rebuilt = iLt._updates[0].components[1].components[0].toJSON();
  check('C4 — maxValues recalculé après filtrage (2)', rebuilt.max_values === 2, `got ${rebuilt.max_values}`);

  const iLt0 = makeInteraction({ customId: 'sugc_logtypes', values: [], modPerms: true });
  await cmd.handleSelect(iLt0, client);
  check('C5 — logs avancés : tout désélectionner = tout désactivé', LOG_TYPE_KEYS.every(k => cfg().logTypes[k] === false));

  const iCatSel = makeInteraction({ customId: 'sugc_categories', values: ['bot', 'design'], modPerms: true });
  await cmd.handleSelect(iCatSel, client);
  check('C6 — catégories restreintes', cfg().categoriesEnabled.length === 2 && cfg().categoriesEnabled.includes('bot'));
  cfg().categoriesEnabled = [...CATEGORY_KEYS]; // restaure pour la suite des tests

  // ══ D. Modaux (anti-abus, seuils) ═════════════════════════════════════════
  const iModal = makeInteraction({ customId: 'sugm_modal_cooldown', fields: { minutes: '30', role_id: '<@&111222333444555666>' }, modPerms: true });
  await cmd.handleModal(iModal, client);
  check('D1 — cooldown + rôle requis enregistrés', cfg().cooldownMinutes === 30 && cfg().requiredRoleId === '111222333444555666');

  const iModalBad = makeInteraction({ customId: 'sugm_modal_cooldown', fields: { minutes: 'abc', role_id: '' }, modPerms: true });
  await cmd.handleModal(iModalBad, client);
  check('D2 — cooldown invalide rejeté', has(iModalBad._replies[0], 'invalide'));

  const iModalThr = makeInteraction({ customId: 'sugm_modal_thresholds', fields: { auto_approve: '10', auto_deny: '3' }, modPerms: true });
  await cmd.handleModal(iModalThr, client);
  check('D3 — seuils enregistrés', cfg().autoApproveAt === 10 && cfg().autoDenyAt === 3);
  cfg().autoApproveAt = 0; cfg().autoDenyAt = 0; cfg().requiredRoleId = null; // reset pour la suite des tests

  // ══ E. Proposer + votes ═══════════════════════════════════════════════════
  const iProp = makeInteraction({ sub: 'proposer', opt: { texte: 'Ajoutons un salon musique !' }, userId: '111' });
  try { await cmd.execute(iProp, client); } catch (e) { console.log('   [debug proposer]', e.message); }
  check('E1 — suggestion publiée avec réponse de confirmation', iProp._replies.length === 1 && has(iProp._replies[0], 'publiée'), payloadStr(iProp._replies[0]).slice(0, 150));
  const card = published[0];
  check('E2 — carte publique : 2 rangées (votes + modération)', card.p.components.length === 2, `got ${card.p.components.length}`);
  check('E3 — rangées de la carte ≤ 5 composants', card.p.components.every(r => r.components.length <= 5));
  const sugA = [...sugStore.values()].find(s => s.number === 1);
  check('E4 — boutons de vote persistants (sug_up_/sug_down_)', has(card.p, `sug_up_${sugA._id}`) && has(card.p, `sug_down_${sugA._id}`));
  check('E5 — boutons de modération persistants (sugm_)', has(card.p, `sugm_approve_${sugA._id}`) && has(card.p, `sugm_pin_${sugA._id}`));
  check('E6 — suggestion en base (pending, #1)', sugA && sugA.status === 'pending' && sugA.messageId === card.msg.id);

  const iV1 = makeInteraction({ customId: `sug_up_${sugA._id}`, userId: '111' });
  await cmd.handleVote(iV1, sugA._id, 'up');
  check('E7 — vote positif compté', sugA.upvotes === 1 && iV1._updates.length === 1 && iV1._followUps.length === 1);

  const iV2 = makeInteraction({ customId: `sug_up_${sugA._id}`, userId: '111' });
  await cmd.handleVote(iV2, sugA._id, 'up');
  check('E8 — double vote identique refusé', has(iV2._replies[0], 'Déjà voté') && sugA.upvotes === 1);

  const iV3 = makeInteraction({ customId: `sug_down_${sugA._id}`, userId: '111' });
  await cmd.handleVote(iV3, sugA._id, 'down');
  check('E9 — changement de vote (up → down)', sugA.upvotes === 0 && sugA.downvotes === 1 && logStore.some(l => l.action === 'vote_changed'));

  cfg().autoDenyAt = 1;
  const iV4 = makeInteraction({ customId: `sug_down_${sugA._id}`, userId: '333' });
  await cmd.handleVote(iV4, sugA._id, 'down');
  check('E10 — auto-refus par seuil de votes', sugA.status === 'denied' && sugA.autoResolved === true && logStore.some(l => l.action === 'auto_denied'));
  check('E11 — DM automatique à l\u2019auteur', dms.some(d => has(d.p, 'refusée automatiquement')));
  cfg().autoDenyAt = 0;

  const iV5 = makeInteraction({ customId: `sug_up_${sugA._id}`, userId: '222' });
  await cmd.handleVote(iV5, sugA._id, 'up');
  check('E12 — votes refusés après clôture', has(iV5._replies[0], 'plus de votes'));

  // ══ F. Modération ═════════════════════════════════════════════════════════
  const sugB = await SuggestionMock.create({ guildId: GUILD, channelId: SUGCHAN, authorId: '333', content: 'Deuxième suggestion', number: 2 });
  const cardB = await sugChan.send({ embeds: [], components: [] });
  sugB.messageId = cardB.id;

  const iAppr = makeInteraction({ sub: 'approuver', opt: { numero: 2, raison: 'Bonne idée' }, modPerms: true });
  await cmd.execute(iAppr, client);
  check('F1 — /suggestion approuver', sugB.status === 'approved' && sugB.reason === 'Bonne idée' && has(cardB._lastEdit, 'Approuvée'));

  const sugC = await SuggestionMock.create({ guildId: GUILD, channelId: SUGCHAN, authorId: '222', content: 'Troisième suggestion', number: 3 });
  const iBtnAppr = makeInteraction({ customId: `sugm_approve_${sugC._id}`, modPerms: true, userId: '444' });
  await cmd.handleButton(iBtnAppr, client);
  check('F2 — bouton Résoudre (approuver)', sugC.status === 'approved' && iBtnAppr._replies.length === 1);

  const iBtnAppr2 = makeInteraction({ customId: `sugm_approve_${sugC._id}`, modPerms: true, userId: '444' });
  await cmd.handleButton(iBtnAppr2, client);
  check('F3 — double traitement refusé', has(iBtnAppr2._replies[0], 'Déjà traitée'));

  const sugD = await SuggestionMock.create({ guildId: GUILD, channelId: SUGCHAN, authorId: '222', content: 'Quatrième suggestion', number: 4 });
  const iBtnNonMod = makeInteraction({ customId: `sugm_deny_${sugD._id}`, modPerms: false, userId: '555' });
  await cmd.handleButton(iBtnNonMod, client);
  check('F4 — non-modérateur refusé', has(iBtnNonMod._replies[0], 'Permission refusée') && sugD.status === 'pending');

  const iPin1 = makeInteraction({ customId: `sugm_pin_${sugD._id}`, modPerms: true, userId: '444' });
  await cmd.handleButton(iPin1, client);
  check('F5 — épinglage', sugD.pinned === true && iPin1._updates.length === 1);
  const iPin2 = makeInteraction({ customId: `sugm_pin_${sugD._id}`, modPerms: true, userId: '444' });
  await cmd.handleButton(iPin2, client);
  check('F6 — désépinglage', sugD.pinned === false);

  const iRef2 = makeInteraction({ sub: 'refuser', opt: { numero: 4, raison: 'Hors sujet' }, modPerms: true });
  await cmd.execute(iRef2, client);
  check('F7 — /suggestion refuser avec raison', sugD.status === 'denied' && sugD.reason === 'Hors sujet');

  // ══ G. Garde-fous de /proposer ════════════════════════════════════════════
  cfg().cooldownMinutes = 60;
  const iCool = makeInteraction({ sub: 'proposer', opt: { texte: 'Encore une' }, userId: '111' });
  await cmd.execute(iCool, client);
  check('G1 — cooldown actif bloqué', has(iCool._replies[0], 'Cooldown'));
  cfg().cooldownMinutes = 0;

  cfg().requiredRoleId = 'r1';
  const iRole = makeInteraction({ sub: 'proposer', opt: { texte: 'Encore une' }, userId: '111', roles: [{ id: 'r2' }] });
  await cmd.execute(iRole, client);
  check('G2 — rôle requis manquant bloqué', has(iRole._replies[0], 'Rôle requis'));
  cfg().requiredRoleId = null;

  cfg().categoriesEnabled = ['bot'];
  const iCat2 = makeInteraction({ sub: 'proposer', opt: { texte: 'Encore une' }, userId: '111' });
  await cmd.execute(iCat2, client);
  check('G3 — catégorie désactivée bloquée', has(iCat2._replies[0], 'désactivée'));
  cfg().categoriesEnabled = [...CATEGORY_KEYS];

  const iAnon = makeInteraction({ sub: 'proposer', opt: { texte: 'Suggestion anonyme de test', anonyme: true }, userId: '111' });
  await cmd.execute(iAnon, client);
  const anonCard = published[published.length - 1];
  check('G4 — suggestion anonyme (footer dédié)', has(anonCard.p, 'Proposée anonymement'));

  // ══ H. Logs avancés (filtre + enrichissement) ═════════════════════════════
  check('H1 — isLogTypeEnabled : null = tout actif', isLogTypeEnabled({ logTypes: null }, 'upvoted') === true);
  check('H2 — isLogTypeEnabled : false explicite', isLogTypeEnabled({ logTypes: { upvoted: false } }, 'upvoted') === false);
  check('H3 — isLogTypeEnabled : absent = actif', isLogTypeEnabled({ logTypes: {} }, 'created') === true);

  cfg().logChannelId = LOGCHAN;
  cfg().logTypes = { upvoted: false };
  resetRelay();
  const { logAction } = require('../src/utils/suggestionLogger');
  await logAction({ client, guildId: GUILD, suggestionId: sugA._id, action: 'upvoted', actorId: '222', suggestionNumber: 1 });
  check('H4 — type de log désactivé non relayé', relayed.length === 0);
  await logAction({ client, guildId: GUILD, suggestionId: sugA._id, action: 'created', actorId: '111', suggestionNumber: 1 });
  check('H5 — type de log actif relayé', relayed.length === 1);
  check('H6 — log enrichi (nom + numéro)', has(relayed[0], 'membre_111') && has(relayed[0], '#1'));
  cfg().logTypes = null;

  // ══ I. Stats & top ════════════════════════════════════════════════════════
  const iStats = makeInteraction({ sub: 'stats', modPerms: false });
  await cmd.execute(iStats, client);
  check('I1 — /suggestion stats répond', iStats._replies.length === 1 && has(iStats._replies[0], 'Statistiques'));

  const iTop = makeInteraction({ sub: 'top' });
  await cmd.execute(iTop, client);
  check('I2 — /suggestion top répond', iTop._replies.length === 1 && has(iTop._replies[0], 'Top 5'));

  // ══ J. Modifier / supprimer ═══════════════════════════════════════════════
  const sugJ = await SuggestionMock.create({ guildId: GUILD, channelId: SUGCHAN, authorId: '222', content: 'Texte initial', number: 6 });
  const iMod = makeInteraction({ sub: 'modifier', opt: { numero: 6, texte: 'Texte modifié' }, userId: '222' });
  await cmd.execute(iMod, client);
  check('J1 — /suggestion modifier', sugJ.content === 'Texte modifié' && sugJ.editedAt !== null);

  const iModOther = makeInteraction({ sub: 'modifier', opt: { numero: 6, texte: 'Hack' }, userId: '999' });
  await cmd.execute(iModOther, client);
  check('J2 — modification par un tiers refusée', has(iModOther._replies[0], 'Non autorisé'));

  const sugE = await SuggestionMock.create({ guildId: GUILD, channelId: SUGCHAN, authorId: '555', content: 'À supprimer', number: 7 });
  const iDel = makeInteraction({ sub: 'supprimer', opt: { numero: 7 }, userId: '555' });
  await cmd.execute(iDel, client);
  check('J3 — /suggestion supprimer', !sugStore.has(sugE._id) && logStore.some(l => l.action === 'deleted'));

  // ─── Bilan ────────────────────────────────────────────────────────────────
  console.log(`\n${failures === 0 ? '✅ TOUS LES TESTS PASSENT' : `❌ ${failures} échec(s)`}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
