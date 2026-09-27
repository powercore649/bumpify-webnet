const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('user-info')
    .setDescription('👤 Afficher les infos d\'un utilisateur')
    .addUserOption(o => o.setName('user').setDescription('Utilisateur (vous par défaut)')),

  async execute(interaction) {
    await interaction.deferReply();
    const user = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ size: 512 }))
      .addFields(
        { name: '🆔 ID', value: user.id, inline: true },
        { name: '📅 Créé le', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
        { name: '👤 Bot', value: user.bot ? 'Oui' : 'Non', inline: true },
      );

    if (member) {
      embed.addFields(
        { name: '📥 Rejoint le', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`, inline: true },
        { name: '🎖️ Rôles', value: member.roles.cache.size > 1 ? member.roles.cache.filter(r => r.id !== interaction.guildId).map(r => r.toString()).join(', ').slice(0, 1024) || '*Aucun*' : '*Aucun*', inline: false },
      );
    }

    interaction.editReply({ embeds: [embed] });
  },
};
