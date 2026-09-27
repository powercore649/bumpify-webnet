module.exports = {
  name: 'messageDelete',
  execute(message) {
    if (!message.author || message.author.bot) return;
    if (!message.content && !message.attachments.size) return;
    try {
      const { snipeCache } = require('../../commands/moderation/snipe');
      snipeCache.set(message.channel.id, {
        content:     message.content?.slice(0, 2000) || null,
        authorId:    message.author.id,
        authorTag:   message.author.tag,
        authorAvatar:message.author.displayAvatarURL(),
        createdAt:   message.createdTimestamp,
      });
      // Expire après 5 minutes
      setTimeout(() => snipeCache.delete(message.channel.id), 5 * 60 * 1000);
    } catch(_) {}

    // ── Starboard : retirer l'entrée si le message source est supprimé ────
    try {
      if (message.guild) {
        const { removeStarboardPostForSource } = require('../../utils/starboardManager');
        removeStarboardPostForSource(message.client, message.guild.id, message.id).catch(() => {});
      }
    } catch (_) {}

    // ── Logs configurables : messages supprimés (Feature 3) ───────────────
    try {
      if (!message.guild) return;
      const GuildLogs = require('../../models/GuildLogs');
      const { EmbedBuilder } = require('discord.js');
      const { COLORS } = require('../../utils/embeds');

      GuildLogs.findOne({ guildId: message.guild.id }).then(async logsCfg => {
        if (!logsCfg?.messages?.enabled || !logsCfg.messages.channelId) return;
        const ch = await message.guild.channels.fetch(logsCfg.messages.channelId).catch(() => null);
        if (!ch || !ch.isTextBased()) return;

        const content = message.content ? message.content.slice(0, 1000) : '*Aucun contenu (média ou embed)*';
        const embed = new EmbedBuilder()
          .setColor(COLORS.warning)
          .setTitle('🗑️ Message supprimé')
          .addFields(
            { name: '👤 Auteur', value: message.author ? `${message.author.tag} (\`${message.author.id}\`)` : '*Inconnu*', inline: true },
            { name: '📋 Salon', value: `<#${message.channel.id}>`, inline: true },
            { name: '📝 Contenu', value: content },
          )
          .setTimestamp();
        ch.send({ embeds: [embed] }).catch(() => {});
      }).catch(() => {});
    } catch (_) {}
  },
};
