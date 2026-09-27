const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { Confession, ConfessionConfig } = require('../../models/Confession.js');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');

const confessionCooldown = new Map();

function buildConfigEmbed(config, guild) {
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🤫 Système de Confessions — Configuration')
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .addFields(
      { name: '📢 Statut',        value: config?.enabled    ? '🟢 Activé' : '🔴 Désactivé',               inline: true },
      { name: '📝 Salon',         value: config?.channelId  ? `<#${config.channelId}>` : '*Non défini*',    inline: true },
      { name: '🔍 Salon de logs', value: config?.logChannelId ? `<#${config.logChannelId}>` : '*Non défini*', inline: true },
      { name: '🛡️ Modération',   value: config?.moderation ? '✅ Approbation requise' : '❌ Publication directe', inline: true },
      { name: '🖼️ Images',       value: config?.allowImages ? '✅ Autorisées' : '❌ Refusées',              inline: true },
      { name: '⏱️ Cooldown',     value: `${config?.cooldownMin ?? 5} minute(s)`,                           inline: true },
    )
    .setFooter({ text: 'Bumpify • Confessions' })
    .setTimestamp();
}

function buildConfigComponents(config) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('conf_action')
    .setPlaceholder('⚙️ Configurer...')
    .addOptions([
      { label: '📢 Salon de confession', value: 'set_channel',   emoji: '📢' },
      { label: '🔍 Salon de logs',       value: 'set_log',       emoji: '🔍' },
      { label: config?.moderation ? '✅ Désactiver modération' : '🛡️ Activer modération', value: 'toggle_mod', emoji: '🛡️' },
      { label: config?.allowImages ? '🖼️ Désactiver images' : '🖼️ Activer images', value: 'toggle_images', emoji: '🖼️' },
      { label: '⏱️ Modifier cooldown',  value: 'set_cooldown',  emoji: '⏱️' },
      { label: config?.enabled ? '🔴 Désactiver' : '🟢 Activer', value: 'toggle_enabled', emoji: config?.enabled ? '🔴' : '🟢' },
    ]);
  return [new ActionRowBuilder().addComponents(menu)];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('confession')
    .setDescription('🤫 Envoyer une confession anonyme ou configurer le système')
    .addSubcommand(s => s.setName('envoyer').setDescription('Envoyer une confession anonyme'))
    .addSubcommand(s => s.setName('config').setDescription('Configurer le système de confessions')),

  async execute(interaction, client) {
    const sub   = interaction.options.getSubcommand();
    const guild = interaction.guild;

    // ── /confession envoyer ────────────────────────────────────────────────
    if (sub === 'envoyer') {
      const config = await ConfessionConfig.findOne({ guildId: guild.id });
      if (!config?.enabled || !config?.channelId) {
        return interaction.reply({ embeds: [errorEmbed('Système désactivé', 'Les confessions ne sont pas activées sur ce serveur.')], ephemeral: true });
      }

      const lastTime = confessionCooldown.get(interaction.user.id);
      if (lastTime) {
        const wait = config.cooldownMin * 60 * 1000 - (Date.now() - lastTime);
        if (wait > 0) {
          const mins = Math.ceil(wait / 60000);
          return interaction.reply({ embeds: [errorEmbed('Cooldown', `Attendez encore **${mins} minute(s)** avant d'envoyer une nouvelle confession.`)], ephemeral: true });
        }
      }

      const modal = new ModalBuilder()
        .setCustomId('confession_submit')
        .setTitle('🤫 Confession Anonyme');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('confession_text')
            .setLabel('Ta confession (100% anonyme)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(10)
            .setMaxLength(1000)
            .setPlaceholder('Écris ta confession ici... Personne ne saura qui tu es.'),
        ),
      );

      return interaction.showModal(modal);
    }

    // ── /confession config ─────────────────────────────────────────────────
    if (sub === 'config') {
      let config = await ConfessionConfig.findOne({ guildId: guild.id });

      const reply = await interaction.reply({
        embeds:     [buildConfigEmbed(config, guild)],
        components: buildConfigComponents(config),
        ephemeral:  true,
        fetchReply: true,
      });

      const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time:   10 * 60 * 1000,
      });

      async function refresh(i) {
        config = await ConfessionConfig.findOne({ guildId: guild.id });
        return i.update({
          embeds:     [buildConfigEmbed(config, guild)],
          components: buildConfigComponents(config),
        });
      }

      // ── UN SEUL collecteur qui gère tout ──────────────────────────────
      collector.on('collect', async i => {
        // Upsert config si elle n'existe pas encore
        config = await ConfessionConfig.findOneAndUpdate(
          { guildId: guild.id },
          { $setOnInsert: { guildId: guild.id } },
          { upsert: true, new: true }
        );

        // ── Retour au panel principal ──────────────────────────────────
        if (i.customId === 'conf_back') {
          return refresh(i);
        }

        // ── Sélection de salon (conf_chan_set_channel / conf_chan_set_log) ─
        if (i.customId === 'conf_chan_set_channel' || i.customId === 'conf_chan_set_log') {
          const field  = i.customId === 'conf_chan_set_channel' ? 'channelId' : 'logChannelId';
          const chanId = i.values[0];
          await ConfessionConfig.updateOne({ guildId: guild.id }, { [field]: chanId });
          return refresh(i);
        }

        // ── Menu principal ─────────────────────────────────────────────
        if (i.customId !== 'conf_action') return;
        const action = i.values[0];

        if (action === 'toggle_enabled') {
          config.enabled = !config.enabled;
          await config.save();
          return refresh(i);
        }

        if (action === 'toggle_mod') {
          config.moderation = !config.moderation;
          await config.save();
          return refresh(i);
        }

        if (action === 'toggle_images') {
          config.allowImages = !config.allowImages;
          await config.save();
          return refresh(i);
        }

        if (action === 'set_channel' || action === 'set_log') {
          const label = action === 'set_channel' ? 'de confession' : 'de logs';
          return i.update({
            embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle(`📢 Sélectionner le salon ${label}`)],
            components: [
              new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                  .setCustomId(`conf_chan_${action}`)
                  .setPlaceholder(`Salon ${label}...`)
                  .addChannelTypes(ChannelType.GuildText)
              ),
              new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('conf_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary)
              ),
            ],
          });
        }

        if (action === 'set_cooldown') {
          const modal = new ModalBuilder()
            .setCustomId('conf_cooldown_modal')
            .setTitle('⏱️ Modifier le cooldown');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('cooldown_value')
              .setLabel('Cooldown en minutes (1-60)')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('5')
          ));
          return i.showModal(modal);
        }
      });

      collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
    }
  },

  // ── Soumission de la confession ───────────────────────────────────────────
  async handleConfessionModal(interaction, client) {
    const guild   = interaction.guild;
    const content = interaction.fields.getTextInputValue('confession_text').trim();

    const config = await ConfessionConfig.findOne({ guildId: guild.id });
    if (!config?.enabled || !config?.channelId) {
      return interaction.reply({ embeds: [errorEmbed('Système désactivé', 'Les confessions ont été désactivées.')], ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const count  = await Confession.countDocuments({ guildId: guild.id });
    const number = count + 1;

    const confession = await Confession.create({
      guildId:   guild.id,
      channelId: config.channelId,
      authorId:  interaction.user.id,
      number,
      content,
      approved: !config.moderation,
    });

    // Modération → log uniquement
    if (config.moderation && config.logChannelId) {
      const logChannel = await guild.channels.fetch(config.logChannelId).catch(() => null);
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor(COLORS.warning)
          .setTitle(`🔍 Confession #${number} — En attente d'approbation`)
          .setDescription(content)
          .setFooter({ text: `ID: ${confession._id} • À approuver ou refuser` })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`conf_approve_${confession._id}`).setLabel('✅ Approuver').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`conf_deny_${confession._id}`).setLabel('❌ Refuser').setStyle(ButtonStyle.Danger),
        );

        await logChannel.send({ embeds: [logEmbed], components: [row] }).catch(() => {});
      }

      confessionCooldown.set(interaction.user.id, Date.now());
      return interaction.editReply({ embeds: [successEmbed('Confession envoyée!', 'Ta confession est en attente d\'approbation par les modérateurs.')] });
    }

    // Publication directe
    const channel = await guild.channels.fetch(config.channelId).catch(() => null);
    if (!channel) return interaction.editReply({ embeds: [errorEmbed('Erreur', 'Salon de confession introuvable.')] });

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle(`🤫 Confession #${number}`)
      .setDescription(content)
      .setFooter({ text: `${guild.name} • Confession anonyme` })
      .setTimestamp();

    const msg = await channel.send({ embeds: [embed] }).catch(() => null);
    if (msg) {
      await msg.react('❤️').catch(() => {});
      await Confession.updateOne({ _id: confession._id }, { messageId: msg.id });
    }

    confessionCooldown.set(interaction.user.id, Date.now());
    return interaction.editReply({ embeds: [successEmbed('Confession publiée!', `Ta confession anonyme #${number} a été publiée dans <#${config.channelId}>.`)] });
  },

  // ── Approbation / refus depuis les logs ──────────────────────────────────
  async handleConfessionMod(interaction, client, action, confessionId) {
    const guild      = interaction.guild;
    const confession = await Confession.findById(confessionId);
    if (!confession) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Confession introuvable.')], ephemeral: true });

    if (action === 'deny') {
      await Confession.updateOne({ _id: confessionId }, { approved: false });
      const denyEmbed = new EmbedBuilder()
        .setColor(COLORS.error)
        .setTitle(`❌ Confession #${confession.number} refusée`)
        .setDescription(confession.content)
        .setTimestamp();
      return interaction.update({ embeds: [denyEmbed], components: [] });
    }

    // Approuver → publier
    const config  = await ConfessionConfig.findOne({ guildId: guild.id });
    const channel = await guild.channels.fetch(config.channelId).catch(() => null);
    if (!channel) return interaction.reply({ embeds: [errorEmbed('Erreur', 'Salon introuvable.')], ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle(`🤫 Confession #${confession.number}`)
      .setDescription(confession.content)
      .setFooter({ text: `${guild.name} • Confession anonyme` })
      .setTimestamp();

    const msg = await channel.send({ embeds: [embed] }).catch(() => null);
    if (msg) {
      await msg.react('❤️').catch(() => {});
      await Confession.updateOne({ _id: confessionId }, { messageId: msg.id, approved: true });
    }

    const approvedEmbed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle(`✅ Confession #${confession.number} approuvée`)
      .setDescription(confession.content)
      .setTimestamp();
    return interaction.update({ embeds: [approvedEmbed], components: [] });
  },

  // ── Modal cooldown ────────────────────────────────────────────────────────
  async handleCooldownModal(interaction) {
    const val = parseInt(interaction.fields.getTextInputValue('cooldown_value'));
    if (isNaN(val) || val < 1 || val > 60) {
      return interaction.reply({ embeds: [errorEmbed('Valeur invalide', 'Entrez un nombre entre 1 et 60.')], ephemeral: true });
    }
    await ConfessionConfig.updateOne({ guildId: interaction.guild.id }, { cooldownMin: val });
    return interaction.reply({ embeds: [successEmbed('Cooldown mis à jour', `Le cooldown est maintenant de **${val} minute(s)**`)], ephemeral: true });
  },
};
