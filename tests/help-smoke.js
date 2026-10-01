'use strict';
// tests/help-smoke.js — Smoke tests du panel d'aide v3
// Usage : node tests/help-smoke.js
process.env.NODE_ENV = 'test';

const fs = require('fs');
const cmd = require('../src/commands/utilitaires/help.js');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}

const payloadStr = (p) => { try { return JSON.stringify(p, (k, v) => typeof v === 'bigint' ? String(v) : v); } catch { return String(p); } };
const has = (p, s) => payloadStr(p).includes(s);

// ─── Mocks ───────────────────────────────────────────────────────────────────
let collectorHandlers = {};
function makeClient() {
  return {
    user: { displayAvatarURL: () => 'http://avatar.png' },
    application: null,
    uptime: 3 * 3600 * 1000,
    guilds: { cache: { size: 12, reduce: (fn, init) => [100, 50].reduce(fn, init) } },
  };
}

function makeInteraction(overrides = {}) {
  const i = {
    customId: '', values: [],
    client,
    user: { id: overrides.userId || 'author1', tag: 'author#1' },
    member: { permissions: { has: () => false } },
    guild: null, channel: { id: 'chan1' },
    fields: null,
    message: null,
    _replies: [], _updates: [], _shown: [],
    reply: async (p) => { i._replies.push(snap(p)); return { createMessageComponentCollector: () => ({ on: (e, fn) => { collectorHandlers[e] = fn; } }) }; },
    update: async (p) => { i._updates.push(snap(p)); },
    showModal: async (m) => { i._shown.push(snap(m)); },
    ...overrides,
  };
  return i;
}

const client = makeClient();

// Sérialise les payloads (builders → JSON Discord, snake_case) comme le ferait l'API
const snap = (p) => JSON.parse(JSON.stringify(p, (k, v) => typeof v === 'bigint' ? String(v) : v));

// ═════════════════════════════════════════════════════════════════════════════
// ══ A. Accueil & structure ═══════════════════════════════════════════════════
(async () => {
  collectorHandlers = {};
  const iHome = makeInteraction();
  await cmd.execute(iHome);

  const home = iHome._replies[0];
  check('A1 — accueil : 3 rangées, aucune > 5 composants', home.components.length === 3 && home.components.every(r => r.components.length <= 5), `rows=${home.components.length}`);
  check('A2 — accueil : menus catégorie + docs + barre d\'actions', has(home, 'help_category') && has(home, 'help_docs') && has(home, 'help_whatsnew'));
  check('A3 — accueil : boutique de composants (pas de doublons de custom_id)', (() => {
    const ids = home.components.map(r => r.components[0].custom_id);
    return new Set(ids).size === ids.length;
  })());
  check('A4 — accueil : mention des systèmes de sécurité', has(home, '/antiraid') && has(home, '/honeypot') && has(home, '/captcha'));

  // ══ B. Navigation catégories ═════════════════════════════════════════════
  const iCat = makeInteraction({ customId: 'help_category', values: ['bump'] });
  await cmd.handleSelect(iCat);
  const cat = iCat._updates[0];
  check('B1 — catégorie : titre + 3 rangées de nav', has(cat, 'Bump & Réseau') && cat.components.length === 3);
  check('B2 — catégorie : option active marquée', (() => {
    const opt = cat.components[0].components[0].options.find(o => o.value === 'bump');
    return opt && opt.default === true;
  })());
  check('B3 — catégorie : bouton Accueil présent (et plus le bouton Nouveautés)', has(cat, 'help_home') && !has(cat, 'help_whatsnew'));

  // ══ C. Navigation documentation ══════════════════════════════════════════
  const iDoc = makeInteraction({ customId: 'help_docs', values: ['securite'] });
  await cmd.handleDocsSelect(iDoc);
  const doc = iDoc._updates[0];
  check('C1 — doc sécurité : article affiché avec honeypot + antiraid', has(doc, 'Sécuriser votre serveur') && has(doc, '/honeypot') && has(doc, '/antiraid'));
  check('C2 — doc : option active marquée', doc.components[1].components[0].options.find(o => o.value === 'securite')?.default === true);

  const iHome2 = makeInteraction({ customId: 'help_home' });
  await cmd.handleHome(iHome2);
  check('C3 — retour accueil', has(iHome2._updates[0], 'Comment puis-je vous aider ?'));

  // ══ D. Nouveautés (bouton longtemps mort, désormais routé) ═══════════════
  const iNew = makeInteraction({ customId: 'help_whatsnew' });
  await cmd.handleWhatsNew(iNew);
  check('D1 — nouveautés : réponse éphémère avec /antiraid', has(iNew._replies[0], 'Nouveautés') && has(iNew._replies[0], '/antiraid'));

  // ══ E. Recherche ═════════════════════════════════════════════════════════
  const iSearchBtn = makeInteraction({ customId: 'help_search' });
  await cmd.handleSearchButton(iSearchBtn);
  check('E1 — bouton recherche : modale ouverte', iSearchBtn._shown.length === 1 && has(iSearchBtn._shown[0], 'help_search_modal'));

  const fields = (map) => ({ getTextInputValue: (id) => map[id] });
  const iSearch = makeInteraction({ fields: fields({ help_search_query: 'honeypot' }) });
  await cmd.handleSearchModal(iSearch);
  check('E2 — recherche « honeypot » : commande + doc trouvés', has(iSearch._replies[0], '/honeypot') && has(iSearch._replies[0], 'Résultats'));

  const iSearch2 = makeInteraction({ fields: fields({ help_search_query: 'warn' }) });
  await cmd.handleSearchModal(iSearch2);
  check('E3 — recherche « warn » : familles de commandes', has(iSearch2._replies[0], '/warn') );

  // Raccourci catégorie → mini-panel éphémère
  const iAlias = makeInteraction({ fields: fields({ help_search_query: 'securite' }) });
  await cmd.handleSearchModal(iAlias);
  const aliasReply = iAlias._replies[0];
  check('E4 — raccourci « securite » : panel de catégorie renvoyé', has(aliasReply, 'Modération & Sécurité') && aliasReply.components.length === 3);

  const iNone = makeInteraction({ fields: fields({ help_search_query: 'zxqvwynull123' }) });
  await cmd.handleSearchModal(iNone);
  check('E5 — recherche sans résultat : message clair', has(iNone._replies[0], 'Aucun résultat'));

  // ══ F. Découverte aléatoire ═══════════════════════════════════════════════
  const iRand = makeInteraction({ customId: 'help_random' });
  await cmd.handleRandomButton(iRand);
  check('F1 — découvrir : réponse éphémère', has(iRand._replies[0], 'Le savais-tu'));

  // ══ G. Sécurité des composants ═══════════════════════════════════════════
  const iHacker = makeInteraction({
    customId: 'help_category', values: ['bump'], userId: 'hacker',
    message: { interactionMetadata: { user: { id: 'author1' } } },
  });
  await cmd.handleSelect(iHacker);
  check('G1 — non-auteur : refusé', has(iHacker._replies[0], 'ne t\'appartient pas'));

  const iStaff = makeInteraction({
    customId: 'help_category', values: ['bump'], userId: 'staff1',
    message: { interactionMetadata: { user: { id: 'author1' } } },
    member: { permissions: { has: (p) => p === 'ManageGuild' } },
  });
  await cmd.handleSelect(iStaff);
  check('G2 — staff : autorisé', iStaff._updates.length === 1);

  // ══ H. Cohérence des routes interactionCreate ════════════════════════════
  const routesSrc = fs.readFileSync(require.resolve('../src/events/core/interactionCreate.js'), 'utf8');
  check('H1 — routeur : help_whatsnew routé', routesSrc.includes("'help_whatsnew'"));
  check('H2 — routeur : help_home/search/random routés', routesSrc.includes("'help_home'") && routesSrc.includes("'help_search'") && routesSrc.includes("'help_random'"));
  check('H3 — routeur : ancien guide help_guide_* retiré', !routesSrc.includes('help_guide'));
  check('H4 — routeur : help_category/help_docs/help_search_modal routés', routesSrc.includes("'help_category'") && routesSrc.includes("'help_docs'") && routesSrc.includes("'help_search_modal'"));

  // ══ I. Aucun handler hérité du guide (mort) ══════════════════════════════
  check('I1 — help : pas de handler guide résiduel', !cmd.handleGuideStart && !cmd.handleGuideStep && !cmd.handleGuideNav);

  console.log(failures === 0 ? '\n✅ TOUS LES TESTS PASSENT' : `\n💥 ${failures} ÉCHEC(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => { console.error('💥 Erreur fatale :', err); process.exit(1); });
