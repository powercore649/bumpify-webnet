const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
} = require('discord.js');
const Server = require('../../models/Server');
const { successEmbed, errorEmbed, COLORS } = require('../../utils/embeds');

// ─── helpers ────────────────────────────────────────────────────────────────

function val(v) { return v || '*Non défini*'; }

function buildMainEmbed(server, guild) {
  const icon = guild.iconURL({ dynamic: true });
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('⚙️ Panel de Configuration — Bumpify')
    .setDescription('Sélectionnez une catégorie à configurer via le menu ci-dessous.\nToutes les modifications sont **sauvegardées automatiquement**.')
    .setThumbnail(icon)
    .addFields(
      {
        name: '📝 Présentation',
        value: [
          `**Description:** ${server.description ? `\`${server.description.slice(0, 60)}${server.description.length > 60 ? '…' : ''}\`` : '*Non définie*'}`,
          `**Invitation:** ${server.inviteLink ? `[Lien](<${server.inviteLink}>)` : '*Non défini*'}`,
          `**Tags:** ${server.tags.length > 0 ? server.tags.map(t => `\`${t}\``).join(' ') : '*Aucun*'}`,
          `**Langue:** \`${server.language.toUpperCase()}\``,
          `**NSFW:** ${server.nsfw ? '🔞 Oui' : '✅ Non'}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '📢 Salons & Rôles',
        value: [
          `**Salon bump:** ${server.bumpChannelId ? `<#${server.bumpChannelId}>` : '*Non défini*'}`,
          `**Salon feed:** ${server.feedChannelId ? `<#${server.feedChannelId}>` : '*Non défini*'}`,
          `**Salon logs:** ${server.logChannelId  ? `<#${server.logChannelId}>` : '*Non défini*'}`,
          `**Rôle rappel:** ${server.bumpRoleId   ? `<@&${server.bumpRoleId}>` : '*Non défini*'}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '⏰ Rappels',
        value: server.reminderEnabled ? '✅ Activés' : '❌ Désactivés',
        inline: true,
      },
      {
        name: '📊 Statistiques',
        value: `${server.bumpCount} bump(s) au total`,
        inline: true,
      },
    )
    .setFooter({ text: 'Bumpify • Panel de configuration' })
    .setTimestamp();
}

function buildMainComponents(server) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('config_category')
    .setPlaceholder('📂 Choisir une catégorie...')
    .addOptions([
      { label: '📝 Description',      value: 'description', description: 'Modifier la description du serveur',    emoji: '📝' },
      { label: '🔗 Lien invitation',  value: 'invite',      description: 'Définir le lien d\'invitation',         emoji: '🔗' },
      { label: '🏷️ Tags',             value: 'tags',        description: 'Gérer les tags (gaming, fr, etc.)',      emoji: '🏷️' },
      { label: '🌐 Langue',           value: 'language',    description: 'Définir la langue du serveur',           emoji: '🌐' },
      { label: '📢 Salon bump',       value: 'bump_ch',     description: 'Salon autorisé pour /bump',              emoji: '📢' },
      { label: '📡 Salon feed',       value: 'feed_ch',     description: 'Recevoir les bumps des autres serveurs', emoji: '📡' },
      { label: '📋 Salon logs',       value: 'log_ch',      description: 'Journal interne des bumps',              emoji: '📋' },
      { label: '🔔 Rôle rappel',      value: 'role',        description: 'Rôle pingé lors des rappels',            emoji: '🔔' },
      { label: '⏰ Rappels auto',     value: 'reminder',    description: 'Activer/désactiver les rappels',         emoji: '⏰' },
      { label: '🔞 Mode NSFW',        value: 'nsfw',        description: 'Marquer le serveur comme NSFW',          emoji: '🔞' },
    ]);

  return [new ActionRowBuilder().addComponents(menu)];
}

// ─── Commande principale ────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('⚙️ Ouvrir le panel de configuration Bumpify')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, client) {
    const guild = interaction.guild;

    // Récupérer ou créer la config
    let server = await Server.findOneAndUpdate(
      { guildId: guild.id },
      { $setOnInsert: { guildId: guild.id, guildName: guild.name, memberCount: guild.memberCount } },
      { upsert: true, new: true }
    );

    server.guildName   = guild.name;
    server.memberCount = guild.memberCount;
    await server.save();

    const embed      = buildMainEmbed(server, guild);
    const components = buildMainComponents(server);

    const reply = await interaction.reply({ embeds: [embed], components, fetchReply: true, ephemeral: true });

    // ── Collecteur d'interactions ──────────────────────────────────────────
    const collector = reply.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time:   10 * 60 * 1000, // 10 minutes
    });

    collector.on('collect', async i => {
      // Recharger les données fraîches à chaque interaction
      server = await Server.findOne({ guildId: guild.id });

      // ── Menu principal ─────────────────────────────────────────────────
      if (i.customId === 'config_category') {
        const choice = i.values[0];

        // --- DESCRIPTION ---
        if (choice === 'description') {
          const modal = new ModalBuilder()
            .setCustomId('modal_description')
            .setTitle('📝 Modifier la description');
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('desc_input')
                .setLabel('Description du serveur (max 500 caractères)')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(500)
                .setRequired(true)
                .setValue(server.description || '')
                .setPlaceholder('Ex: Serveur communautaire gaming francophone, rejoignez-nous!'),
            ),
          );
          return i.showModal(modal);
        }

        // --- INVITE ---
        if (choice === 'invite') {
          const modal = new ModalBuilder()
            .setCustomId('modal_invite')
            .setTitle('🔗 Lien d\'invitation');
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('invite_input')
                .setLabel('Lien d\'invitation (discord.gg/...)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(server.inviteLink || '')
                .setPlaceholder('https://discord.gg/monserveur'),
            ),
          );
          return i.showModal(modal);
        }

        // --- TAGS ---
        if (choice === 'tags') {
          const modal = new ModalBuilder()
            .setCustomId('modal_tags')
            .setTitle('🏷️ Tags du serveur');
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('tags_input')
                .setLabel('Tags séparés par des virgules (max 10)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setValue(server.tags.join(', ') || '')
                .setPlaceholder('gaming, minecraft, francophone, 18+'),
            ),
          );
          return i.showModal(modal);
        }

        // --- LANGUE ---
        if (choice === 'language') {
          const langMenu = new StringSelectMenuBuilder()
            .setCustomId('config_language')
            .setPlaceholder('🌐 Sélectionner la langue...')
            .addOptions([
              { label: '🇫🇷 Français',   value: 'fr',  emoji: '🇫🇷' },
              { label: '🇬🇧 Anglais',    value: 'en',  emoji: '🇬🇧' },
              { label: '🇪🇸 Espagnol',   value: 'es',  emoji: '🇪🇸' },
              { label: '🇩🇪 Allemand',   value: 'de',  emoji: '🇩🇪' },
              { label: '🇵🇹 Portugais',  value: 'pt',  emoji: '🇵🇹' },
              { label: '🇮🇹 Italien',    value: 'it',  emoji: '🇮🇹' },
              { label: '🇳🇱 Néerlandais',value: 'nl',  emoji: '🇳🇱' },
              { label: '🌍 Autre',       value: 'other',emoji: '🌍' },
            ]);

          const backBtn = new ButtonBuilder()
            .setCustomId('config_back')
            .setLabel('← Retour')
            .setStyle(ButtonStyle.Secondary);

          return i.update({
            embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('🌐 Sélectionner la langue').setDescription(`Langue actuelle: **${server.language.toUpperCase()}**`)],
            components: [
              new ActionRowBuilder().addComponents(langMenu),
              new ActionRowBuilder().addComponents(backBtn),
            ],
          });
        }

        // --- SALON BUMP ---
        if (choice === 'bump_ch') {
          const chMenu = new ChannelSelectMenuBuilder()
            .setCustomId('config_bump_channel')
            .setPlaceholder('📢 Salon pour /bump...')
            .addChannelTypes(ChannelType.GuildText);

          const backBtn = new ButtonBuilder().setCustomId('config_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary);
          const clearBtn = new ButtonBuilder().setCustomId('clear_bump_ch').setLabel('🗑️ Retirer').setStyle(ButtonStyle.Danger);

          return i.update({
            embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('📢 Salon pour /bump').setDescription(`Actuellement: ${server.bumpChannelId ? `<#${server.bumpChannelId}>` : '*Non défini*'}\n\nSélectionnez le salon où les membres pourront utiliser \`/bump\`.`)],
            components: [
              new ActionRowBuilder().addComponents(chMenu),
              new ActionRowBuilder().addComponents(backBtn, clearBtn),
            ],
          });
        }

        // --- SALON FEED ---
        if (choice === 'feed_ch') {
          const chMenu = new ChannelSelectMenuBuilder()
            .setCustomId('config_feed_channel')
            .setPlaceholder('📡 Salon feed...')
            .addChannelTypes(ChannelType.GuildText);

          const backBtn  = new ButtonBuilder().setCustomId('config_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary);
          const clearBtn = new ButtonBuilder().setCustomId('clear_feed_ch').setLabel('🗑️ Retirer').setStyle(ButtonStyle.Danger);

          return i.update({
            embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('📡 Salon feed').setDescription(`Actuellement: ${server.feedChannelId ? `<#${server.feedChannelId}>` : '*Non défini*'}\n\nLe salon feed reçoit les bumps des **autres serveurs** du réseau Bumpify. Configurez-en un pour rejoindre le réseau!`)],
            components: [
              new ActionRowBuilder().addComponents(chMenu),
              new ActionRowBuilder().addComponents(backBtn, clearBtn),
            ],
          });
        }

        // --- SALON LOGS ---
        if (choice === 'log_ch') {
          const chMenu = new ChannelSelectMenuBuilder()
            .setCustomId('config_log_channel')
            .setPlaceholder('📋 Salon logs...')
            .addChannelTypes(ChannelType.GuildText);

          const backBtn  = new ButtonBuilder().setCustomId('config_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary);
          const clearBtn = new ButtonBuilder().setCustomId('clear_log_ch').setLabel('🗑️ Retirer').setStyle(ButtonStyle.Danger);

          return i.update({
            embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('📋 Salon logs').setDescription(`Actuellement: ${server.logChannelId ? `<#${server.logChannelId}>` : '*Non défini*'}\n\nCe salon reçoit un log à chaque fois qu'un membre utilise \`/bump\`.`)],
            components: [
              new ActionRowBuilder().addComponents(chMenu),
              new ActionRowBuilder().addComponents(backBtn, clearBtn),
            ],
          });
        }

        // --- RÔLE ---
        if (choice === 'role') {
          const roleMenu = new RoleSelectMenuBuilder()
            .setCustomId('config_bump_role')
            .setPlaceholder('🔔 Rôle à pinger...');

          const backBtn  = new ButtonBuilder().setCustomId('config_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary);
          const clearBtn = new ButtonBuilder().setCustomId('clear_role').setLabel('🗑️ Retirer').setStyle(ButtonStyle.Danger);

          return i.update({
            embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('🔔 Rôle de rappel').setDescription(`Actuellement: ${server.bumpRoleId ? `<@&${server.bumpRoleId}>` : '*Non défini*'}\n\nCe rôle sera mentionné quand le cooldown de 2h expire.`)],
            components: [
              new ActionRowBuilder().addComponents(roleMenu),
              new ActionRowBuilder().addComponents(backBtn, clearBtn),
            ],
          });
        }

        // --- RAPPELS ---
        if (choice === 'reminder') {
          const enableBtn  = new ButtonBuilder().setCustomId('reminder_on').setLabel('✅ Activer').setStyle(ButtonStyle.Success).setDisabled(server.reminderEnabled);
          const disableBtn = new ButtonBuilder().setCustomId('reminder_off').setLabel('❌ Désactiver').setStyle(ButtonStyle.Danger).setDisabled(!server.reminderEnabled);
          const backBtn    = new ButtonBuilder().setCustomId('config_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary);

          return i.update({
            embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('⏰ Rappels automatiques').setDescription(`Statut actuel: ${server.reminderEnabled ? '✅ **Activés**' : '❌ **Désactivés**'}\n\nLes rappels envoient un message dans le salon bump quand le cooldown de 2h est terminé.`)],
            components: [new ActionRowBuilder().addComponents(enableBtn, disableBtn, backBtn)],
          });
        }

        // --- NSFW ---
        if (choice === 'nsfw') {
          const onBtn   = new ButtonBuilder().setCustomId('nsfw_on').setLabel('🔞 Marquer NSFW').setStyle(ButtonStyle.Danger).setDisabled(server.nsfw);
          const offBtn  = new ButtonBuilder().setCustomId('nsfw_off').setLabel('✅ Retirer NSFW').setStyle(ButtonStyle.Success).setDisabled(!server.nsfw);
          const backBtn = new ButtonBuilder().setCustomId('config_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary);

          return i.update({
            embeds: [new EmbedBuilder().setColor(COLORS.warning).setTitle('🔞 Mode NSFW').setDescription(`Statut actuel: ${server.nsfw ? '🔞 **NSFW**' : '✅ **SFW**'}\n\nMarquer votre serveur comme NSFW l'indique aux autres utilisateurs.`)],
            components: [new ActionRowBuilder().addComponents(onBtn, offBtn, backBtn)],
          });
        }
      }

      // ── Retour menu principal ──────────────────────────────────────────
      if (i.customId === 'config_back') {
        server = await Server.findOne({ guildId: guild.id });
        return i.update({ embeds: [buildMainEmbed(server, guild)], components: buildMainComponents(server) });
      }

      // ── Sélection langue ───────────────────────────────────────────────
      if (i.customId === 'config_language') {
        server.language = i.values[0];
        await server.save();
        server = await Server.findOne({ guildId: guild.id });
        return i.update({
          embeds: [buildMainEmbed(server, guild).setTitle('✅ Langue mise à jour!')],
          components: buildMainComponents(server),
        });
      }

      // ── Sélection salons ───────────────────────────────────────────────
      if (i.customId === 'config_bump_channel') {
        server.bumpChannelId = i.values[0];
        await server.save();
        server = await Server.findOne({ guildId: guild.id });
        return i.update({ embeds: [buildMainEmbed(server, guild)], components: buildMainComponents(server) });
      }

      if (i.customId === 'config_feed_channel') {
        server.feedChannelId = i.values[0];
        await server.save();
        server = await Server.findOne({ guildId: guild.id });
        return i.update({ embeds: [buildMainEmbed(server, guild)], components: buildMainComponents(server) });
      }

      if (i.customId === 'config_log_channel') {
        server.logChannelId = i.values[0];
        await server.save();
        server = await Server.findOne({ guildId: guild.id });
        return i.update({ embeds: [buildMainEmbed(server, guild)], components: buildMainComponents(server) });
      }

      // ── Sélection rôle ─────────────────────────────────────────────────
      if (i.customId === 'config_bump_role') {
        server.bumpRoleId = i.values[0];
        await server.save();
        server = await Server.findOne({ guildId: guild.id });
        return i.update({ embeds: [buildMainEmbed(server, guild)], components: buildMainComponents(server) });
      }

      // ── Boutons clear ──────────────────────────────────────────────────
      if (i.customId === 'clear_bump_ch') {
        server.bumpChannelId = null; await server.save();
        server = await Server.findOne({ guildId: guild.id });
        return i.update({ embeds: [buildMainEmbed(server, guild)], components: buildMainComponents(server) });
      }
      if (i.customId === 'clear_feed_ch') {
        server.feedChannelId = null; await server.save();
        server = await Server.findOne({ guildId: guild.id });
        return i.update({ embeds: [buildMainEmbed(server, guild)], components: buildMainComponents(server) });
      }
      if (i.customId === 'clear_log_ch') {
        server.logChannelId = null; await server.save();
        server = await Server.findOne({ guildId: guild.id });
        return i.update({ embeds: [buildMainEmbed(server, guild)], components: buildMainComponents(server) });
      }
      if (i.customId === 'clear_role') {
        server.bumpRoleId = null; await server.save();
        server = await Server.findOne({ guildId: guild.id });
        return i.update({ embeds: [buildMainEmbed(server, guild)], components: buildMainComponents(server) });
      }

      // ── Boutons rappels ────────────────────────────────────────────────
      if (i.customId === 'reminder_on' || i.customId === 'reminder_off') {
        server.reminderEnabled = (i.customId === 'reminder_on');
        await server.save();
        server = await Server.findOne({ guildId: guild.id });
        return i.update({ embeds: [buildMainEmbed(server, guild)], components: buildMainComponents(server) });
      }

      // ── Boutons NSFW ───────────────────────────────────────────────────
      if (i.customId === 'nsfw_on' || i.customId === 'nsfw_off') {
        server.nsfw = (i.customId === 'nsfw_on');
        await server.save();
        server = await Server.findOne({ guildId: guild.id });
        return i.update({ embeds: [buildMainEmbed(server, guild)], components: buildMainComponents(server) });
      }

      // ── Votes (bouton sur les bumps du réseau) ─────────────────────────
      if (i.customId.startsWith('vote_')) {
        const targetGuildId = i.customId.split('_')[1];
        const Vote = require('../../models/Vote');
        try {
          await Vote.create({ voterId: i.user.id, targetId: targetGuildId });
          await Server.findOneAndUpdate({ guildId: targetGuildId }, { $inc: { totalVotes: 1 } });
          return i.reply({ embeds: [successEmbed('Vote enregistré!', `Vous avez voté pour ce serveur! 👍`)], ephemeral: true });
        } catch (e) {
          if (e.code === 11000) {
            return i.reply({ embeds: [errorEmbed('Déjà voté', 'Vous avez déjà voté pour ce serveur!')], ephemeral: true });
          }
          return i.reply({ embeds: [errorEmbed('Erreur', 'Une erreur est survenue.')], ephemeral: true });
        }
      }
    });

    // ── Collecteur de modaux ───────────────────────────────────────────────
    const modalCollector = interaction.channel?.createMessageComponentCollector
      ? null : null; // Les modaux sont gérés via l'événement interactionCreate global

    collector.on('end', async () => {
      try {
        server = await Server.findOne({ guildId: guild.id });
        const expiredEmbed = buildMainEmbed(server, guild)
          .setFooter({ text: 'Session expirée. Relancez /config.' })
          .setColor(0x5c5f65);
        await interaction.editReply({ embeds: [expiredEmbed], components: [] });
      } catch (_) {}
    });
  },

  // ── Gestion des modaux (appelée depuis interactionCreate) ──────────────
  async handleModal(interaction) {
    const guild = interaction.guild;
    let server  = await Server.findOne({ guildId: guild.id });
    if (!server) return interaction.reply({ content: 'Erreur: serveur introuvable.', ephemeral: true });

    if (interaction.customId === 'modal_description') {
      const text = interaction.fields.getTextInputValue('desc_input').trim();
      server.description = text;
      await server.save();
      return interaction.reply({ embeds: [successEmbed('Description mise à jour!', `\`\`\`${text}\`\`\``)], ephemeral: true });
    }

    if (interaction.customId === 'modal_invite') {
      const link = interaction.fields.getTextInputValue('invite_input').trim();
      if (!link.includes('discord.gg/') && !link.includes('discord.com/invite/')) {
        return interaction.reply({ embeds: [errorEmbed('Lien invalide', 'Utilisez un lien discord.gg/ ou discord.com/invite/')], ephemeral: true });
      }
      server.inviteLink = link;
      await server.save();
      return interaction.reply({ embeds: [successEmbed('Lien d\'invitation mis à jour!', link)], ephemeral: true });
    }

    if (interaction.customId === 'modal_tags') {
      const raw  = interaction.fields.getTextInputValue('tags_input').trim();
      const tags = raw
        ? raw.split(',').map(t => t.trim().toLowerCase().slice(0, 20)).filter(Boolean).slice(0, 10)
        : [];
      server.tags = tags;
      await server.save();
      return interaction.reply({
        embeds: [successEmbed('Tags mis à jour!', tags.length > 0 ? tags.map(t => `\`${t}\``).join(' ') : '*Aucun tag défini*')],
        ephemeral: true,
      });
    }
  },
};
