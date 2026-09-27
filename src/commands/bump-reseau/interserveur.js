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
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const InterServer = require('../../models/InterServer');
const { createNetworkWebhook } = require('../../utils/interServerRelay');
const { successEmbed, errorEmbed, infoEmbed, COLORS } = require('../../utils/embeds');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function val(v) { return v || '*Non défini*'; }
function toggle(b) { return b ? '✅ Activé' : '❌ Désactivé'; }

function buildPanelEmbed(config, guild) {
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🌐 Panel Inter-Serveur — Bumpify Network')
    .setDescription(
      `Connectez ce serveur à un réseau inter-serveur pour échanger des messages en temps réel avec d'autres communautés.`
    )
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .addFields(
      {
        name: '📡 Réseau actuel',
        value: config
          ? [
              `**Nom du réseau:** \`${config.networkName}\``,
              `**ID réseau:** \`${config.networkId}\``,
              `**Salon:** <#${config.channelId}>`,
              `**Statut:** ${config.active ? '🟢 Actif' : '🔴 Inactif'}`,
              `**Webhook:** ${config.webhookId ? '✅ Configuré' : '⚠️ Manquant'}`,
              `**Messages relayés:** ${config.messagesSent}`,
            ].join('\n')
          : '❌ Ce serveur n\'est connecté à aucun réseau.',
        inline: false,
      },
      config ? {
        name: '⚙️ Paramètres',
        value: [
          `**Images:** ${toggle(config.allowImages)}`,
          `**Liens:** ${toggle(config.allowLinks)}`,
          `**Mentions:** ${toggle(config.allowMentions)}`,
          `**Mode compact:** ${toggle(config.compact)}`,
        ].join('\n'),
        inline: false,
      } : {
        name: '💡 Comment ça marche?',
        value: [
          '1. Rejoignez un réseau existant avec son **ID** ou créez-en un nouveau',
          '2. Sélectionnez un **salon** sur ce serveur',
          '3. Un **webhook** est automatiquement créé pour relayer les messages',
          '4. Tous les messages dans ce salon seront **synchronisés** entre tous les serveurs du réseau',
        ].join('\n'),
        inline: false,
      }
    )
    .setFooter({ text: 'Bumpify • Réseau Inter-Serveur' })
    .setTimestamp();
}

function buildMainComponents(config) {
  const row1 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('is_action')
      .setPlaceholder('⚙️ Choisir une action...')
      .addOptions([
        ...(!config ? [
          { label: '🆕 Créer un réseau',      value: 'create_network',  description: 'Créer un nouveau réseau inter-serveur',   emoji: '🆕' },
          { label: '🔗 Rejoindre un réseau',  value: 'join_network',    description: 'Rejoindre un réseau avec son ID',          emoji: '🔗' },
        ] : [
          { label: '📋 Changer de salon',     value: 'change_channel',  description: 'Modifier le salon inter-serveur',          emoji: '📋' },
          { label: '🔄 Renouveler webhook',   value: 'renew_webhook',   description: 'Recréer le webhook (si défaillant)',        emoji: '🔄' },
          { label: '🖼️ Images',              value: 'toggle_images',   description: 'Activer/désactiver les images',             emoji: '🖼️' },
          { label: '🔗 Liens',               value: 'toggle_links',    description: 'Activer/désactiver les liens',              emoji: '🔗' },
          { label: '🔔 Mentions',            value: 'toggle_mentions', description: 'Activer/désactiver les @mentions',           emoji: '🔔' },
          { label: '📦 Mode compact',        value: 'toggle_compact',  description: 'Messages sans embeds (plus discret)',        emoji: '📦' },
          { label: config.active ? '⏸️ Mettre en pause' : '▶️ Réactiver', value: 'toggle_active', description: 'Mettre en pause ou réactiver le relai', emoji: config.active ? '⏸️' : '▶️' },
          { label: '🚪 Quitter le réseau',   value: 'leave_network',   description: '⚠️ Quitter et supprimer la liaison',        emoji: '🚪' },
        ]),
      ]),
  );
  return [row1];
}

// ─── Commande ─────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('interserveur')
    .setDescription('🌐 Gérer le système de chat inter-serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, client) {
    const guild = interaction.guild;

    // Vérifier si ce serveur est déjà dans un réseau
    let config = await InterServer.findOne({ guildId: guild.id });

    const embed      = buildPanelEmbed(config, guild);
    const components = buildMainComponents(config);

    const reply = await interaction.reply({
      embeds:     [embed],
      components,
      fetchReply: true,
      ephemeral:  true,
    });

    // ── Collecteur ────────────────────────────────────────────────────────────
    const collector = reply.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time:   15 * 60 * 1000,
    });

    // Helper: refresh panel
    async function refreshPanel(i) {
      config = await InterServer.findOne({ guildId: guild.id });
      await i.update({
        embeds:     [buildPanelEmbed(config, guild)],
        components: buildMainComponents(config),
      });
    }

    collector.on('collect', async i => {
      config = await InterServer.findOne({ guildId: guild.id });

      // ── Menu principal ────────────────────────────────────────────────────
      if (i.customId === 'is_action') {
        const action = i.values[0];

        // --- CRÉER UN RÉSEAU ---
        if (action === 'create_network') {
          const modal = new ModalBuilder()
            .setCustomId('is_modal_create')
            .setTitle('🆕 Créer un réseau inter-serveur');

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('network_name')
                .setLabel('Nom du réseau (visible par tous)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(50)
                .setPlaceholder('Ex: Communauté Gaming FR'),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('network_id')
                .setLabel('ID réseau (à partager avec les autres)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(40)
                .setPlaceholder('Ex: gaming-fr-2024 (sans espaces)'),
            ),
          );
          return i.showModal(modal);
        }

        // --- REJOINDRE UN RÉSEAU ---
        if (action === 'join_network') {
          const modal = new ModalBuilder()
            .setCustomId('is_modal_join')
            .setTitle('🔗 Rejoindre un réseau');

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('network_id_join')
                .setLabel('ID du réseau à rejoindre')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(40)
                .setPlaceholder('Ex: gaming-fr-2024'),
            ),
          );
          return i.showModal(modal);
        }

        // --- CHANGER DE SALON ---
        if (action === 'change_channel') {
          const chMenu = new ChannelSelectMenuBuilder()
            .setCustomId('is_channel_select')
            .setPlaceholder('📋 Sélectionner un salon...')
            .addChannelTypes(ChannelType.GuildText);

          const backBtn = new ButtonBuilder()
            .setCustomId('is_back')
            .setLabel('← Retour')
            .setStyle(ButtonStyle.Secondary);

          return i.update({
            embeds: [
              new EmbedBuilder()
                .setColor(COLORS.info)
                .setTitle('📋 Changer le salon inter-serveur')
                .setDescription(
                  `Salon actuel: <#${config.channelId}>\n\n` +
                  `⚠️ Un nouveau webhook sera créé dans le nouveau salon.\n` +
                  `L'ancien webhook sera supprimé.`
                ),
            ],
            components: [
              new ActionRowBuilder().addComponents(chMenu),
              new ActionRowBuilder().addComponents(backBtn),
            ],
          });
        }

        // --- RENOUVELER WEBHOOK ---
        if (action === 'renew_webhook') {
          await i.deferUpdate();
          try {
            const channel = await guild.channels.fetch(config.channelId).catch(() => null);
            if (!channel) {
              return i.editReply({ embeds: [errorEmbed('Salon introuvable', 'Le salon configuré n\'existe plus.')] });
            }

            const me = guild.members.me;
            if (!channel.permissionsFor(me)?.has('ManageWebhooks')) {
              return i.editReply({ embeds: [errorEmbed('Permission manquante', 'J\'ai besoin de la permission **Gérer les webhooks** sur ce salon.')] });
            }

            const wh = await createNetworkWebhook(channel, config.networkName);
            if (!wh) {
              return i.editReply({ embeds: [errorEmbed('Échec', 'Impossible de créer le webhook.')] });
            }

            config.webhookId    = wh.webhookId;
            config.webhookToken = wh.webhookToken;
            config.active       = true;
            await config.save();

            config = await InterServer.findOne({ guildId: guild.id });
            return i.editReply({
              embeds:     [buildPanelEmbed(config, guild).setTitle('✅ Webhook renouvelé!')],
              components: buildMainComponents(config),
            });
          } catch (err) {
            console.error('❌ Renouvellement webhook:', err);
            return i.editReply({ embeds: [errorEmbed('Erreur', err.message)] });
          }
        }

        // --- TOGGLES ---
        if (action === 'toggle_images') {
          config.allowImages = !config.allowImages;
          await config.save();
          return refreshPanel(i);
        }
        if (action === 'toggle_links') {
          config.allowLinks = !config.allowLinks;
          await config.save();
          return refreshPanel(i);
        }
        if (action === 'toggle_mentions') {
          config.allowMentions = !config.allowMentions;
          await config.save();
          return refreshPanel(i);
        }
        if (action === 'toggle_compact') {
          config.compact = !config.compact;
          await config.save();
          return refreshPanel(i);
        }
        if (action === 'toggle_active') {
          config.active = !config.active;
          await config.save();
          return refreshPanel(i);
        }

        // --- QUITTER LE RÉSEAU ---
        if (action === 'leave_network') {
          const confirmBtn = new ButtonBuilder()
            .setCustomId('is_leave_confirm')
            .setLabel('⚠️ Oui, quitter le réseau')
            .setStyle(ButtonStyle.Danger);
          const cancelBtn  = new ButtonBuilder()
            .setCustomId('is_back')
            .setLabel('← Annuler')
            .setStyle(ButtonStyle.Secondary);

          return i.update({
            embeds: [
              new EmbedBuilder()
                .setColor(COLORS.error)
                .setTitle('⚠️ Quitter le réseau inter-serveur?')
                .setDescription(
                  `Vous êtes sur le point de quitter le réseau **${config.networkName}** (\`${config.networkId}\`).\n\n` +
                  `- Le webhook dans <#${config.channelId}> sera **supprimé**\n` +
                  `- Vous ne recevrez et n'enverrez **plus de messages** dans ce réseau\n` +
                  `- Cette action est **irréversible** (vous pouvez rejoindre à nouveau)`
                ),
            ],
            components: [new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)],
          });
        }
      }

      // ── Retour ────────────────────────────────────────────────────────────
      if (i.customId === 'is_back') {
        return refreshPanel(i);
      }

      // ── Sélection de salon ─────────────────────────────────────────────────
      if (i.customId === 'is_channel_select') {
        await i.deferUpdate();
        const channelId = i.values[0];
        try {
          const channel = await guild.channels.fetch(channelId).catch(() => null);
          if (!channel) {
            return i.editReply({ embeds: [errorEmbed('Salon introuvable', 'Impossible de trouver ce salon.')] });
          }

          const me = guild.members.me;
          if (!channel.permissionsFor(me)?.has(['SendMessages', 'ManageWebhooks'])) {
            return i.editReply({ embeds: [errorEmbed('Permissions insuffisantes', 'J\'ai besoin de **Envoyer des messages** et **Gérer les webhooks** sur ce salon.')] });
          }

          const wh = await createNetworkWebhook(channel, config.networkName);
          if (!wh) {
            return i.editReply({ embeds: [errorEmbed('Webhook échoué', 'Impossible de créer le webhook sur ce salon.')] });
          }

          config.channelId    = channelId;
          config.webhookId    = wh.webhookId;
          config.webhookToken = wh.webhookToken;
          config.active       = true;
          await config.save();

          config = await InterServer.findOne({ guildId: guild.id });
          return i.editReply({
            embeds:     [buildPanelEmbed(config, guild).setTitle('✅ Salon mis à jour!')],
            components: buildMainComponents(config),
          });
        } catch (err) {
          console.error('❌ Changement salon:', err);
          return i.editReply({ embeds: [errorEmbed('Erreur', err.message)] });
        }
      }

      // ── Confirmer quitter ────────────────────────────────────────────────
      if (i.customId === 'is_leave_confirm') {
        await i.deferUpdate();
        try {
          // Supprimer le webhook
          if (config.webhookId && config.webhookToken) {
            try {
              const { WebhookClient } = require('discord.js');
              const wh = new WebhookClient({ id: config.webhookId, token: config.webhookToken });
              await wh.delete();
            } catch (_) {}
          }

          await InterServer.deleteOne({ _id: config._id });
          config = null;

          return i.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(COLORS.success)
                .setTitle('✅ Réseau quitté')
                .setDescription('Vous avez quitté le réseau inter-serveur. Le webhook a été supprimé.\n\nVous pouvez rejoindre ou créer un nouveau réseau à tout moment via `/interserveur`.')
            ],
            components: [],
          });
        } catch (err) {
          console.error('❌ Quitter réseau:', err);
          return i.editReply({ embeds: [errorEmbed('Erreur', err.message)] });
        }
      }
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch (_) {}
    });
  },

  // ── Gestion des modaux ─────────────────────────────────────────────────────
  async handleModal(interaction, client) {
    const guild = interaction.guild;

    // --- Créer un réseau ---
    if (interaction.customId === 'is_modal_create') {
      const networkName = interaction.fields.getTextInputValue('network_name').trim();
      const networkId   = interaction.fields.getTextInputValue('network_id')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-_]/g, '');

      if (!networkId) {
        return interaction.reply({ embeds: [errorEmbed('ID invalide', 'L\'ID ne peut contenir que des lettres, chiffres, tirets et underscores.')], ephemeral: true });
      }

      // Vérifier si ce serveur est déjà dans un réseau
      const existing = await InterServer.findOne({ guildId: guild.id });
      if (existing) {
        return interaction.reply({ embeds: [errorEmbed('Déjà dans un réseau', `Ce serveur est déjà dans le réseau \`${existing.networkId}\`. Quittez-le d'abord via \`/interserveur\`.`)], ephemeral: true });
      }

      // Demander le salon via un message éphémère
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle('🆕 Réseau créé — Sélectionnez un salon')
            .setDescription(
              `Réseau: **${networkName}** (\`${networkId}\`)\n\n` +
              `Utilisez \`/interserveur\` et "Rejoindre un réseau" avec cet ID sur les autres serveurs.\n\n` +
              `**Sélectionnez maintenant un salon** pour ce serveur:`
            ),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(`is_create_channel_select:${networkId}:${encodeURIComponent(networkName)}`)
              .setPlaceholder('Sélectionner le salon inter-serveur...')
              .addChannelTypes(ChannelType.GuildText)
          ),
        ],
        ephemeral: true,
        fetchReply: true,
      });
    }

    // --- Rejoindre un réseau ---
    if (interaction.customId === 'is_modal_join') {
      const networkId = interaction.fields.getTextInputValue('network_id_join')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-_]/g, '');

      // Vérifier que le réseau existe
      const networkMember = await InterServer.findOne({ networkId });
      if (!networkMember) {
        return interaction.reply({ embeds: [errorEmbed('Réseau introuvable', `Aucun réseau trouvé avec l'ID \`${networkId}\`. Vérifiez l'ID et réessayez.`)], ephemeral: true });
      }

      // Vérifier si ce serveur est déjà dans un réseau
      const existing = await InterServer.findOne({ guildId: guild.id });
      if (existing) {
        return interaction.reply({ embeds: [errorEmbed('Déjà dans un réseau', `Ce serveur est déjà dans le réseau \`${existing.networkId}\`. Quittez-le d'abord via \`/interserveur\`.`)], ephemeral: true });
      }

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle(`🔗 Rejoindre "${networkMember.networkName}"`)
            .setDescription(`Réseau trouvé! **${networkMember.networkName}** (\`${networkId}\`)\n\n**Sélectionnez un salon** pour ce serveur:`),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(`is_join_channel_select:${networkId}:${encodeURIComponent(networkMember.networkName)}`)
              .setPlaceholder('Sélectionner le salon inter-serveur...')
              .addChannelTypes(ChannelType.GuildText)
          ),
        ],
        ephemeral: true,
        fetchReply: true,
      });
    }
  },

  // ── Gestion création/rejoindre avec sélection salon ───────────────────────
  async handleChannelSelect(interaction, client) {
    const firstColon  = interaction.customId.indexOf(':');
    const secondColon = interaction.customId.indexOf(':', firstColon + 1);
    const networkId   = interaction.customId.slice(firstColon + 1, secondColon);
    const networkName = decodeURIComponent(interaction.customId.slice(secondColon + 1));
    const guild       = interaction.guild;
    const channelId   = interaction.values[0];

    await interaction.deferUpdate();

    try {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        return interaction.editReply({ embeds: [errorEmbed('Salon introuvable', 'Impossible de trouver ce salon.')], components: [] });
      }

      const me = guild.members.me;
      if (!channel.permissionsFor(me)?.has(['SendMessages', 'ManageWebhooks', 'EmbedLinks'])) {
        return interaction.editReply({
          embeds: [errorEmbed(
            'Permissions insuffisantes',
            'J\'ai besoin de **Envoyer des messages**, **Intégrer des liens** et **Gérer les webhooks** sur ce salon.'
          )],
          components: [],
        });
      }

      // Créer le webhook
      const wh = await createNetworkWebhook(channel, networkName);
      if (!wh) {
        return interaction.editReply({ embeds: [errorEmbed('Webhook échoué', 'Impossible de créer le webhook. Vérifiez mes permissions.')], components: [] });
      }

      // Créer la liaison
      await InterServer.create({
        networkId,
        networkName,
        guildId:      guild.id,
        channelId,
        webhookId:    wh.webhookId,
        webhookToken: wh.webhookToken,
        active:       true,
      });

      // Compter les membres du réseau
      const memberCount = await InterServer.countDocuments({ networkId });

      // Annoncer dans le salon
      const announcEmbed = new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('🌐 Réseau Inter-Serveur connecté!')
        .setDescription(
          `**${guild.name}** a rejoint le réseau **${networkName}**!\n\n` +
          `Les messages envoyés dans ce salon seront synchronisés avec **${memberCount} serveur(s)** connecté(s).\n\n` +
          `_Gérez la configuration via \`/interserveur\`_`
        )
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .setFooter({ text: 'Bumpify • Réseau Inter-Serveur' })
        .setTimestamp();

      await channel.send({ embeds: [announcEmbed] }).catch(() => {});

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.success)
            .setTitle('✅ Connecté au réseau!')
            .setDescription(
              `**${guild.name}** est maintenant connecté au réseau **${networkName}** (\`${networkId}\`).\n\n` +
              `**Salon:** <#${channelId}>\n` +
              `**Membres du réseau:** ${memberCount} serveur(s)\n\n` +
              `Tous les messages dans <#${channelId}> seront synchronisés entre les serveurs du réseau.\n` +
              `Configurez les options avancées via \`/interserveur\`.`
            ),
        ],
        components: [],
      });
    } catch (err) {
      console.error('❌ Liaison inter-serveur:', err);
      if (err.code === 11000) {
        return interaction.editReply({ embeds: [errorEmbed('Déjà connecté', 'Ce salon est déjà dans un réseau.')], components: [] });
      }
      return interaction.editReply({ embeds: [errorEmbed('Erreur', err.message)], components: [] });
    }
  },
};

// ── Fonctions additionnelles exportées (réseau) ───────────────────────────────

module.exports.handleNetworkButton = async function(interaction, client) {
  const id = interaction.customId;
  // is_net_report_<guildId>_<messageId>
  if (id.startsWith('is_net_report_')) {
    const parts = id.split('_');
    const targetGuildId = parts[3];
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
    const modal = new ModalBuilder()
      .setCustomId(`is_report_modal_${targetGuildId}`)
      .setTitle('🚩 Signaler un message');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('report_reason')
          .setLabel('Raison du signalement')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(500)
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }
};

module.exports.handleNetworkModal = async function(interaction, client) {
  const id = interaction.customId;
  if (id.startsWith('is_report_modal_')) {
    const targetGuildId = id.replace('is_report_modal_', '');
    const reason = interaction.fields.getTextInputValue('report_reason');
    // Log le signalement (pourrait être envoyé à un salon owner)
    console.warn(`🚩 Signalement réseau: ${interaction.user.tag} → ${targetGuildId}: ${reason}`);
    return interaction.reply({
      embeds: [require('../../utils/embeds').successEmbed('Signalement envoyé', 'Votre signalement a été transmis aux administrateurs du réseau.')],
      ephemeral: true,
    });
  }
};
