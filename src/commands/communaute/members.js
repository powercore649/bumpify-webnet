const { SlashCommandBuilder, EmbedBuilder, AuditLogEvent } = require('discord.js');
const { COLORS, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('members')
    .setDescription('👥 Voir les membres qui ont récemment rejoint/quitté'),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const auditLogs = await interaction.guild.fetchAuditLogs({ limit: 20 });
      const memberEvents = auditLogs.entries.filter(e =>
        e.action === AuditLogEvent.MemberKick ||
        e.action === AuditLogEvent.MemberBanAdd ||
        e.action === AuditLogEvent.MemberBanRemove
      );

      if (memberEvents.size === 0) {
        return interaction.editReply({ embeds: [errorEmbed('Aucune donnée', 'Pas d\'événements membres récents.')] });
      }

      let description = '';
      memberEvents.forEach((log, i) => {
        const action = log.action === AuditLogEvent.MemberKick ? '👢 Kick' :
                      log.action === AuditLogEvent.MemberBanAdd ? '🔨 Ban' : '✅ Unban';
        description += `${action} **${log.targetUser.tag}** - <t:${Math.floor(log.createdTimestamp / 1000)}:R>\n`;
      });

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('👥 Événements membres récents')
        .setDescription(description)
        .setTimestamp();

      interaction.editReply({ embeds: [embed] });
    } catch (err) {
      interaction.editReply({ embeds: [errorEmbed('Erreur', 'Impossible de récupérer les logs.')] });
    }
  },
};
