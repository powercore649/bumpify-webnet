// commands/configuration/welcome.js — Commande centrale du système "Bienvenue+"
// Un panel interactif unique regroupe : activation, salon, style de rendu,
// textes, couleur, image canvas (4 styles Bumpify), MP, boutons, compteur,
// test en direct et statistiques.
const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { Welcome } = require('../../models/Welcome');
const { successEmbed, errorEmbed, infoEmbed, warningEmbed, COLORS } = require('../../utils/embeds');
const {
  resolveWelcomePlaceholders, buildWelcomePayload, sendWelcomeDM,
} = require('../../utils/welcomeManager');

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;
const IMAGE_STYLE_LABELS = {
  off: 'Aucune image',
  gradient: 'Gradient néon',
  glass: 'Vitrail de glace',
  banner: 'Bandeau diagonal',
  minimal: 'Carte épurée',
};

// Mémo du dernier panneau ouvert par guilde (pour le rafraîchir après un modal)
const panelMessages = new Map(); // guildId -> { channelId, messageId }

async function getOrCreateConfig(guildId) {
  let cfg = await Welcome.findOne({ guildId });
  if (!cfg) cfg = await Welcome.create({ guildId });
  return cfg;
}

// ─── Rendu du panneau ─────────────────────────────────────────────────────────
function buildPanelEmbed(cfg, guild) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('👋 Bienvenue+ — Panneau de configuration')
    .setDescription(
      'Le système d\'accueil complet de Bumpify : message, image stylée, MP, boutons, compteur et stats.',
    )
    .addFields(
      { name: '⚡ État', value: cfg.enabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: '📺 Salon', value: cfg.channelId ? `<#${cfg.channelId}>` : '*Non défini*', inline: true },
      { name: '🎨 Rendu', value: cfg.renderStyle === 'plain' ? 'Message brut' : 'Embed riche', inline: true },
      { name: '🖼️ Image', value: IMAGE_STYLE_LABELS[cfg.imageStyle] || cfg.imageStyle, inline: true },
      { name: '📩 MP', value: cfg.dmEnabled ? (cfg.dmEmbed ? 'Embed' : 'Texte') : 'Désactivé', inline: true },
      { name: '🔗 Boutons', value: cfg.buttons?.length ? `${cfg.buttons.length}/5` : '—', inline: true },
      { name: '🔢 Compteur', value: cfg.counterEnabled && cfg.counterChannelId ? `<#${cfg.counterChannelId}>` : 'Désactivé', inline: true },
      { name: '📊 Joins aujourd\'hui', value: String(cfg.stats?.joinsToday ?? 0), inline: true },
      { name: '🗓️ Joins 7 jours', value: String(cfg.stats?.joinsWeek ?? 0), inline: true },
      { name: '✍️ Message actuel', value: `>>> ${(cfg.message || '').slice(0, 300) || '*vide*'}`, inline: false },
      {
        name: '🧩 Variables',
        value: '`{user}` `{username}` `{mention}` `{server}` `{count}` `{created}` `{date}` `{time}` `{inviter}` `{inviteCode}` `{invites}` `{rules}` `{channel}` `{bump_emoji}`\n' +
          'Détails : `/welcome variables` — Test en direct : `/welcome test`',
        inline: false,
      },
    )
    .setFooter({ text: `Serveur : ${guild.name} • Bumpify Bienvenue+` });
  return embed;
}

function buildPanelComponents(cfg) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('wlb_toggle')
      .setLabel(cfg.enabled ? 'Désactiver' : 'Activer')
      .setEmoji('⚡')
      .setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('wlb_channel').setLabel('Salon').setEmoji('📺').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('wlb_style').setLabel('Style de message').setEmoji('✍️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('wlb_image').setLabel('Image').setEmoji('🖼️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('wlb_dm').setLabel('MP de bienvenue').setEmoji('📩').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wlb_buttons').setLabel('Boutons').setEmoji('🔗').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('wlb_counter').setLabel('Compteur vocal').setEmoji('🔢').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('wlb_test').setLabel('Test en direct').setEmoji('🧪').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('wlb_stats').setLabel('Stats').setEmoji('📊').setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wlb_render').setLabel('Rendu').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('wlb_title').setLabel('Titre').setEmoji('🏷️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('wlb_color').setLabel('Couleur').setEmoji('🖌️').setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2, row3];
}

async function sendPanel(interaction) {
  const cfg = await getOrCreateConfig(interaction.guildId);
  const payload = {
    embeds: [buildPanelEmbed(cfg, interaction.guild)],
    components: buildPanelComponents(cfg),
  };
  const reply = await interaction.reply({ ...payload, fetchReply: true });
  panelMessages.set(interaction.guildId, { channelId: interaction.channelId, messageId: reply.id });
}

async function refreshPanel(interaction, cfg) {
  const memo = panelMessages.get(interaction.guildId);
  const channel = interaction.guild.channels.cache.get(memo?.channelId || '');
  const message = channel ? await channel.messages.fetch(memo.messageId).catch(() => null) : null;
  if (message) {
    await message.edit({
      embeds: [buildPanelEmbed(cfg, interaction.guild)],
      components: buildPanelComponents(cfg),
    }).catch(() => {});
  }
}

// ─── Test en direct ───────────────────────────────────────────────────────────
async function runTest(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const cfg = await getOrCreateConfig(interaction.guildId);

  if (!cfg.message && !cfg.enabled) {
    return interaction.editReply({
      embeds: [warningEmbed('Rien à tester', 'Ouvre `/welcome panel` et configure d\'abord le message et le salon.')],
    });
  }

  const guild = interaction.guild;
  const ctx = { member: interaction.member, guild, client: interaction.client, inviterId: null, inviteCode: null, inviteCount: null };

  try {
    const payload = await buildWelcomePayload(interaction.member, guild, cfg, ctx);
    await interaction.editReply({ content: '🧪 **Aperçu du message de bienvenue :**', ...payload });
  } catch (err) {
    return interaction.editReply({
      embeds: [errorEmbed('Échec de l\'aperçu', err.message)],
    });
  }

  // Test du MP (sans l'envoyer deux fois : vrai envoi, l'admin le reçoit)
  if (cfg.dmEnabled) {
    const dmOk = await sendWelcomeDM(interaction.member, cfg, ctx);
    await interaction.followUp({
      embeds: [dmOk
        ? successEmbed('MP envoyé', 'Vérifie tes messages privés — le MP de bienvenue vient d\'être envoyé.')
        : warningEmbed('MP impossible', 'Tes MPs sont fermés ou le message est vide. Le MP de bienvenue échouera silencieusement pour les membres dans le même cas.')],
      ephemeral: true,
    }).catch(() => {});
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function buildStatsEmbed(guild, cfg) {
  const s = cfg.stats || {};
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('📊 Statistiques de bienvenue')
    .addFields(
      { name: '📅 Joins aujourd\'hui', value: String(s.joinsToday ?? 0), inline: true },
      { name: '🗓️ Joins 7 derniers jours', value: String(s.joinsWeek ?? 0), inline: true },
      { name: '👥 Membres actuels', value: String(guild.memberCount), inline: true },
      { name: '➕ Arrivées enregistrées', value: String(s.joinsTotal ?? 0), inline: true },
      { name: '👋 Dernier join', value: s.lastJoinDate ? `<t:${Math.floor(new Date(s.lastJoinDate).getTime() / 1000)}:R>` : 'Jamais', inline: true },
    )
    .setTimestamp();
}

// ─── Exécution ────────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('👋 Système de bienvenue complet : message, image, MP, boutons, compteur, stats')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('panel').setDescription('Ouvrir le panneau de configuration Bienvenue+'))
    .addSubcommand(s => s.setName('test').setDescription('Simuler une arrivée pour tester la configuration'))
    .addSubcommand(s => s.setName('variables').setDescription('Liste des variables de template'))
    .addSubcommand(s => s.setName('stats').setDescription('Statistiques de bienvenue du serveur')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'panel') return sendPanel(interaction);
    if (sub === 'test') return runTest(interaction);

    if (sub === 'variables') {
      return interaction.reply({
        embeds: [infoEmbed('Variables de template Bienvenue+', [
          '**Identité** — `{user}` (mention) • `{username}` (nom) • `{mention}` (mention)',
          '**Serveur** — `{server}` (nom) • `{count}` (membres) • `{rules}` (lien auto vers le règlement)',
          '**Temps** — `{date}` • `{time}` • `{created}` (ancienneté du compte du membre)',
          '**Invitation** — `{inviter}` (mention) • `{inviteCode}` • `{invites}` (total de l\'inviteur)',
          '**Divers** — `{channel}` (salon de bienvenue) • `{bump_emoji}` (émoji Bumpify)',
          '',
          'Le markdown Discord fonctionne partout : `**gras**`, `*italique*`, `> citation`, liens, etc.',
        ].join('\n'))],
        ephemeral: true,
      });
    }

    if (sub === 'stats') {
      const cfg = await getOrCreateConfig(interaction.guildId);
      return interaction.reply({ embeds: [buildStatsEmbed(interaction.guild, cfg)], ephemeral: true });
    }
  },

  // ─── Boutons du panneau (routés depuis interactionCreate.js) ───────────────
  async handleButton(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Permission manquante', 'Il faut la permission **Gérer le serveur**.')], ephemeral: true });
    }
    const id = interaction.customId;
    const cfg = await getOrCreateConfig(interaction.guildId);

    if (id === 'wlb_toggle') {
      if (!cfg.enabled && !cfg.channelId) {
        return interaction.reply({ embeds: [warningEmbed('Salon requis', 'Choisis d\'abord un salon de bienvenue (bouton 📺).')], ephemeral: true });
      }
      cfg.enabled = !cfg.enabled;
      await cfg.save();
      await interaction.deferUpdate();
      return refreshPanel(interaction, cfg);
    }

    if (id === 'wlb_channel') {
      const options = interaction.guild.channels.cache
        .filter(c => c.type === ChannelType.GuildText)
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .first(25)
        .map(c => ({ label: c.name.slice(0, 100), value: c.id }));
      if (!options.length) {
        return interaction.reply({ embeds: [errorEmbed('Aucun salon', 'Aucun salon texte trouvé sur ce serveur.')], ephemeral: true });
      }
      return interaction.reply({
        embeds: [infoEmbed('Salon de bienvenue', 'Choisis où poster les messages d\'arrivée.')],
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('wls_channel').setPlaceholder('Salon des bienvenues').addOptions(options),
        )],
        ephemeral: true,
      });
    }

    if (id === 'wlb_style') {
      const modal = new ModalBuilder().setCustomId('wlm_message').setTitle('✍️ Message de bienvenue');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('wl_message')
            .setLabel('Message (variables : {user}, {server}…)')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(cfg.message || 'Bienvenue {user} sur **{server}** !')
            .setMaxLength(1500)
            .setRequired(true),
        ),
      );
      return interaction.showModal(modal);
    }

    if (id === 'wlb_image') {
      return interaction.reply({
        embeds: [infoEmbed('Image de bienvenue', 'Choisis le style de carte générée par Bumpify.')],
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('wls_image').addOptions([
            { label: 'Aucune image', value: 'off', description: 'Embed avec miniature de l\'avatar', emoji: '🚫' },
            { label: 'Gradient néon', value: 'gradient', description: 'Grille futuriste + dégradé violet/rose', emoji: '🌈' },
            { label: 'Vitrail de glace', value: 'glass', description: 'Carte de glace bleue, reflets et halos', emoji: '❄️' },
            { label: 'Bandeau diagonal', value: 'banner', description: 'Bandeau coloré, pastille avatar à gauche', emoji: '🎭' },
            { label: 'Carte épurée', value: 'minimal', description: 'Fond clair, cadre fin, typographie centrée', emoji: '⬜' },
          ]),
        )],
        ephemeral: true,
      });
    }

    if (id === 'wlb_dm') {
      const modal = new ModalBuilder().setCustomId('wlm_dm').setTitle('📩 MP de bienvenue');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('wl_dm')
            .setLabel('Message privé (vide = désactivé)')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(cfg.dmEnabled ? cfg.dmMessage : '')
            .setPlaceholder('Bienvenue sur {server} {user} ! Lis le règlement : {rules}')
            .setMaxLength(1500)
            .setRequired(false),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('wl_dm_embed')
            .setLabel('Format : "embed" ou "texte"')
            .setStyle(TextInputStyle.Short)
            .setValue(cfg.dmEmbed ? 'embed' : 'texte')
            .setMaxLength(6)
            .setRequired(true),
        ),
      );
      return interaction.showModal(modal);
    }

    if (id === 'wlb_buttons') {
      const current = (cfg.buttons || []).map(b => `${b.label} | ${b.url}${b.emoji ? ` | ${b.emoji}` : ''}`).join('\n');
      const modal = new ModalBuilder().setCustomId('wlm_buttons').setTitle('🔗 Boutons d\'accueil');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('wl_buttons')
            .setLabel('Un bouton par ligne : label | lien | emoji')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(current)
            .setPlaceholder('Règlement | https://exemple.com/reglement | 📜\nSupport | https://discord.gg/…')
            .setMaxLength(1000)
            .setRequired(false),
        ),
      );
      return interaction.showModal(modal);
    }

    if (id === 'wlb_counter') {
      const voices = interaction.guild.channels.cache
        .filter(c => c.type === ChannelType.GuildVoice)
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .first(24)
        .map(c => ({ label: c.name.slice(0, 100), value: c.id }));
      return interaction.reply({
        embeds: [infoEmbed('Compteur de membres', 'Un salon vocal renommé automatiquement avec le nombre de membres.')],
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('wls_counter').addOptions([
            { label: 'Désactiver le compteur', value: 'off', emoji: '🚫' },
            ...voices,
          ]),
        )],
        ephemeral: true,
      });
    }

    if (id === 'wlb_render') {
      return interaction.reply({
        embeds: [infoEmbed('Style de rendu', 'Embed riche (coloré, titre, image) ou message brut avec mentions actives.')],
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('wls_render').addOptions([
            { label: 'Embed riche', value: 'embed', description: 'Embed coloré avec titre et image' },
            { label: 'Message brut', value: 'plain', description: 'Texte avec mentions actives, sans embed' },
          ]),
        )],
        ephemeral: true,
      });
    }

    if (id === 'wlb_title') {
      const modal = new ModalBuilder().setCustomId('wlm_title').setTitle('🏷️ Titre de l\'embed');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('wl_title')
            .setLabel('Titre (variables acceptées)')
            .setStyle(TextInputStyle.Short)
            .setValue(cfg.embedTitle || '👋 Bienvenue')
            .setMaxLength(256)
            .setRequired(false),
        ),
      );
      return interaction.showModal(modal);
    }

    if (id === 'wlb_color') {
      const modal = new ModalBuilder().setCustomId('wlm_color').setTitle('🖌️ Couleur de l\'embed');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('wl_color')
            .setLabel('Couleur hexadécimale (ex : #57F287)')
            .setStyle(TextInputStyle.Short)
            .setValue(cfg.embedColor || '#57F287')
            .setMaxLength(7)
            .setRequired(true),
        ),
      );
      return interaction.showModal(modal);
    }

    if (id === 'wlb_test') return runTest(interaction);

    if (id === 'wlb_stats') {
      return interaction.reply({ embeds: [buildStatsEmbed(interaction.guild, cfg)], ephemeral: true });
    }
  },

  // ─── Menus déroulants du panneau ─────────────────────────────────────────────
  async handleSelect(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Permission manquante', 'Il faut la permission **Gérer le serveur**.')], ephemeral: true });
    }
    const cfg = await getOrCreateConfig(interaction.guildId);
    const value = interaction.values[0];

    if (interaction.customId === 'wls_channel') {
      cfg.channelId = value;
      await cfg.save();
      await interaction.update({ embeds: [successEmbed('Salon enregistré', `Les bienvenues seront postées dans <#${value}>.`)], components: [] });
      return refreshPanel(interaction, cfg);
    }

    if (interaction.customId === 'wls_render') {
      cfg.renderStyle = value;
      await cfg.save();
      await interaction.update({ embeds: [successEmbed('Style enregistré', value === 'plain' ? 'Message brut avec mentions actives.' : 'Embed riche avec titre et image.')], components: [] });
      return refreshPanel(interaction, cfg);
    }

    if (interaction.customId === 'wls_image') {
      cfg.imageStyle = value;
      await cfg.save();
      await interaction.update({ embeds: [successEmbed('Image enregistrée', `Style : **${IMAGE_STYLE_LABELS[value]}**. Utilise \`/welcome test\` pour voir le rendu.`)], components: [] });
      return refreshPanel(interaction, cfg);
    }

    if (interaction.customId === 'wls_counter') {
      if (value === 'off') {
        cfg.counterEnabled = false;
      } else {
        cfg.counterEnabled = true;
        cfg.counterChannelId = value;
      }
      await cfg.save();
      const { updateMemberCounter } = require('../../utils/welcomeManager');
      const ok = cfg.counterEnabled ? await updateMemberCounter(interaction.guild, cfg) : false;
      await interaction.update({
        embeds: [cfg.counterEnabled
          ? successEmbed('Compteur activé', `<#${value}> sera renommé à chaque arrivée/départ.${ok ? '' : '\n⚠️ Le bot a besoin de la permission **Gérer les salons** et d\'un salon vocal.'}`)
          : successEmbed('Compteur désactivé', '')],
        components: [],
      });
      return refreshPanel(interaction, cfg);
    }
  },

  // ─── Modaux (routés depuis interactionCreate.js) ────────────────────────────
  async handleModal(interaction) {
    const id = interaction.customId;
    const cfg = await getOrCreateConfig(interaction.guildId);

    if (id === 'wlm_message') {
      cfg.message = interaction.fields.getTextInputValue('wl_message');
      await cfg.save();
      await interaction.reply({ embeds: [successEmbed('Message mis à jour', `>>> ${cfg.message.slice(0, 500)}`)], ephemeral: true });
      return refreshPanel(interaction, cfg);
    }

    if (id === 'wlm_dm') {
      const dmText = interaction.fields.getTextInputValue('wl_dm').trim();
      const fmt = interaction.fields.getTextInputValue('wl_dm_embed').toLowerCase();
      if (!dmText) {
        cfg.dmEnabled = false;
      } else {
        cfg.dmEnabled = true;
        cfg.dmMessage = dmText;
        cfg.dmEmbed = fmt !== 'texte';
      }
      await cfg.save();
      await interaction.reply({
        embeds: [cfg.dmEnabled
          ? successEmbed('MP de bienvenue activé', `Format : **${cfg.dmEmbed ? 'embed' : 'texte'}**\n>>> ${cfg.dmMessage.slice(0, 300)}`)
          : successEmbed('MP de bienvenue désactivé', '')],
        ephemeral: true,
      });
      return refreshPanel(interaction, cfg);
    }

    if (id === 'wlm_buttons') {
      const raw = interaction.fields.getTextInputValue('wl_buttons').trim();
      const buttons = [];
      if (raw) {
        for (const line of raw.split('\n').slice(0, 5)) {
          const parts = line.split('|').map(p => p.trim());
          if (parts.length >= 2 && /^https?:\/\//i.test(parts[1])) {
            buttons.push({ label: parts[0].slice(0, 80), url: parts[1].slice(0, 512), emoji: parts[2] || null });
          }
        }
      }
      cfg.buttons = buttons;
      await cfg.save();
      await interaction.reply({
        embeds: [buttons.length
          ? successEmbed('Boutons enregistrés', `${buttons.length} bouton(s) seront ajoutés sous le message de bienvenue.`)
          : successEmbed('Boutons supprimés', 'Aucun bouton ne sera affiché.')],
        ephemeral: true,
      });
      return refreshPanel(interaction, cfg);
    }

    if (id === 'wlm_title') {
      const v = interaction.fields.getTextInputValue('wl_title').trim() || '👋 Bienvenue';
      cfg.embedTitle = v;
      await cfg.save();
      await interaction.reply({ embeds: [successEmbed('Titre mis à jour', `Nouveau titre : **${v}**`)], ephemeral: true });
      return refreshPanel(interaction, cfg);
    }

    if (id === 'wlm_color') {
      const v = interaction.fields.getTextInputValue('wl_color').trim();
      if (!HEX_REGEX.test(v)) {
        return interaction.reply({ embeds: [errorEmbed('Couleur invalide', 'Format attendu : `#RRGGBB` (ex : `#57F287`).')], ephemeral: true });
      }
      cfg.embedColor = v;
      await cfg.save();
      await interaction.reply({ embeds: [successEmbed('Couleur mise à jour', `Nouvelle couleur : **${v}**`)], ephemeral: true });
      return refreshPanel(interaction, cfg);
    }
  },
};
