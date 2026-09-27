const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { Farewell } = require('../../models/Welcome');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('farewell-set')
    .setDescription('👋 Configurer le message d\'au revoir')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s =>
      s.setName('enable')
        .setDescription('Activer les messages d\'au revoir')
        .addChannelOption(o => o.setName('channel').setDescription('Salon').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s =>
      s.setName('message')
        .setDescription('Définir le message'))
    .addSubcommand(s =>
      s.setName('disable')
        .setDescription('Désactiver')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'enable') {
      const channel = interaction.options.getChannel('channel');
      let farewell = await Farewell.findOne({ guildId: interaction.guildId });
      if (!farewell) {
        farewell = await Farewell.create({ guildId: interaction.guildId });
      }
      farewell.enabled = true;
      farewell.channelId = channel.id;
      await farewell.save();

      return interaction.reply({
        embeds: [successEmbed('Au revoir activé', `Les messages seront envoyés dans ${channel}`)],
        ephemeral: true,
      });
    }

    if (sub === 'message') {
      const modal = new ModalBuilder()
        .setCustomId('modal_farewell_message')
        .setTitle('👋 Configurer le message');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('farewell_msg')
            .setLabel('Message (utilisez {user})')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('{user} a quitté le serveur')
            .setMaxLength(500)
            .setRequired(true),
        ),
      );
      return interaction.showModal(modal);
    }

    if (sub === 'disable') {
      let farewell = await Farewell.findOne({ guildId: interaction.guildId });
      if (farewell) {
        farewell.enabled = false;
        await farewell.save();
      }
      return interaction.reply({
        embeds: [successEmbed('Au revoir désactivé', '')],
        ephemeral: true,
      });
    }
  },

  async handleModal(interaction) {
    if (interaction.customId !== 'modal_farewell_message') return;

    const message = interaction.fields.getTextInputValue('farewell_msg');
    let farewell = await Farewell.findOne({ guildId: interaction.guildId });
    if (!farewell) {
      farewell = await Farewell.create({ guildId: interaction.guildId });
    }
    farewell.message = message;
    await farewell.save();

    return interaction.reply({
      embeds: [successEmbed('Message mis à jour', `\`\`\`${message}\`\`\``)],
      ephemeral: true,
    });
  },
};
