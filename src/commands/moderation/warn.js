const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const Warn = require('../../models/Warn');
const WarnThresholds = require('../../models/WarnThresholds');
const { errorEmbed, successEmbed, COLORS } = require('../../utils/embeds');

// ── Avertissements à paliers configurables (Feature D) ───────────────────────
// Vérifie si le nombre actuel d'avertissements correspond à un palier configuré
// et applique l'action associée (mute/kick/ban). N'affecte pas le comportement
// par défaut si aucun palier n'est configuré pour ce serveur.
async function checkThresholds(guild, member, count) {
  try {
    const cfg = await WarnThresholds.findOne({ guildId: guild.id });
    if (!cfg || !cfg.thresholds.length) return null;

    const match = cfg.thresholds.find(t => t.count === count);
    if (!match || !member) return null;

    if (match.action === 'mute') {
      const ms = (match.duration > 0 ? match.duration : 10) * 60 * 1000;
      await member.timeout(ms, `Palier d'avertissements atteint (${count})`).catch(() => {});
    } else if (match.action === 'kick') {
      await member.kick(`Palier d'avertissements atteint (${count})`).catch(() => {});
    } else if (match.action === 'ban') {
      await member.ban({ reason: `Palier d'avertissements atteint (${count})` }).catch(() => {});
    }
    return match;
  } catch (err) {
    console.error('warn.checkThresholds:', err);
    return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('⚠️ Avertir un utilisateur')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Utilisateur').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Raison').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'Pas de raison';

    await Warn.create({
      userId: user.id,
      guildId: interaction.guildId,
      warnedBy: interaction.user.id,
      reason,
    });

    const count = await Warn.countDocuments({ userId: user.id, guildId: interaction.guildId });

    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('⚠️ Avertissement enregistré')
      .addFields(
        { name: '👤 Utilisateur', value: user.tag, inline: true },
        { name: '📊 Avertissements', value: `${count}`, inline: true },
        { name: '✍️ Raison', value: reason, inline: false },
      )
      .setThumbnail(user.displayAvatarURL())
      .setTimestamp();

    // ── Application des paliers configurables (Feature D) ──────────────────
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const triggered = await checkThresholds(interaction.guild, member, count);
    if (triggered) {
      const actionLabel = { mute: '🔇 Mute', kick: '👋 Kick', ban: '🔨 Ban' }[triggered.action];
      embed.addFields({ name: '🚨 Palier atteint', value: `Action automatique appliquée : **${actionLabel}**` });
    }

    interaction.editReply({ embeds: [embed] });
  },
};
