// tests/prefix-smoke.js — Test du moteur de préfixe hybride
// Usage : node tests/prefix-smoke.js
process.env.NODE_ENV = 'test';

const {
  parseArgs, resolveCommand, hydrateOptions, makeFakeInteraction, buildUsage,
} = require('../src/utils/prefixCommands');
const { MessageFlags } = require('discord.js');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}

// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockClient = {
  user: { id: '111111111111111111', username: 'Bumpify' },
  commands: new Map(),
};

function fakeCommand(name, buildOpts) {
  const data = {
    name,
    description: `test ${name}`,
    options: buildOpts,
  };
  return {
    data: { toJSON: () => data },
    execute: async () => {},
  };
}

// Commandes de test
mockClient.commands.set('ping', fakeCommand('ping', []));
mockClient.commands.set('ban', fakeCommand('ban', [
  { name: 'utilisateur', type: 6, required: true },
  { name: 'raison', type: 3, required: false },
]));
mockClient.commands.set('welcome', fakeCommand('welcome', [
  { name: 'panel', type: 1, options: [] },
  { name: 'test', type: 1, options: [{ name: 'style', type: 3, required: false }] },
]));
mockClient.commands.set('chooser', fakeCommand('chooser', [
  { name: 'mode', type: 3, required: true, choices: [
    { name: 'Attaque', value: 'attack' },
    { name: 'Défense', value: 'defense' },
  ] },
]));
mockClient.commands.set('multi', fakeCommand('multi', [
  { name: 'un', type: 1, options: [] },
  { name: 'deux', type: 1, options: [] },
]));

// ─── 1. Parsing d'arguments ───────────────────────────────────────────────────
const a1 = parseArgs('"Jean Dupont" raid');
check('parse guillemets', a1.length === 2 && a1[0] === 'Jean Dupont' && a1[1] === 'raid');
const a2 = parseArgs("config  bump  set");
check('parse espaces multiples', a2.length === 3 && a2[0] === 'config' && a2[2] === 'set');
const a3 = parseArgs('say \'hello world\'');
check('parse apostrophes', a3.length === 2 && a3[1] === 'hello world');

// ─── 2. Résolution de commandes ───────────────────────────────────────────────
const r1 = resolveCommand(mockClient, ['ping']);
check('commande simple', r1?.json.name === 'ping' && r1?.rest.length === 0);

const r2 = resolveCommand(mockClient, ['ban', '123456789012345678', 'raid']);
check('commande + args', r2?.json.name === 'ban' && r2?.rest.length === 2);

const r3 = resolveCommand(mockClient, ['welcome', 'panel']);
check('sous-commande explicite', r3?.subName === 'panel' && r3?.rest.length === 0);

const r4 = resolveCommand(mockClient, ['welcome', 'test', 'gradient']);
check('sous-commande + arg', r4?.subName === 'test' && r4?.rest.length === 1);

const r5 = resolveCommand(mockClient, ['multi']);
check('sous-commandes multiples sans sub → rootOpts null', r5 !== null && r5.rootOpts === null);

const r6 = resolveCommand(mockClient, ['inexistante']);
check('commande inconnue → null', r6 === null);

const r7 = resolveCommand(mockClient, ['chooser', 'attack']);
check('choix fixes : commande résolue', r7?.json.name === 'chooser');

// ─── 3. Hydratation des options ───────────────────────────────────────────────
const mockGuild = {
  id: '999999999999999999',
  members: { cache: { get: () => null, find: () => null }, fetch: async () => null, search: async () => ({ first: () => null }) },
  channels: { cache: { get: () => null, find: () => null } },
  roles: {
    cache: { get: () => null, find: (fn) => [{ id: '888888888888888888', name: 'Modo' }].find(fn) || null },
  },
  preferredLocale: 'fr',
};
const mockMessage = {
  author: { id: '222222222222222222', send: async () => ({}) },
  member: null,
  guild: mockGuild,
  guildId: mockGuild.id,
  channel: { send: async (p) => ({ edit: async () => {}, id: 'm1' }), sendTyping: async () => {} },
  content: '',
  id: 'm1',
  reply: async () => ({}),
};

async function testHydration() {
  const { hydrateOptions } = require('../src/utils/prefixCommands');

  // ban <@678…> raid
  const fake1 = makeFakeInteraction({
    message: mockMessage, client: mockClient, cfg: { showHint: false, prefix: 'b!' },
    commandName: 'ban', groupName: null, subName: null, resolvedOpts: [],
  });
  const cmd = resolveCommand(mockClient, ['ban', '<@678888888888888888>', 'raid']);
  const h1 = await hydrateOptions(fake1, cmd.rootOpts, cmd.rest);
  check('hydratation user par mention', h1.missing.length === 1 && h1.missing[0] === 'utilisateur', JSON.stringify(h1));
  // (le membre n'existe pas dans le cache mock → missing, comportement attendu)

  // ban sans argument → missing
  const cmd2 = resolveCommand(mockClient, ['ban']);
  const h2 = await hydrateOptions(fake1, cmd2.rootOpts, cmd2.rest);
  check('hydratation manquant requis', h2.missing.includes('utilisateur'));

  // int / bool / string
  const intCmd = fakeCommand('levels', [
    { name: 'page', type: 4, required: true },
    { name: 'verbose', type: 5, required: false },
    { name: 'note', type: 3, required: false },
  ]);
  const h3 = await hydrateOptions(fake1, intCmd.data?.options || [
    { name: 'page', type: 4, required: true },
    { name: 'verbose', type: 5, required: false },
    { name: 'note', type: 3, required: false },
  ], ['3', 'oui', 'salut']);
  check('hydratation int/bool/string', h3.resolved[0].value === 3
    && h3.resolved[1].value === true
    && h3.resolved[2].value === 'salut', JSON.stringify(h3.resolved));

  // rôle par nom
  const roleCmd = fakeCommand('addrole', [{ name: 'role', type: 8, required: true }]);
  const h4 = await hydrateOptions(fake1, roleCmd.data?.options || [{ name: 'role', type: 8, required: true }], ['Modo']);
  check('hydratation rôle par nom', h4.resolved[0]?.value === '888888888888888888', JSON.stringify(h4.resolved));

  // choix fixes : par valeur, par libellé, casse mixte, invalide
  const chOpts = [{
    name: 'mode', type: 3, required: true,
    choices: [
      { name: 'Attaque', value: 'attack' },
      { name: 'Défense', value: 'defense' },
    ],
  }];
  const chCmd = fakeCommand('chooser', chOpts);
  const c1 = await hydrateOptions(fake1, chOpts, ['attack']);
  check('choix par valeur', c1.resolved[0]?.value === 'attack' && c1.choiceErrors.length === 0, JSON.stringify(c1));
  const c2 = await hydrateOptions(fake1, chOpts, ['défense']);
  check('choix par libellé (casse/accents)', c2.resolved[0]?.value === 'defense', JSON.stringify(c2));
  const c3 = await hydrateOptions(fake1, chOpts, ['magie']);
  check('choix invalide → erreur', c3.resolved.length === 0 && c3.choiceErrors.length === 1 && c3.choiceErrors[0].name === 'mode', JSON.stringify(c3));
}

// ─── 4. Fausse interaction ────────────────────────────────────────────────────
async function testFakeInteraction() {
  const sent = [];
  const dmSent = [];
  const msg = {
    ...mockMessage,
    channel: { send: async (p) => { sent.push(p); return { edit: async () => {} }; }, sendTyping: async () => {} },
    author: { id: '222', send: async (p) => { dmSent.push(p); return {}; } },
  };

  const fake = makeFakeInteraction({
    message: msg, client: mockClient, cfg: { showHint: true, prefix: 'b!' },
    commandName: 'ping', groupName: null, subName: null, resolvedOpts: [],
  });

  check('getSubcommand() sans sub → undefined/null', fake.options.getSubcommand() == null);
  check('isChatInputCommand', fake.isChatInputCommand() === true);
  check('inGuild', fake.inGuild() === true);

  // reply éphémère → MP
  await fake.reply({ content: 'secret', ephemeral: true });
  check('reply éphémère → MP', dmSent.length === 1 && dmSent[0].content === 'secret', JSON.stringify(dmSent));
  check('reply ajoute l\'indice préfixe', dmSent[0].embeds?.length === 1);

  // double reply → erreur
  let threw = false;
  try { await fake.reply({ content: 'x' }); } catch { threw = true; }
  check('double reply lève', threw);

  // followUp sans reply préalable sur une nouvelle interaction
  const fake2 = makeFakeInteraction({
    message: msg, client: mockClient, cfg: { showHint: false, prefix: 'b!' },
    commandName: 'ping', groupName: null, subName: null, resolvedOpts: [],
  });
  await fake2.deferReply({ ephemeral: true });
  await fake2.editReply({ content: 'après defer' });
  check('defer éphémère puis editReply → MP', dmSent.length === 2 && dmSent[1].content === 'après defer');
  check('deferReply suit le pattern discord.js', fake2.deferred === true);

  // followUp public
  const fake3 = makeFakeInteraction({
    message: msg, client: mockClient, cfg: { showHint: false, prefix: 'b!' },
    commandName: 'ping', groupName: null, subName: null, resolvedOpts: [],
  });
  await fake3.reply({ content: 'premier' });
  await fake3.followUp({ content: 'second' });
  check('followUp public → salon', sent.some(p => p.content === 'second'));
}

// ─── 5. buildUsage ────────────────────────────────────────────────────────────
const json = { name: 'ban' };
const usage = buildUsage('b!', json, null, null, [{ name: 'utilisateur', type: 6, required: true }, { name: 'raison', type: 3, required: false }]);
check('buildUsage', usage.includes('b!ban <utilisateur> [raison]'), usage);

(async () => {
  await testHydration();
  await testFakeInteraction();
  console.log(failures === 0 ? '\n🎉 Tous les tests préfixe passent.' : `\n💥 ${failures} test(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
})();
