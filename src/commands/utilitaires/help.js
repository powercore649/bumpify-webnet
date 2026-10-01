const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { getAppEmoji } = require('../../utils/emojiSync');

const SITE_URL    = 'https://zyntra.dpdns.org';
const SUPPORT_URL = 'https://discord.gg/ts5mh326ew';

const CATEGORIES = {
  bump: {
    emoji: '🚀',
    label: 'Bump & Réseau',
    color: 0x5865F2,
    blurb: 'Faites connaître votre serveur à travers tout le réseau Bumpify.',
    commands: [
      { name: '/bump',        desc: 'Bumper votre serveur (cooldown : 2h)' },
      { name: '/bump-notif',  desc: 'Panel avancé des notifications de rappel de bump *(Admin)*' },
      { name: '/bump-historique', desc: 'Consulter l\'historique complet de vos bumps 📜' },
      { name: '/stats',       desc: 'Statistiques globales + top bumpers' },
      { name: '/leaderboard', desc: 'Classement des bumpers du serveur' },
      { name: '/interserveur',desc: 'Gérer le chat inter-serveurs' },
      { name: '/topserveurs',  desc: 'Classement des serveurs du réseau' },
      { name: '/network',      desc: 'Statistiques globales du réseau Bumpify' },
      { name: '/bumpadmin',   desc: 'Administration du réseau (owners)' },
      { name: '/territoires', desc: 'Guerre de territoires inter-serveurs ⚔️' },
      { name: '/serverstats', desc: 'Graphique d\'activité du serveur' },
      { name: '/serveurdujour', desc: 'Découvre le serveur mis en avant du jour ⭐' },
      { name: '/tags',        desc: 'Catégories les plus utilisées sur le réseau 🏷️' },
      { name: '/comparer',    desc: 'Compare deux serveurs côte à côte ⇄' },
      { name: '/twitch',      desc: 'Explorer Twitch — top streams, recherche, fiche streamer 🟣' },
      { name: '/streamalerts',desc: 'Panel d\'alertes Twitch/YouTube pour votre serveur *(Admin)*' },
    ],
  },
  moderation: {
    emoji: '🛡️',
    label: 'Modération',
    color: 0xED4245,
    blurb: 'Gardez votre serveur sain : sanctions, anti-raid, logs. `/ban`, `/kick`, `/raidmode` et `/forceleave` se verrouillent automatiquement derrière votre PIN si vous en avez configuré un via `/auth-profil`.',
    commands: [
      { name: '/ban',     desc: 'Bannir un membre' },
      { name: '/tempban', desc: 'Bannir temporairement un membre' },
      { name: '/kick',    desc: 'Expulser un membre' },
      { name: '/mute',    desc: 'Rendre muet un membre' },
      { name: '/unmute',  desc: 'Rétablir la parole d\'un membre' },
      { name: '/warn',    desc: 'Avertir un membre' },
      { name: '/warns',   desc: 'Voir les avertissements d\'un membre' },
      { name: '/warnconfig', desc: 'Configurer les paliers d\'avertissements (auto à N warns) *(Admin)*' },
      { name: '/sanction',desc: 'Système de strikes gradués (auto mute/kick)' },
      { name: '/clear',   desc: 'Supprimer des messages en masse' },
      { name: '/purge',   desc: 'Suppression avancée (par membre, mot, bots)' },
      { name: '/lock',    desc: 'Verrouiller un salon' },
      { name: '/unlock',  desc: 'Déverrouiller un salon' },
      { name: '/slowmode',desc: 'Définir le slowmode d\'un salon' },
      { name: '/raidmode',desc: 'Mode anti-raid d\'urgence, activation manuelle *(Admin)*' },
      { name: '/antiraid',     desc: 'Protection anti-raid complète : détection, quarantaine, honeypots, verrouillage *(Admin)*' },
      { name: '/massrole',desc: 'Ajouter/retirer un rôle en masse' },
      { name: '/note',    desc: 'Notes privées sur un membre' },
      { name: '/logs',    desc: 'Journal de modération récent' },
      { name: '/whois',   desc: 'Profil de modération complet' },
      { name: '/userhistory', desc: 'Historique complet (warns + notes)' },
      { name: '/modlog',  desc: 'Configurer les logs de modération' },
      { name: '/automod', desc: 'Anti-spam, anti-raid, anti-liens *(Admin)*' },
      { name: '/securite', desc: 'Panneau de contrôle sécurité — Captcha, Anti-Spam, Anti-Raid *(Admin)*' },
      { name: '/antiscam', desc: 'Panneau anti-arnaque par image (OCR + détection de texte) *(Admin)*' },
    ],
  },
  config: {
    emoji: '⚙️',
    label: 'Configuration',
    color: 0x99AAB5,
    blurb: 'Tout ce qu\'il faut pour mettre Bumpify à votre image.',
    commands: [
      { name: '/panel',       desc: 'Panel de configuration central *(Admin)*' },
      { name: '/config',      desc: 'Config bump (description, salons…) *(Admin)*' },
      { name: '/captcha',     desc: 'Système de vérification à l\'arrivée *(Admin)*' },
      { name: '/prefix',      desc: 'Préfixe de commandes personnalisé (système hybride b!commande) *(Admin)*' },
      { name: '/license',     desc: 'Activer la clé de licence (système complet : bump, inter-serveur…) *(Admin)*' },
      { name: '/welcome',     desc: 'Bienvenue+ : panneau complet (message, image, MP, boutons, compteur, stats) *(Admin)*' },
      { name: '/farewell-set',desc: 'Au revoir : panneau complet (message, embed, image canvas) *(Admin)*' },
      { name: '/autorole',    desc: 'Rôles automatiques (join, niveau, ancienneté)' },
      { name: '/backup',      desc: 'Sauvegarder / restaurer le serveur' },
      { name: '/reglement',   desc: 'Règlement interactif avec acceptation' },
      { name: '/faq',         desc: 'Questions fréquentes du serveur' },
      { name: '/autosalon',   desc: 'Messages récurrents automatiques' },
      { name: '/autothread',  desc: 'Threads automatiques configurables' },
      { name: '/forumwelcome',desc: 'Message d\'accueil auto sur les nouveaux posts Forum 🗂️' },
      { name: '/logsconfig',  desc: 'Logs configurables (modération, membres, messages, vocal)' },
      { name: '/xpconfig',    desc: 'XP configurable (multiplicateurs, récompenses, message)' },
      { name: '/export',      desc: 'Exporter les données serveur en JSON *(Admin)*' },
      { name: '/premium',     desc: 'Statut Premium gratuit du serveur 💎' },
      { name: '/leaderboardconfig', desc: 'Classement automatique (type, publication périodique) *(Admin)*' },
      { name: '/reputation config', desc: 'Configurer le système de réputation entre membres *(Admin)*' },
      { name: '/partenariat-config', desc: 'Configurer les annonces automatiques de partenariat *(Admin)*' },
      { name: '/invites-config', desc: 'Configurer le système d\'invitations avancé (salon, messages, anti-fake, rôles bonus) *(Admin)*' },
      { name: '/welcome-image', desc: 'Prévisualiser les 4 styles d\'images de bienvenue canvas *(Admin)*' },
    ],
  },
  economy: {
    emoji: '💰',
    label: 'Économie & Jeux',
    color: 0xFEE75C,
    blurb: 'Coins, paris et mini-jeux pour faire vivre votre communauté.',
    commands: [
      { name: '/balance', desc: 'Voir votre solde de coins' },
      { name: '/daily',   desc: 'Réclamer votre récompense quotidienne' },
      { name: '/work',    desc: 'Travailler pour gagner des coins (1h)' },
      { name: '/rob',     desc: 'Tenter de voler un membre (risqué)' },
      { name: '/fish',    desc: 'Pêcher pour gagner des coins' },
      { name: '/fishshop',desc: 'Boutique de cannes à pêche' },
      { name: '/fishboard',desc: 'Classement des meilleurs pêcheurs' },
      { name: '/slots',   desc: 'Machine à sous 🎰' },
      { name: '/blackjack',desc: 'Blackjack contre le bot 🃏' },
      { name: '/give',    desc: 'Donner des coins à un membre' },
      { name: '/shop',    desc: 'Boutique du serveur (rôles, badges, perks)' },
    ],
  },
  xp: {
    emoji: '🏆',
    label: 'Niveaux & XP',
    color: 0xEB459E,
    blurb: 'Récompensez l\'activité de vos membres.',
    commands: [
      { name: '/xp rank',        desc: 'Voir ton niveau et ton XP' },
      { name: '/xp leaderboard', desc: 'Top 10 des membres les plus actifs' },
      { name: '/xp reset',       desc: 'Réinitialiser l\'XP d\'un membre *(Admin)*' },
      { name: '/rank',           desc: 'Carte de rang visuelle (canvas)' },
    ],
  },
  community: {
    emoji: '🎉',
    label: 'Communauté',
    color: 0x57F287,
    blurb: 'Animez votre serveur : événements, sondages, tickets.',
    commands: [
      { name: '/giveaway',  desc: 'Créer et gérer des giveaways' },
      { name: '/poll',      desc: 'Créer un sondage simple' },
      { name: '/sondage',   desc: 'Sondage avancé multi-options (anonyme)' },
      { name: '/avis',       desc: 'Système d\'avis complet — noter, voir, top, stats, répondre *(Admin pour répondre)*' },
      { name: '/avis-panel', desc: 'Panel de configuration avancé du système d\'avis *(Admin)*' },
      { name: '/confession',desc: 'Envoyer une confession anonyme' },
      { name: '/ticket',    desc: 'Ouvrir un ticket de support' },
      { name: '/invites',   desc: 'Voir vos invitations' },
      { name: '/invites-avance', desc: 'Classement, stats détaillées et bonus d\'invitations 🔗' },
      { name: '/members',   desc: 'Nombre de membres du serveur' },
      { name: '/todo',      desc: 'Liste de tâches partagée du serveur' },
      { name: '/event',     desc: 'Créer et gérer des événements' },
      { name: '/badge',     desc: 'Système de badges personnalisés' },
      { name: '/announce',  desc: 'Envoyer une annonce dans un salon' },
      { name: '/reputation',desc: 'Donner / voir / classer la réputation entre membres ⭐' },
      { name: '/partenariat', desc: 'Enregistrer un partenariat effectué + annonce auto 🤝' },
      { name: '/anniversaire', desc: 'Définir sa date d\'anniversaire, voir la liste des prochains 🎂' },
      { name: '/anniversaire-config', desc: 'Configurer le système d\'anniversaires *(Admin)*' },
      { name: '/modmail', desc: 'Envoyer un message privé au staff via le bot 📬' },
      { name: '/news', desc: 'Actualités françaises automatiques dans un salon 📰' },
    ],
  },
  utility: {
    emoji: '🔧',
    label: 'Utilitaires',
    color: 0x5BC0EB,
    blurb: 'Informations pratiques et outils du quotidien.',
    commands: [
      { name: '/server-info',  desc: 'Informations sur le serveur' },
      { name: '/user-info',    desc: 'Informations sur un utilisateur' },
      { name: '/channelinfo',  desc: 'Informations sur un salon' },
      { name: '/avatar',       desc: 'Afficher l\'avatar d\'un utilisateur' },
      { name: '/profile',      desc: 'Voir votre profil Bumpify' },
      { name: '/auth-profil',  desc: 'Protéger votre compte avec un PIN, la 2FA et des Passkeys 🔐' },
      { name: '/editprofile',  desc: 'Personnaliser ton profil (bio, couleur)' },
      { name: '/profilecustom',desc: 'Personnaliser la carte de profil (fond, accent, badges) 🎨' },
      { name: '/banner',       desc: 'Bannière de profil visuelle (canvas)' },
      { name: '/servercard',   desc: 'Carte visuelle du serveur (canvas)' },
      { name: '/roles',        desc: 'Liste des rôles du serveur' },
      { name: '/embed',        desc: 'Créer un embed personnalisé' },
      { name: '/reminder',     desc: 'Rappel personnel via DM' },
      { name: '/snipe',        desc: 'Dernier message supprimé du salon' },
      { name: '/color',        desc: 'Infos sur une couleur hex' },
      { name: '/ping',         desc: 'Latence du bot' },
      { name: '/ai-playground', desc: 'Créer/gérer le salon de chat IA avec bascule automatique de modèle *(Admin)*' },
      { name: '/demande-mp',   desc: 'Configurer le salon "Demande de MP" (embed + fil automatique) *(Admin)*' },
      { name: '/uptime',       desc: 'Temps en ligne du bot' },
      { name: '/botinfo',      desc: 'Informations sur Bumpify' },
      { name: '/activity',     desc: 'Statistiques Discord en temps réel avec graphique 📊' },
      { name: '/changelog',    desc: 'Historique des mises à jour du bot' },
      { name: '/notifications',desc: 'Notifications du serveur + fil personnel en temps réel 🔔' },
      { name: '/botwatch-config', desc: 'Surveiller un autre bot (en ligne/hors ligne) *(Admin)*' },
    ],
  },
  fun: {
    emoji: '🎲',
    label: 'Fun',
    color: 0xF47B67,
    blurb: 'Un peu de légèreté entre deux bumps.',
    commands: [
      { name: '/8ball',    desc: 'Poser une question à la boule magique' },
      { name: '/roll',     desc: 'Lancer un dé' },
      { name: '/coinflip', desc: 'Pile ou face' },
      { name: '/joke',     desc: 'Blague avec chute cachée, catégories et notation 👍👎' },
      { name: '/rps',      desc: 'Pierre-Papier-Ciseaux contre le bot' },
      { name: '/meteo',    desc: 'Météo actuelle d\'une ville 🌤️' },
      { name: '/mathquiz', desc: 'Quiz maths — gagne des coins' },
      { name: '/planet',   desc: 'Créez et faites grandir votre propre planète 🌍' },
      { name: '/waifu',    desc: 'Image anime aléatoire' },
      { name: '/duel',     desc: 'Duel visuel animé contre un membre ⚔️' },
      { name: '/freegames',desc: 'Jeux gratuits du moment — Epic, Steam, GamerPower 🎮' },
      { name: '/imagine',  desc: 'Génère une image IA gratuitement et sans limite 🎨' },
    ],
  },
  owner: {
    emoji: '🔑',
    label: 'Propriétaire du Bot',
    color: 0x2C2F33,
    blurb: 'Commandes réservées aux propriétaires de Bumpify (pas aux admins de serveur).',
    commands: [
      { name: '/premium-admin', desc: 'Gérer le Premium d\'un serveur' },
      { name: '/license-admin', desc: 'Générer et gérer les clés de licence 🔑' },
      { name: '/blacklist',     desc: 'Blacklist globale : aucun module ne répond sur ces serveurs ⛔' },
      { name: '/status',        desc: 'Configurer le statut affiché par le bot 🤖' },
      { name: '/forceleave',    desc: 'Force le bot à quitter un serveur' },
    ],
  },
};

const TOTAL_COMMANDS = Object.values(CATEGORIES).reduce((n, c) => n + c.commands.length, 0);
const ALL_COMMANDS_FLAT = Object.entries(CATEGORIES).flatMap(([key, cat]) =>
  cat.commands.map(c => ({ ...c, categoryKey: key, categoryLabel: cat.label, categoryEmoji: cat.emoji }))
);

// ─── Centre de documentation — articles longs, pas juste des one-liners ──────
const DOCS = {
  demarrage: {
    emoji: '🚀',
    title: 'Premiers pas avec Bumpify',
    related: ['/panel', '/config', '/captcha', '/bump'],
    body: [
      '**1. Configurez votre serveur** avec `/config` — description, invitation, salon de bump, salon feed. C\'est ce qui s\'affiche aux autres serveurs du réseau.',
      '**2. Protégez les arrivées** avec `/captcha` ou le portail `/onboarding` si vous voulez poser des questions avant l\'accès.',
      '**3. Rejoignez le réseau** avec `/bump` (cooldown de 2h) — votre serveur apparaît alors dans le salon feed de tous les autres serveurs connectés.',
      '**4. Explorez `/panel`** — c\'est le point d\'entrée central pour configurer la majorité des modules directement, sans taper de commande à chaque fois.',
    ].join('\n\n'),
  },
  permissions: {
    emoji: '🔑',
    title: 'Permissions dont Bumpify a besoin',
    related: ['/botinfo', '/server-info'],
    body: [
      'Pour fonctionner correctement, le rôle de Bumpify a besoin (selon les modules que vous utilisez) de :',
      '`Gérer les salons` — création des salons piège, forums, portail d\'accès, threads automatiques.',
      '`Gérer les rôles` — attribution des rôles auto, niveaux, invitations, portail d\'accès (rôle non-vérifié).',
      '`Gérer les messages` — modération, auto-thread, honeypot.',
      '`Expulser/Bannir des membres` — modération, anti-raid, honeypot, portail d\'accès avec délai limite.',
      '`Créer des threads publics` — auto-thread, accueil des forums.',
      '',
      '⚠️ Le rôle de Bumpify doit être positionné **au-dessus** de tous les rôles qu\'il doit pouvoir gérer, dans les paramètres de rôles du serveur.',
    ].join('\n'),
  },
  securite: {
    emoji: '🛡️',
    title: 'Sécuriser votre serveur',
    related: ['/captcha', '/securite', '/honeypot', '/onboarding', '/raidmode'],
    body: [
      '**Captcha** (`/captcha`) — vérification humaine à l\'arrivée, réglages fins (rôles, délai, salon).',
      '**Sécurité générale** (`/securite`) — dashboard tout-en-un : anti-spam, anti-raid, anti-liens.',
      '**Honeypot** (`/honeypot`) — salon et bouton piège : quiconque écrit dedans ou clique dessus est sanctionné automatiquement (mute/kick/ban).',
      '**Portail d\'accès** (`/onboarding`) — pose des questions obligatoires avant de donner accès au serveur, avec expulsion automatique si personne ne répond dans le délai.',
      '**Anti-raid** (`/antiraid`) — détection des raids de masse et wave raids, quarantaine automatique, honeypots, réponse auto (captcha/kick/verrouillage) et statut en direct.',
      '',
      'Ces systèmes sont indépendants et peuvent être combinés (ex: portail d\'accès + captcha en plus).',
    ].join('\n'),
  },
  onboarding: {
    emoji: '🚪',
    title: 'Le portail d\'accès (Onboarding)',
    related: ['/onboarding'],
    body: [
      'Crée un salon privé pour chaque nouveau membre, lui pose une série de questions (texte libre ou choix multiples), et ne lui donne accès au reste du serveur qu\'une fois terminé.',
      '',
      '**À l\'activation**, Bumpify verrouille automatiquement tous les salons existants pour les membres non-vérifiés — pas besoin de le faire à la main.',
      '**Questions** : illimitées (max 15), marquables optionnelles (bouton "Passer"), texte libre ou à choix (jusqu\'à 5 boutons).',
      '**Délai limite** : configurable, avec expulsion automatique si le membre ne répond jamais.',
      '**À la fin** : rôle non-vérifié retiré, rôle d\'accès optionnel accordé, salon supprimé (ou verrouillé) automatiquement.',
    ].join('\n'),
  },
  panel: {
    emoji: '⚙️',
    title: 'Le panel de configuration central',
    related: ['/panel'],
    body: [
      '`/panel` centralise la configuration de la majorité des modules du bot, organisés en 4 catégories : Général, Sécurité & Modération, Communauté, Support & Autres.',
      '',
      'Les modules marqués comme "embarquables" s\'ouvrent **directement dans le panel**, sans taper de commande. Les modules avec plusieurs réglages (bienvenue, boutique...) utilisent des sous-commandes dédiées — le panel vous indique laquelle taper.',
    ].join('\n'),
  },
  xp: {
    emoji: '🏆',
    title: 'Niveaux & XP',
    related: ['/leveling', '/leaderboardconfig'],
    body: [
      'Les membres gagnent de l\'XP en discutant. `/leveling` permet de configurer les paliers, les rôles de récompense par niveau, et les salons/messages ignorés.',
      '`/leaderboardconfig` définit le classement affiché par défaut (XP total, niveau, activité récente...).',
    ].join('\n'),
  },
  depannage: {
    emoji: '🩺',
    title: 'Dépannage — problèmes courants',
    related: ['/botinfo', '/ping'],
    body: [
      '**Le bot ne répond pas à une commande ?** Vérifiez qu\'il a la permission `Envoyer des messages` dans le salon, et que la commande n\'est pas restreinte à un rôle.',
      '**"Permissions manquantes" ?** Le rôle de Bumpify doit être placé au-dessus des rôles qu\'il doit gérer (voir l\'article Permissions).',
      '**Un salon créé automatiquement n\'apparaît pas ?** Vérifiez que le bot a bien `Gérer les salons`, et que la catégorie configurée existe toujours.',
      '**Un module semble actif mais ne fait rien ?** Vérifiez qu\'un salon/rôle est bien sélectionné dans son panel — beaucoup de modules restent inactifs tant qu\'ils manquent une configuration essentielle.',
      '**Besoin d\'aide humaine ?** Rejoignez le support via le bouton en bas du menu d\'aide.',
    ].join('\n'),
  },
  faq: {
    emoji: '❓',
    title: 'Foire aux questions',
    related: ['/premium-admin', '/bump'],
    body: [
      '**Le cooldown de `/bump` est de combien de temps ?** 2 heures.',
      '**Puis-je utiliser plusieurs systèmes de sécurité en même temps ?** Oui, captcha, honeypot, portail d\'accès et anti-raid sont indépendants et cumulables.',
      '**Comment supprimer un salon créé par le bot ?** Supprimez-le normalement depuis Discord ; le bot ne le recréera pas sauf nouvelle configuration.',
      '**Le bot est-il gratuit ?** Oui, avec des options Premium supplémentaires — voir `/premium-admin` ou le site web.',
    ].join('\n'),
  },
};

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}j ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Page d'accueil ───────────────────────────────────────────────────────────
function buildMainEmbed(client) {
  const grid = Object.values(CATEGORIES)
    .map(c => `${c.emoji} **${c.label}**\n╰ ${c.commands.length} commande${c.commands.length > 1 ? 's' : ''}`);

  const eRocket = getAppEmoji(client, 'bumpify_rocket') || '🚀';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: 'Bumpify — Centre d\'aide', iconURL: client.user.displayAvatarURL() })
    .setTitle('📖 Comment puis-je vous aider ?')
    .setDescription(
      `> Faites découvrir votre serveur en le bumpant toutes les **2 heures** ! ${eRocket}\n` +
      '> Vos bumps sont diffusés dans le salon feed de **tout le réseau Bumpify**.\n\n' +
      `Sélectionnez une catégorie dans le menu ci-dessous pour explorer les **${TOTAL_COMMANDS} commandes** disponibles, ou utilisez les boutons pour chercher une commande précise.`
    )
    .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: '​', value: grid.slice(0, Math.ceil(grid.length / 2)).join('\n\n'), inline: true },
      { name: '​', value: grid.slice(Math.ceil(grid.length / 2)).join('\n\n'), inline: true },
    )
    .addFields({
      name: '⚡ Démarrage rapide',
      value: '`1.` `/panel` → vue complète de la configuration\n`2.` `/config` → décrivez votre serveur\n`3.` `/captcha` → protégez les arrivées\n`4.` `/bump` → rejoignez le réseau !',
    })
    .addFields({
      name: '📊 En ce moment',
      value: `${client.guilds.cache.size.toLocaleString()} serveurs · ${client.guilds.cache.reduce((n, g) => n + g.memberCount, 0).toLocaleString()} membres · en ligne depuis ${formatUptime(client.uptime)}`,
    })
    .addFields({
      name: '📚 Documentation avancée',
      value: `${Object.keys(DOCS).length} articles détaillés — permissions, sécurité, portail d'accès, dépannage, FAQ... Utilisez le second menu ci-dessous.`,
    })
    .setFooter({ text: `Bumpify • ${TOTAL_COMMANDS} commandes au total` })
    .setTimestamp();

  return embed;
}

// ─── Page de catégorie ────────────────────────────────────────────────────────
function buildCategoryEmbed(client, key) {
  const cat = CATEGORIES[key];
  const half = Math.ceil(cat.commands.length / 2);
  const col1 = cat.commands.slice(0, half).map(c => `\`${c.name}\`\n╰ *${c.desc}*`).join('\n\n');
  const col2 = cat.commands.slice(half).map(c => `\`${c.name}\`\n╰ *${c.desc}*`).join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(cat.color)
    .setAuthor({ name: 'Bumpify — Centre d\'aide', iconURL: client.user.displayAvatarURL() })
    .setTitle(`${cat.emoji} ${cat.label}`)
    .setDescription(`*${cat.blurb}*`)
    .addFields({ name: '​', value: col1 || '​', inline: true });

  if (col2) embed.addFields({ name: '​', value: col2, inline: true });

  embed
    .setFooter({ text: `Bumpify • ${cat.commands.length} commande${cat.commands.length > 1 ? 's' : ''} dans cette catégorie` })
    .setTimestamp();

  return embed;
}

// ─── Page d'article de documentation ───────────────────────────────────────
function buildDocEmbed(client, key) {
  const doc = DOCS[key];
  const related = doc.related?.length ? `\n\n**Commandes liées :** ${doc.related.map(c => `\`${c}\``).join(', ')}` : '';
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: 'Bumpify — Documentation', iconURL: client.user.displayAvatarURL() })
    .setTitle(`${doc.emoji} ${doc.title}`)
    .setDescription(doc.body + related)
    .setFooter({ text: 'Bumpify • Centre de documentation' });
}

function buildDocsSelectMenu(activeKey = null) {
  const options = Object.entries(DOCS).map(([key, doc]) => ({
    label: doc.title, value: key, emoji: doc.emoji, default: key === activeKey,
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('help_docs').setPlaceholder('📚 Documentation avancée…').addOptions(options),
  );
}


function buildSelectMenu(activeKey = null) {
  const options = Object.entries(CATEGORIES).map(([key, cat]) => ({
    label: cat.label,
    value: key,
    emoji: cat.emoji,
    description: `${cat.commands.length} commandes`,
    default: key === activeKey,
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('help_category').setPlaceholder('📂 Choisir une catégorie…').addOptions(options),
  );
}

// v2 — mis en avant sur la page d'accueil du help pour rendre visibles les
// fonctionnalités récemment ajoutées (autrement noyées dans la liste).
const WHATS_NEW = [
  { name: '/notifications mes-notifications', desc: 'Fil personnel de notifications — un message DM qui s\'actualise tout seul à chaque nouvelle notification, sans rien recharger.' },
  { name: '/forumwelcome panel',              desc: 'Message d\'accueil automatique et personnalisable, posté à chaque nouveau post dans vos salons Forum (titre, texte, bouton lien, épinglage).' },
  { name: '/status',                          desc: 'Personnalisez le statut Discord affiché par le bot (type d\'activité, texte, présence) *(Propriétaire)*.' },
];

function buildActionRow(showHome = false) {
  const row = new ActionRowBuilder();
  row.addComponents(
    showHome
      ? new ButtonBuilder().setCustomId('help_home').setLabel('Accueil').setEmoji('🏠').setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder().setCustomId('help_whatsnew').setLabel('Nouveautés').setEmoji('🆕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('help_search').setLabel('Rechercher').setEmoji('🔍').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('help_random').setLabel('Découvrir').setEmoji('🎲').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setLabel('Site web').setEmoji('🌐').setStyle(ButtonStyle.Link).setURL(SITE_URL),
    new ButtonBuilder().setLabel('Support').setEmoji('💬').setStyle(ButtonStyle.Link).setURL(SUPPORT_URL),
  );
  return row;
}

// Vérifie que seul l'auteur de la commande /help d'origine peut utiliser les
// composants (select/boutons) — nécessaire maintenant que le panel est public
// et visible par tout le salon, pas juste par celui qui l'a ouvert.
function isOwner(interaction) {
  const ownerId = interaction.message?.interactionMetadata?.user?.id
    ?? interaction.message?.interaction?.user?.id
    ?? null;
  return !ownerId || ownerId === interaction.user.id;
}

async function rejectNotOwner(interaction) {
  return interaction.reply({
    content: '🔒 Ce menu ne t\'appartient pas — utilise `/help` toi-même pour l\'explorer librement !',
    ephemeral: true,
  });
}

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('📖 Afficher l\'aide complète de Bumpify'),

  async execute(interaction) {
    // v2 : le panel est désormais public (visible par tout le salon), donc
    // on protège les composants (voir isOwner) pour que seul l'auteur original
    // puisse naviguer dedans — les autres peuvent lancer leur propre /help.
    await interaction.reply({
      embeds: [buildMainEmbed(interaction.client)],
      components: [buildSelectMenu(), buildDocsSelectMenu(), buildActionRow(false)],
    });
  },

  async handleSelect(interaction) {
    if (!isOwner(interaction)) return rejectNotOwner(interaction);
    const key = interaction.values[0];
    if (!CATEGORIES[key]) return;
    await interaction.update({
      embeds: [buildCategoryEmbed(interaction.client, key)],
      components: [buildSelectMenu(key), buildDocsSelectMenu(), buildActionRow(true)],
    });
  },

  // 📚 Documentation avancée — articles longs, indépendants des catégories de commandes
  async handleDocsSelect(interaction) {
    if (!isOwner(interaction)) return rejectNotOwner(interaction);
    const key = interaction.values[0];
    if (!DOCS[key]) return;
    await interaction.update({
      embeds: [buildDocEmbed(interaction.client, key)],
      components: [buildSelectMenu(), buildDocsSelectMenu(key), buildActionRow(true)],
    });
  },

  async handleHome(interaction) {
    if (!isOwner(interaction)) return rejectNotOwner(interaction);
    await interaction.update({
      embeds: [buildMainEmbed(interaction.client)],
      components: [buildSelectMenu(), buildDocsSelectMenu(), buildActionRow(false)],
    });
  },

  // 🔍 Recherche — ouvre une modale, résultat envoyé en privé (ephemeral) à
  // celui qui cherche, pour ne pas polluer le salon avec des résultats perso.
  async handleSearchButton(interaction) {
    if (!isOwner(interaction)) return rejectNotOwner(interaction);
    const modal = new ModalBuilder().setCustomId('help_search_modal').setTitle('Rechercher une commande');
    const input = new TextInputBuilder()
      .setCustomId('help_search_query')
      .setLabel('Mot-clé (ex: bump, warn, coins…)')
      .setStyle(TextInputStyle.Short)
      .setMinLength(2)
      .setMaxLength(50)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  },

  async handleSearchModal(interaction) {
    const query = interaction.fields.getTextInputValue('help_search_query').trim().toLowerCase();
    const matches = ALL_COMMANDS_FLAT.filter(
      c => c.name.toLowerCase().includes(query) || c.desc.toLowerCase().includes(query)
    ).slice(0, 10);

    const docMatches = Object.entries(DOCS).filter(
      ([, d]) => d.title.toLowerCase().includes(query) || d.body.toLowerCase().includes(query)
    ).slice(0, 5);

    if (matches.length === 0 && docMatches.length === 0) {
      return interaction.reply({
        content: `🔍 Aucun résultat pour \`${query}\`. Essaie un autre mot-clé !`,
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`🔍 Résultats pour « ${query} »`);

    if (matches.length) {
      embed.addFields({
        name: '⚙️ Commandes',
        value: matches.map(c => `${c.categoryEmoji} \`${c.name}\`\n╰ *${c.desc}* — ${c.categoryLabel}`).join('\n\n'),
      });
    }
    if (docMatches.length) {
      embed.addFields({
        name: '📚 Documentation',
        value: docMatches.map(([, d]) => `${d.emoji} **${d.title}**`).join('\n'),
      });
    }

    embed.setFooter({ text: `${matches.length + docMatches.length} résultat(s) trouvé(s)` });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },

  // 🎲 Découvrir — met en avant une commande aléatoire, en privé (pour ne pas
  // spammer le salon à chaque clic).
  async handleRandomButton(interaction) {
    if (!isOwner(interaction)) return rejectNotOwner(interaction);
    const pick = ALL_COMMANDS_FLAT[Math.floor(Math.random() * ALL_COMMANDS_FLAT.length)];
    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('🎲 Le savais-tu ?')
      .setDescription(`${pick.categoryEmoji} \`${pick.name}\`\n╰ *${pick.desc}*\n\nCatégorie : **${pick.categoryLabel}**`)
      .setFooter({ text: 'Reclique sur Découvrir pour une autre commande !' });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },

  // 🆕 Nouveautés — met en avant les fonctionnalités récemment ajoutées.
  async handleWhatsNew(interaction) {
    if (!isOwner(interaction)) return rejectNotOwner(interaction);
    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('🆕 Nouveautés')
      .setDescription(
        WHATS_NEW.map(f => `\`${f.name}\`\n╰ *${f.desc}*`).join('\n\n')
      )
      .setFooter({ text: 'Ces commandes sont aussi listées dans leur catégorie habituelle.' });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};