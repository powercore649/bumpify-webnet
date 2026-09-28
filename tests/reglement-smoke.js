// tests/reglement-smoke.js — Smoke tests du panneau /reglement v2
// Usage : node tests/reglement-smoke.js
process.env.NODE_ENV = 'test';

// ─── Mock mongoose : Reglement en Map ─────────────────────────────────────────
const store = new Map(); // guildId → doc

function makeDoc(data) {
  return {
    _id: data.guildId,
    rules: [],
    messageId: null,
    channelId: null,
    acceptRoleId: null,
    title: '',
    description: '',
    footer: '',
    color: '#5865F2',
    acceptLabel: '✅ J\'accepte le règlement',
    showNumbering: true,
    acceptCount: 0,
    publishedUrl: undefined,
    updatedAt: new Date(),
    ...data,
    save: async function () { store.set(this.guildId, this); return this; },
  };
}

const ReglementMock = {
  create: async (data) => { const d = makeDoc(data); store.set(d.guildId, d); return d; },
  findOne: (q) => {
    const hit = () => store.get(q.guildId) || null;
    const p = Promise.resolve(hit());
    p.lean = async () => hit();
    return p;
  },
  updateOne: async () => ({}),
};

const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === '../../models/Reglement') return require.resolve('../src/models/Reglement');
  return origResolve.call(this, request, ...args);
};
const modelPath = require.resolve('../src/models/Reglement');
require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: ReglementMock };

const cmd = require('../src/commands/configuration/reglement.js');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}

// ─── Fabrique de fausse interaction ───────────────────────────────────────────
function makeInteraction({ customId = null, values = null, fields = null, guildId = '123456789012345678', guildName = 'Test Guild' } = {}) {
  const updates = [];
  const replies = [];
  const shown = [];
  const guild = {
    id: guildId,
    name: guildName,
    channels: { fetch: async (cid) => ({ id: cid, isTextBased: () => true, send: async (p) => ({ id: 'msg_new', url: `https://discord.com/channels/${guildId}/${cid}/msg_new`, edit: async () => ({}) }) }), },
    members: { },
  };
  const interaction = {
    customId, values, fields,
    guildId,
    guild,
    inGuild: () => true,
    user: { id: '999', tag: 'tester' },
    member: { id: '999', roles: { cache: new Map() }, },
    channel: { id: 'chan_1' },
    deferred: false, replied: false,
    update: async (p) => { updates.push(p); return p; },
    reply: async (p) => { replies.push(p); return p; },
    showModal: async (m) => { shown.push(m); return m; },
    deferUpdate: async () => {},
    _updates: updates, _replies: replies, _shown: shown,
  };
  return interaction;
}

const payloadStr = (p) => {
  try { return JSON.stringify(p, (k, v) => (typeof v === 'bigint' ? String(v) : v)); }
  catch { return String(p); }
};
const hasCustomId = (p, id) => payloadStr(p).includes(id);

(async () => {
  const { _internal: I } = cmd;
  const GUILD = '123456789012345678';

  // ─── 1. Commande unique sans sous-commandes ──────────────────────────────────
  const json = cmd.data.toJSON();
  check('commande unique (aucune sous-commande)', (json.options || []).length === 0, JSON.stringify(json.options || []));
  check('permissions ManageGuild', json.default_member_permissions === '32' /* ManageGuild */, json.default_member_permissions);

  // ─── 2. Helpers ──────────────────────────────────────────────────────────────
  check('normalizeColor valide', I.normalizeColor('#5865f2') === '#5865F2');
  check('normalizeColor sans #', I.normalizeColor('ED4245') === '#ED4245');
  check('normalizeColor invalide → null', I.normalizeColor('rouge') === null);
  check('parseBulkRules multi-lignes', JSON.stringify(I.parseBulkRules('  A \n\nB\n C ')) === JSON.stringify(['A', 'B', 'C']));
  check('parseBulkRules vide → []', I.parseBulkRules('  \n \n').length === 0);

  const guild = { id: GUILD, name: 'Test Guild' };
  const reg0 = makeDoc({ guildId: GUILD, rules: ['Règle A', 'Règle B', 'Règle C'] });
  const e1 = I.buildReglementEmbed(reg0, guild);
  check('embed titre par défaut', e1.data.title === '📜 Règlement — Test Guild');
  check('embed numérotation', e1.data.description.includes('**1.** Règle A') && e1.data.description.includes('**3.** Règle C'));
  const reg0b = { ...reg0, showNumbering: false, title: 'Titre custom', color: '#FF0000', footer: 'Pied custom', description: 'Intro' };
  const e2 = I.buildReglementEmbed(reg0b, guild);
  check('embed custom (titre/_couleur/foot/intro)', e2.data.title === 'Titre custom' && e2.data.description.startsWith('Intro') && e2.data.color === 0xFF0000 && e2.data.footer.text === 'Pied custom');

  // ─── 3. Panneau principal ────────────────────────────────────────────────────
  const panel = I.buildPanel(reg0, guild);
  const ids = panel.components.map(r => r.toJSON().components[0].custom_id);
  check('panneau : 5 rows', panel.components.length === 5, String(panel.components.length));
  check('panneau : menu d\'actions présent', ids.includes('regls_action') && ids.includes('regls_channel') && ids.includes('regls_role'));
  check('panneau : bouton publier', JSON.stringify(panel.components.map(r => r.toJSON())).includes('regl_publish'));

  // ─── 4. execute() affiche le panneau ─────────────────────────────────────────
  const it = makeInteraction();
  await cmd.execute(it);
  check('execute → panneau envoyé', it._replies.length === 1 && JSON.stringify(it._replies[0]).includes('Panneau du règlement'));
  check('execute → config créée en base', store.has(GUILD));

  // ─── 5. Menu d'actions ───────────────────────────────────────────────────────
  const itAdd = makeInteraction({ customId: 'regls_action', values: ['add'] });
  await cmd.handleSelect(itAdd);
  check('action add → modal montré', itAdd._shown.length === 1 && hasCustomId(itAdd._shown[0], 'reglm_add'));

  const itApp = makeInteraction({ customId: 'regls_action', values: ['app'] });
  await cmd.handleSelect(itApp);
  check('action app → modal apparence', itApp._shown.length === 1 && hasCustomId(itApp._shown[0], 'reglm_app'));

  const itEdit = makeInteraction({ customId: 'regls_action', values: ['edit'] });
  await cmd.handleSelect(itEdit);
  check('action edit → sous-panneau éditeur', itEdit._updates.length === 1 && JSON.stringify(itEdit._updates[0]).includes('Modifier une règle'));

  // ─── 6. Choix d'une règle → modal édition / confirmation ─────────────────────
  // (seed : le doc en base a été créé vide par execute() plus haut)
  store.get(GUILD).rules = ['Règle A', 'Règle B', 'Règle C'];
  const itEdit2 = makeInteraction({ customId: 'regls_edit', values: ['1'] });
  await cmd.handleSelect(itEdit2);
  check('regls_edit → modal prérempli', itEdit2._shown.length === 1
    && hasCustomId(itEdit2._shown[0], 'reglm_edit_1')
    && JSON.stringify(itEdit2._shown[0].toJSON()).includes('Règle B'));

  const itDel = makeInteraction({ customId: 'regls_del', values: ['0'] });
  await cmd.handleSelect(itDel);
  check('regls_del → confirmation', itDel._updates.length === 1 && JSON.stringify(itDel._updates[0]).includes('regl_del_0'));

  const itMv = makeInteraction({ customId: 'regls_mv', values: ['1'] });
  await cmd.handleSelect(itMv);
  check('regls_mv → boutons monter/descendre', itMv._updates.length === 1
    && JSON.stringify(itMv._updates[0]).includes('regl_up_1') && JSON.stringify(itMv._updates[0]).includes('regl_down_1'));

  // ─── 7. Salon / rôle via menus ───────────────────────────────────────────────
  const itCh = makeInteraction({ customId: 'regls_channel', values: ['chan_42'] });
  await cmd.handleSelect(itCh);
  check('regls_channel → channelId sauvegardé', store.get(GUILD).channelId === 'chan_42');

  const itRole = makeInteraction({ customId: 'regls_role', values: ['role_7'] });
  await cmd.handleSelect(itRole);
  check('regls_role → acceptRoleId sauvegardé', store.get(GUILD).acceptRoleId === 'role_7');

  // ─── 8. Modaux (ajout en masse, édition, apparence) ──────────────────────────
  store.get(GUILD).rules = []; // reset après les tests de sous-panneaux
  const fields = (get) => ({ getTextInputValue: get });
  const itModalAdd = makeInteraction({ customId: 'reglm_add' });
  itModalAdd.fields = fields(n => ({ regles: 'Pas de spam\nPas d\'insultes\nRespect du staff', mode: '' }[n]));
  await cmd.handleModal(itModalAdd);
  const afterAdd = store.get(GUILD).rules;
  check('modal add → 3 règles ajoutées', afterAdd.length === 3 && afterAdd[0] === 'Pas de spam', JSON.stringify(afterAdd));

  const itModalRep = makeInteraction({ customId: 'reglm_add' });
  itModalRep.fields = fields(n => ({ regles: 'Nouvelle 1\nNouvelle 2', mode: 'remplacer' }[n]));
  await cmd.handleModal(itModalRep);
  const afterRep = store.get(GUILD).rules;
  check('modal add mode remplacer → 2 règles', afterRep.length === 2 && afterRep[1] === 'Nouvelle 2', JSON.stringify(afterRep));

  const itModalEdit = makeInteraction({ customId: 'reglm_edit_0' });
  itModalEdit.fields = fields(n => ({ texte: 'Nouvelle 1 (éditée)' }[n]));
  await cmd.handleModal(itModalEdit);
  check('modal edit → règle #1 modifiée', store.get(GUILD).rules[0] === 'Nouvelle 1 (éditée)');

  const itModalApp = makeInteraction({ customId: 'reglm_app' });
  itModalApp.fields = fields(n => ({
    titre: 'Nos règles', intro: 'Bienvenue !', couleur: '#00ff88', footer: 'Respect obligatoire', label: 'Accepter ✅',
  }[n]));
  await cmd.handleModal(itModalApp);
  const afterApp = store.get(GUILD);
  check('modal app → apparence sauvegardée', afterApp.title === 'Nos règles' && afterApp.color === '#00FF88' && afterApp.acceptLabel === 'Accepter ✅', JSON.stringify({ c: afterApp.color, l: afterApp.acceptLabel }));

  // ─── 9. Boutons du panneau ───────────────────────────────────────────────────
  const itNum = makeInteraction({ customId: 'regl_numbering' });
  await cmd.handleButton(itNum);
  check('regl_numbering → toggle', store.get(GUILD).showNumbering === false);

  const itClr = makeInteraction({ customId: 'regl_role_clear' });
  await cmd.handleButton(itClr);
  check('regl_role_clear → rôle retiré', store.get(GUILD).acceptRoleId === null);

  const itDelBtn = makeInteraction({ customId: 'regl_del_0' });
  await cmd.handleButton(itDelBtn);
  check('regl_del → règle supprimée', store.get(GUILD).rules.length === 1 && store.get(GUILD).rules[0] === 'Nouvelle 2');

  const itUp = makeInteraction({ customId: 'regl_up_1' });
  await cmd.handleButton(itUp);
  check('regl_up → règle remontée', store.get(GUILD).rules[0] === 'Nouvelle 2');

  const itBack = makeInteraction({ customId: 'regl_back' });
  await cmd.handleButton(itBack);
  check('regl_back → panneau principal', itBack._updates.length === 1 && JSON.stringify(itBack._updates[0]).includes('Panneau du règlement'));

  // ─── 10. Publication (nouveau message + mise à jour) ─────────────────────────
  store.get(GUILD).channelId = 'chan_42';
  store.get(GUILD).acceptRoleId = 'role_7';
  const itPub = makeInteraction({ customId: 'regl_publish' });
  await cmd.handleButton(itPub);
  check('publish → nouveau message publié', store.get(GUILD).messageId === 'msg_new' && itPub._replies.length === 1
    && JSON.stringify(itPub._replies[0]).includes('publié'));

  // Mise à jour : ré-édite le message existant
  const channelSent = [];
  store.get(GUILD).rules.push('Règle ajoutée après publication');
  const itUpd = makeInteraction({ customId: 'regl_publish' });
  itUpd.guild.channels.fetch = async () => ({
    id: 'chan_42', isTextBased: () => true,
    send: async (p) => { channelSent.push(p); return { id: 'msg_x', url: 'u', edit: async () => {} }; },
    messages: { fetch: async () => ({ id: 'msg_new', url: 'https://discord.com/channels/x/y/msg_new', edit: async (p) => { channelSent.push(p); return {}; } }) },
  });
  await cmd.handleButton(itUpd);
  check('publish 2e fois → édite le message existant (pas de duplicate)', store.get(GUILD).messageId === 'msg_new' && itUpd._replies[0].embeds[0].data.title.includes('mis à jour'), JSON.stringify(itUpd._replies[0]?.embeds?.[0]?.data?.title || itUpd._replies[0]?.content || ''));

  // ─── 11. Bouton « J'accepte » ────────────────────────────────────────────────
  const itAcc = makeInteraction({ customId: 'reglement_accept' });
  const roleAddCalls = [];
  itAcc.member.roles.add = async (rid) => { roleAddCalls.push(rid); };
  await cmd.handleAccept(itAcc);
  check('handleAccept → rôle donné + compteur', roleAddCalls.includes('role_7') && store.get(GUILD).acceptCount === 1);

  const itAcc2 = makeInteraction({ customId: 'reglement_accept' });
  itAcc2.member.roles.cache = new Map([['role_7', {}]]);
  itAcc2.member.roles.add = async () => {};
  await cmd.handleAccept(itAcc2);
  check('handleAccept 2e fois → déjà accepté', itAcc2._replies[0].content.includes('déjà accepté'));

  // ─── 12. Aperçu ──────────────────────────────────────────────────────────────
  const itPrev = makeInteraction({ customId: 'regl_preview' });
  await cmd.handleButton(itPrev);
  check('regl_preview → aperçu envoyé', itPrev._replies.length === 1 && itPrev._replies[0].embeds[0].data.title === 'Nos règles');

  console.log(failures === 0 ? '\n🎉 Tous les tests règlement passent.' : `\n💥 ${failures} test(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { console.error('💥', err); process.exit(1); });
