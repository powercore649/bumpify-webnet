const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { errorEmbed, COLORS } = require('../../utils/embeds');
const authGate = require('../../utils/authGate');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('👢 Expulser un utilisateur du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('user').setDescription('Utilisateur à expulser').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Raison').setRequired(false)),

  async execute(interaction) {
    const user   = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'Aucune raison';

    if (user.id === interaction.user.id) {
      return interaction.reply({ embeds: [errorEmbed('Impossible', 'Vous ne pouvez pas vous expulser.')], ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ embeds: [errorEmbed('Erreur', 'Utilisateur non trouvé.')], ephemeral: true });
    if (member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ embeds: [errorEmbed('Permissions insuffisantes', 'Rôle trop élevé.')], ephemeral: true });
    }

    return authGate.protect(interaction, {
      label: `Expulser ${user.tag}`,
      payload: { userId: user.id, userTag: user.tag, userAvatar: user.displayAvatarURL(), reason },
      executor: async (itx, payload) => {
        await itx.deferReply({ ephemeral: itx.isModalSubmit?.() ? true : false });
        try {
          const target = await itx.guild.members.fetch(payload.userId).catch(() => null);
          if (!target) return itx.editReply({ embeds: [errorEmbed('Erreur', 'Utilisateur non trouvé ou déjà parti.')] });

          await target.kick(payload.reason);

          const embed = new EmbedBuilder()
            .setColor(COLORS.warning)
            .setTitle('👢 Utilisateur expulsé')
            .addFields(
              { name: '👤 Utilisateur', value: payload.userTag, inline: true },
              { name: '✍️ Raison', value: payload.reason, inline: false },
            )
            .setThumbnail(payload.userAvatar)
            .setTimestamp();

          await itx.editReply({ embeds: [embed] });
        } catch (err) {
          await itx.editReply({ embeds: [errorEmbed('Erreur', 'Impossible d\'expulser cet utilisateur.')] });
        }
      },
    });
  },
};
