'use strict';
// commands/changelog.js — Historique des mises à jour du bot Bumpify.
//
// ⚠️ MAINTENANCE : pour ajouter une nouvelle entrée, ajoute un objet en TÊTE
// du tableau CHANGELOG ci-dessous (le plus récent en premier), au même
// format que les entrées existantes. Rien d'autre à modifier dans le
// fichier — pagination, sélecteur de version et compteur s'adaptent
// automatiquement au nombre d'entrées.
//
// Honnêteté : cette commande n'a pas accès à l'historique complet du projet
// avant sa création. La première entrée « Historique antérieur » le précise
// clairement plutôt que de laisser croire que le bot n'avait rien avant.
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const { COLORS } = require('../../utils/embeds');

const CHANGELOG = [
  {
    version: '🤖 AI Playground & 💌 Demande de MP',
    date: '13 août 2026',
    changes: [
      'Nouvelle commande `/ai-playground panel` — bouton dédié pour créer le salon de chat IA (jamais automatique), permissions et slowmode configurés automatiquement',
      'Bascule automatique de modèle IA en cas de quota dépassé (chaîne de modèles configurable), et **verrouillage réel du salon** si tous les modèles sont indisponibles — avec déverrouillage automatique dès qu\'un modèle redevient disponible',
      'Nouvelle commande `/demande-mp panel` — configure un salon où la mention de la personne visée est **obligatoire** ; le message est remplacé par un embed avec boutons ✅ Accepter / ❌ Refuser réservés à cette personne, et le fil de discussion n\'est créé qu\'en cas d\'acceptation',
    ],
  },
  {
    version: '🔔 Notifications de bump avancées & historique',
    date: '12 août 2026',
    changes: [
      'Nouvelle commande `/bump-notif panel` — configuration complète et réellement fonctionnelle des rappels : salon dédié, rôle, message personnalisé (avec placeholders), couleur, mention silencieuse, bascules d\'affichage, auto-suppression',
      'Nouvelle commande `/bump-historique` — historique complet et paginé de tous vos bumps, avec statistiques (total, meilleure streak, coins gagnés)',
      'v2 de `/joke` — chute cachée (suspense), 52 blagues réparties en 6 catégories, notation 👍👎, bouton "Une autre"',
    ],
  },
  {
    version: '🌍 Jeu de planète',
    date: '12 août 2026',
    changes: [
      'Nouvelle commande `/planet` — créez votre propre planète, donnez-lui un nom et un biome',
      'Faites-la grandir : 6 niveaux visuels (🪨 astéroïde → 🌌✨ système stellaire), entièrement en emojis unicode',
      '5 bâtiments à construire (maison, ferme, centrale, mine, laboratoire), coûts progressifs',
      'Population, bonheur et ressources (nourriture/énergie/minerais) à gérer — attention à la famine !',
      'Panel unique avec boutons, select menu et barres de progression en emojis',
    ],
  },
  {
    version: '🌤️ Météo',
    date: '7 août 2026',
    changes: [
      'Nouvelle commande `/meteo <ville>` — température, ressenti, humidité, vent, visibilité, lever/coucher du soleil',
      'Utilise la clé `WEATHER_KEY` déjà présente dans le `.env`',
    ],
  },
  {
    version: '⭐ Avis sur les serveurs',
    date: '6 août 2026',
    changes: [
      '`/avis-panel` est désormais une **commande indépendante** pour un accès direct à la configuration (le reste — noter, voir, top, stats, répondre — reste sur `/avis`)',
      '`/avis noter` / `modifier` / `supprimer` — avis 5 étoiles + commentaire + tags sur les serveurs du réseau',
      '📷 **Images jointes** — jusqu\'à 3 captures d\'écran/preuves par avis (PNG/JPEG/WEBP/GIF), affichées directement dans la carte d\'avis',
      '**Réponses publiques du staff** aux avis — fonctionnalité rare, comme sur Google/Trustpilot',
      'Votes 👍 Utile / 👎 Pas utile sur chaque avis, classement automatique des plus pertinents',
      'Système de signalement avec **masquage automatique** au-delà d\'un seuil configurable',
      'Anti-faux-avis : ancienneté minimale sur le serveur + âge minimum du compte requis (configurables)',
      '`/avis stats` — statistiques **en temps réel** (note moyenne, distribution par étoile, tags les plus fréquents)',
      '`/avis top` — classement des serveurs les mieux notés de tout le réseau',
      'File de modération manuelle optionnelle (avis en attente d\'approbation avec boutons Approuver/Rejeter)',
      '`/avis panel` — panel de configuration avancé complet',
    ],
  },
  {
    version: '💡 Suggestions nouvelle génération',
    date: '3 août 2026',
    changes: [
      '`/suggestion panel` — panel de configuration avancé complet : salon, logs, anti-abus (cooldown + rôle requis), fonctionnalités (anonymat, fil auto, DM), seuils d\'auto-modération, catégories',
      '`/suggestion stats` — statistiques **en temps réel** avec mode 🔴 direct (rafraîchissement automatique), top suggestions, membres les plus actifs, graphique 7 jours',
      'Logs configurables : chaque action (vote, approbation, refus, modification…) peut être relayée en direct dans un salon dédié',
      'Nouveau bouton **📄 Transcript** sur chaque suggestion → page web dédiée avec historique complet et détaillé de tous les évènements',
      'Votes modifiables (changer d\'avis), suggestions anonymes, catégories, fil de discussion automatique, notification DM à l\'auteur, auto-approbation/refus par seuil de votes',
      '`/suggestion modifier`, `/suggestion supprimer` et `/suggestion top` ajoutées',
    ],
  },
  {
    version: '🟣 Explorateur Twitch',
    date: '3 août 2026',
    changes: [
      'Nouvelle commande `/twitch top [jeu]` — les streams les plus regardés en direct, globalement ou filtrés par catégorie, avec **pagination avancée** (curseur natif Twitch, boutons ◀ Précédent / Suivant ▶ / 🔄 Actualiser)',
      'Nouvelle commande `/twitch search` — recherche de chaînes Twitch par nom, paginée de la même façon',
      'Nouvelle commande `/twitch chaine` — fiche détaillée d\'un streamer (statut live, catégorie, spectateurs, miniature)',
      '`/help` mis à jour avec `/twitch` et `/streamalerts`',
    ],
  },
  {
    version: '🔐 Profil d\'authentification',
    date: '3 août 2026',
    changes: [
      'Nouvelle commande `/auth-profil` : sécurisez votre compte avec un **code PIN**, la **2FA** (compatible Google Authenticator/Authy) et des **Passkeys** (codes de secours à usage unique)',
      'Grade de sécurité personnel (F → A) calculé automatiquement selon les protections actives',
      'Journal d\'activité complet (PIN modifié, 2FA activée, Passkey ajoutée/révoquée…)',
      'Réinitialisation « J\'ai oublié mes auths » avec délai de sûreté d\'1h et notification DM anti-abus',
      '🔒 `/ban`, `/kick`, `/raidmode` et `/forceleave` demandent désormais une confirmation par PIN si vous en avez configuré un — protection contre le vol de session/compte',
    ],
  },
  {
    version: '🚀 Bump interactif',
    date: '17 juillet 2026',
    changes: [
      '🎁 Loot box : 20% de chance à chaque bump d\'obtenir un bonus surprise à ouvrir en un clic (jusqu\'à +1000 coins)',
      '🏅 Badges de jalon automatiques : streak (7/30/100/365 jours) et nombre total de bumps (10/50/100/500/1000) — réutilise le système `/badge` existant',
      '🔔 Rappel personnel en DM : bouton sur l\'écran de cooldown pour se faire prévenir en message privé dès que le cooldown se termine (en plus du rappel serveur déjà existant)',
    ],
  },
  {
    version: '🤝 Système de partenariats',
    date: '17 juillet 2026',
    changes: [
      'Nouvelles commandes `/partenariat` et `/partenariat-config`',
      'Détection **automatique** des partenariats : poster un lien d\'invitation dans un salon dédié suffit, plus besoin de commande',
      'Éditeur interactif (`/partenariat-config builder`) : fenêtre pré-remplie pour personnaliser titre, message, couleur, footer et miniature',
      'Compteur de partenariats par membre + total du serveur',
      'Variables fonctionnelles dans les messages : `{user}`, `{count}`, `{rang}`, `{serveur}`, `{invite}`, `{membres}`, `{total}`, `{date}`',
      'Embed d\'annonce restructuré en champs clairs (partenaire, statistiques, date) au lieu d\'un seul bloc de texte',
    ],
  },
  {
    version: '🧭 Découverte réseau',
    date: '17 juillet 2026',
    changes: [
      'Nouvelle commande `/serveurdujour` — met en avant le même serveur que sur le site, chaque jour',
      'Nouvelle commande `/tags` — catégories les plus utilisées sur le réseau, calculées en direct',
      'Nouvelle commande `/comparer` — compare deux serveurs côte à côte (membres, bumps, streak, votes)',
      '`/help` mis à jour avec toutes les commandes ci-dessus',
    ],
  },
  {
    version: '📜 Historique antérieur',
    date: '—',
    changes: [
      'Le suivi détaillé des mises à jour commence à partir de cette version.',
      'Les fonctionnalités existantes avant cette date (modération, économie, XP, tickets, giveaways, et bien plus) ne sont pas listées ici, mais restent bien sûr disponibles — voir `/help`.',
    ],
  },
];

function buildEmbed(index) {
  const entry = CHANGELOG[index];
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`🗒️ Changelog — ${entry.version}`)
    .setDescription(entry.changes.map((c) => `• ${c}`).join('\n'))
    .setFooter({ text: `${entry.date} • Version ${index + 1}/${CHANGELOG.length}` });
  return embed;
}

function buildComponents(index) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('changelog_newer').setLabel('◀ Plus récent').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
    new ButtonBuilder().setCustomId('changelog_older').setLabel('Plus ancien ▶').setStyle(ButtonStyle.Secondary).setDisabled(index === CHANGELOG.length - 1),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('changelog_jump')
      .setPlaceholder('Aller directement à une version…')
      .addOptions(
        CHANGELOG.map((entry, i) => ({
          label: entry.version.replace(/^\p{Emoji}\s*/u, '').slice(0, 90),
          value: `${i}`,
          description: entry.date,
          default: i === index,
        }))
      ),
  );

  return CHANGELOG.length > 1 ? [row1, row2] : [];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('changelog')
    .setDescription('🗒️ Voir l\'historique des mises à jour du bot'),

  async execute(interaction) {
    let index = 0;

    const reply = await interaction.reply({
      embeds: [buildEmbed(index)],
      components: buildComponents(index),
      fetchReply: true,
    });

    if (CHANGELOG.length <= 1) return; // rien à paginer, pas besoin de collector

    const collector = reply.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      time: 300000, // 5 minutes
    });

    collector.on('collect', async (i) => {
      if (i.customId === 'changelog_newer') index = Math.max(0, index - 1);
      else if (i.customId === 'changelog_older') index = Math.min(CHANGELOG.length - 1, index + 1);
      else if (i.customId === 'changelog_jump') index = parseInt(i.values[0], 10);
      else return;

      await i.update({ embeds: [buildEmbed(index)], components: buildComponents(index) });
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
