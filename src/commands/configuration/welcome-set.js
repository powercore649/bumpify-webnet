const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { Welcome } = require('../../models/Welcome');
const { successEmbed, errorEmbed, COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome-set')
    .setDescription('👋 Configurer le message de bienvenue')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s =>
      s.setName('enable')
        .setDescription('Activer les messages de bienvenue')
        .addChannelOption(o => o.setName('channel').setDescription('Salon pour les bienvenues').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s =>
      s.setName('message')
        .setDescription('Définir le message de bienvenue'))
    .addSubcommand(s =>
      s.setName('disable')
        .setDescription('Désactiver les messages de bienvenue')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'enable') {
      const channel = interaction.options.getChannel('channel');
      let welcome = await Welcome.findOne({ guildId: interaction.guildId });
      if (!welcome) {
        welcome = await Welcome.create({ guildId: interaction.guildId });
      }
      welcome.enabled = true;
      welcome.channelId = channel.id;
      await welcome.save();

      return interaction.reply({
        embeds: [successEmbed('Bienvenue activé', `Les messages seront envoyés dans ${channel}`)],
        ephemeral: true,
      });
    }

    if (sub === 'message') {
      const modal = new ModalBuilder()
        .setCustomId('modal_welcome_message')
        .setTitle('👋 Configurer le message');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('welcome_msg')
            .setLabel('Message (utilisez {user} et {server})')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Bienvenue {user} sur {server}!')
            .setMaxLength(500)
            .setRequired(true),
        ),
      );
      return interaction.showModal(modal);
    }

    if (sub === 'disable') {
      let welcome = await Welcome.findOne({ guildId: interaction.guildId });
      if (welcome) {
        welcome.enabled = false;
        await welcome.save();
      }
      return interaction.reply({
        embeds: [successEmbed('Bienvenue désactivé', 'Les messages ne seront plus envoyés')],
        ephemeral: true,
      });
    }
  },

  async handleModal(interaction) {
    if (interaction.customId !== 'modal_welcome_message') return;

    const message = interaction.fields.getTextInputValue('welcome_msg');
    let welcome = await Welcome.findOne({ guildId: interaction.guildId });
    if (!welcome) {
      welcome = await Welcome.create({ guildId: interaction.guildId });
    }
    welcome.message = message;
    await welcome.save();

    return interaction.reply({
      embeds: [successEmbed('Message mis à jour', `\`\`\`${message}\`\`\``)],
      ephemeral: true,
    });
  },
};
