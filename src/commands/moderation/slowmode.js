const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
module.exports = {
  data: new SlashCommandBuilder().setName('slowmode').setDescription('⏱️ Définir le slowmode d\'un salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(o=>o.setName('secondes').setDescription('Durée en secondes (0 = désactiver)').setRequired(true).setMinValue(0).setMaxValue(21600))
    .addChannelOption(o=>o.setName('salon').setDescription('Salon (actuel par défaut)')),
  async execute(interaction) {
    const secs = interaction.options.getInteger('secondes');
    const ch   = interaction.options.getChannel('salon') || interaction.channel;
    try {
      await ch.setRateLimitPerUser(secs, `Slowmode défini par ${interaction.user.tag}`);
      return interaction.reply({ embeds:[successEmbed('Slowmode mis à jour',
        secs===0 ? `Slowmode **désactivé** dans <#${ch.id}>.` : `Slowmode de **${secs}s** défini dans <#${ch.id}>.`)], ephemeral:true });
    } catch(err) {
      return interaction.reply({ embeds:[errorEmbed('Erreur',err.message)], ephemeral:true });
    }
  },
};
