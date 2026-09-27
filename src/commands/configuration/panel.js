// commands/panel.js — Panel de configuration centralisé (catégorisé)
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits,
} = require('discord.js');
const Server = require('../../models/Server');
const { Welcome, Farewell } = require('../../models/Welcome');
const { CaptchaConfig }     = require('../../models/Captcha');
const AutoMod               = require('../../models/AutoMod');
const Honeypot              = require('../../models/Honeypot');
const { COLORS }            = require('../../utils/embeds');

// ─── Modules par catégorie ─────────────────────────────────────────────────
// direct: la commande n'a AUCUN subcommand → on peut lancer execute() sur
//         l'interaction du menu directement, ce qui ouvre son panel réel ici.
// guide:  la commande utilise des subcommands → on ne peut pas l'invoquer
//         sans options, donc on indique la bonne commande à taper.
const CATEGORIES = {
  general: {
    label: '📋 Général',
    modules: [
      { value: 'config',        label: '🚀 Bump & Config',        description: 'Description, invitation, salons, rappels', direct: 'config' },
      { value: 'welcome',       label: '👋 Bienvenue & Au revoir', description: 'Messages d\'arrivée et de départ',         guide: '`/welcome panel` (Bienvenue+ : message, image, MP, boutons, compteur, stats) et `/farewell-set panel`' },
      { value: 'interserveur',  label: '🌐 Inter-Serveur',        description: 'Chat entre serveurs en temps réel',        direct: 'interserveur' },
      { value: 'notifications', label: '🔔 Notifications',        description: 'Salons de notifications du serveur',       guide: '`/notifications config` — Configurer les salons de notifications' },
      { value: 'onboarding',    label: '🚪 Portail d\'accès',      description: 'Questions obligatoires avant accès au serveur', direct: 'onboarding' },
    ],
  },
  securite: {
    label: '🛡️ Sécurité & Modération',
    modules: [
      { value: 'securite',       label: '🛡️ Sécurité générale', description: 'Captcha rapide, anti-spam/raid/liens',      direct: 'securite' },
      { value: 'captcha',        label: '🔒 Captcha avancé',    description: 'Réglages fins de la vérification captcha',  direct: 'captcha' },
      { value: 'honeypot',       label: '🍯 Honeypot',          description: 'Salon + bouton piège anti-bot',             direct: 'honeypot' },
      { value: 'antiscam',       label: '🚨 Anti-Scam',         description: 'Détection de liens/arnaques',               guide: '`/antiscam activer` — Activer/désactiver l\'anti-scam' },
      { value: 'warnconfig',     label: '⚠️ Avertissements',    description: 'Paliers de sanctions automatiques',         guide: '`/warnconfig` — Configurer les paliers d\'avertissements' },
      { value: 'raidautoconfig', label: '🚔 Mode raid auto',    description: 'Déclenchement automatique du mode raid',    guide: '`/raidautoconfig config` — Déclenchement automatique du mode raid' },
    ],
  },
  communaute: {
    label: '🎉 Communauté',
    modules: [
      { value: 'leveling',           label: '🏆 Niveaux & XP',    description: 'Système de niveaux et d\'expérience',      direct: 'leveling' },
      { value: 'anniversaire',       label: '🎂 Anniversaires',   description: 'Annonces d\'anniversaire automatiques',    direct: 'anniversaire-config' },
      { value: 'shop',               label: '🛒 Boutique',        description: 'Articles achetables avec des coins',       guide: '`/shop gérer` — Gestion des articles de la boutique' },
      { value: 'leaderboardconfig',  label: '📈 Classements',     description: 'Type de classement par défaut',            guide: '`/leaderboardconfig` — Type de classement par défaut' },
      { value: 'starboard',          label: '⭐ Starboard',       description: 'Salon des meilleurs messages, paliers',    direct: 'starboard' },
      { value: 'partenariat-config', label: '🤝 Partenariats',    description: 'Salon des annonces de partenariat',        guide: '`/partenariat-config definir` — Salon des annonces de partenariat' },
    ],
  },
  support: {
    label: '📬 Support & Autres',
    modules: [
      { value: 'modmail',        label: '📬 Modmail',          description: 'Messagerie privée avec le staff',           guide: '`/modmail config` — Configuration du modmail' },
      { value: 'autothread',     label: '🧵 Auto-Thread',      description: 'Threads automatiques sur les messages',     guide: '`/autothread status` / `/autothread toggle` — Auto-thread' },
      { value: 'forumwelcome',   label: '🗂️ Accueil forums',   description: 'Message d\'accueil sur les posts forum',    guide: '`/forumwelcome panel` — Message d\'accueil des forums' },
      { value: 'invites-config', label: '📨 Invitations',      description: 'Suivi des invitations',                     guide: '`/invites-config statut` / `/invites-config activer` — Suivi des invitations' },
      { value: 'streamalerts',   label: '📺 Alertes stream',   description: 'Alertes Twitch / YouTube en direct',        guide: '`/streamalerts panel` — Alertes de live Twitch/YouTube' },
      { value: 'reddit',         label: '🟠 Annonces Reddit',  description: 'Publication automatique de posts Reddit',   direct: 'reddit-annonce' },
    ],
  },
};

function findModule(value) {
  for (const cat of Object.values(CATEGORIES)) {
    const found = cat.modules.find(m => m.value === value);
    if (found) return found;
  }
  return null;
}

// ─── Embed d'accueil / vue d'ensemble ──────────────────────────────────────
async function buildOverviewEmbed(guild) {
  const [server, welcome, farewell, captcha, automod, honeypot] = await Promise.all([
    Server.findOne({ guildId: guild.id }),
    Welcome.findOne({ guildId: guild.id }),
    Farewell.findOne({ guildId: guild.id }),
    CaptchaConfig.findOne({ guildId: guild.id }),
    AutoMod.findOne({ guildId: guild.id }),
    Honeypot.findOne({ guildId: guild.id }),
  ]);

  const ok = v => v ? '🟢' : '🔴';

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('⚙️ Panel de Configuration — Bumpify')
    .setDescription('Vue d\'ensemble de la configuration.\n**Choisis une catégorie**, puis un module : il s\'ouvre **directement ici**, aucune commande à taper (sauf indication contraire).')
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .addFields(
      { name: '🚀 Bump & Réseau', value: [
          `${ok(server?.bumpChannelId)} Salon bump: ${server?.bumpChannelId ? `<#${server.bumpChannelId}>` : '*Non défini*'}`,
          `${ok(server?.feedChannelId)} Salon feed: ${server?.feedChannelId ? `<#${server.feedChannelId}>` : '*Non défini*'}`,
        ].join('\n'), inline: true },
      { name: '👋 Bienvenue & Au revoir', value: [
          `${ok(welcome?.enabled)} Bienvenue: ${welcome?.channelId ? `<#${welcome.channelId}>` : '*Non configuré*'}`,
          `${ok(farewell?.enabled)} Au revoir: ${farewell?.channelId ? `<#${farewell.channelId}>` : '*Non configuré*'}`,
        ].join('\n'), inline: true },
      { name: '🛡️ Sécurité', value: [
          `${ok(captcha?.enabled)} Captcha`,
          `${ok(automod?.spamEnabled)} Anti-Spam`,
          `${ok(automod?.raidEnabled)} Anti-Raid`,
          `${ok(honeypot?.enabled)} Honeypot`,
        ].join('\n'), inline: true },
      { name: '📊 Stats', value: [
          `Bumps totaux: **${server?.bumpCount || 0}**`,
          `Streak: **${server?.bumpStreak || 0}** jour(s)`,
          `Membres: **${guild.memberCount}**`,
        ].join('\n'), inline: true },
    )
    .setFooter({ text: 'Bumpify • Panel central' })
    .setTimestamp();
}

function buildCategoryRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('panel_category')
      .setPlaceholder('📂 Choisir une catégorie…')
      .addOptions(Object.entries(CATEGORIES).map(([key, cat]) => ({
        label: cat.label, value: key,
      }))),
  );
}

function buildModuleRow(categoryKey) {
  const cat = CATEGORIES[categoryKey];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`panel_module:${categoryKey}`)
      .setPlaceholder(`📂 ${cat.label} — choisir un module…`)
      .addOptions(cat.modules.map(m => ({ label: m.label, value: m.value, description: m.description }))),
  );
}

function buildHomeButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_home').setLabel('🏠 Accueil').setStyle(ButtonStyle.Secondary),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('⚙️ Panel de configuration central de Bumpify')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    await Server.findOneAndUpdate(
      { guildId: interaction.guild.id },
      { $setOnInsert: { guildId: interaction.guild.id, guildName: interaction.guild.name } },
      { upsert: true, new: true }
    );

    const goHome = async i => {
      const embed = await buildOverviewEmbed(interaction.guild);
      await i.update({ embeds: [embed], components: [buildCategoryRow()] });
    };

    const embed = await buildOverviewEmbed(interaction.guild);
    const reply = await interaction.editReply({
      embeds: [embed],
      components: [buildCategoryRow()],
      fetchReply: true,
    });

    const col = reply.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time: 15 * 60 * 1000,
    });

    col.on('collect', async i => {
      try {
        if (i.customId === 'panel_home') return goHome(i);

        if (i.customId === 'panel_category') {
          const categoryKey = i.values[0];
          const cat = CATEGORIES[categoryKey];
          const catEmbed = new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle(`⚙️ ${cat.label}`)
            .setDescription('Choisis un module ci-dessous.');
          return i.update({ embeds: [catEmbed], components: [buildModuleRow(categoryKey), buildHomeButtonRow()] });
        }

        if (i.customId.startsWith('panel_module:')) {
          const value = i.values[0];
          const mod = findModule(value);
          if (!mod) return goHome(i);

          // ── Module embarquable : on ouvre son panel réel, directement ────
          if (mod.direct) {
            const cmd = client.commands.get(mod.direct);
            if (cmd?.execute) {
              try {
                await cmd.execute(i, client);
              } catch (err) {
                console.error(`panel → ${mod.direct}:`, err.message);
                await i.reply({ content: '❌ Une erreur est survenue en ouvrant cette section.', ephemeral: true }).catch(() => {});
              }
              return;
            }
          }

          // ── Module à subcommands : on guide vers la bonne commande ───────
          const categoryKey = i.customId.split(':')[1];
          const guideEmbed = new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle(`📌 ${mod.label}`)
            .setDescription(`Ce module utilise plusieurs réglages, il se configure via commande :\n\n${mod.guide}`);
          return i.update({ embeds: [guideEmbed], components: [buildModuleRow(categoryKey), buildHomeButtonRow()] });
        }
      } catch (err) {
        console.error('panel collector:', err.message);
      }
    });

    col.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
