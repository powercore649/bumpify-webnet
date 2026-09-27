// commands/bumpadmin.js — Administration du réseau bump (owner seulement)
const {
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
} = require('discord.js');
const Server = require('../../models/Server');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');

function isOwner(userId) {
  const ids = (process.env.OWNER_IDS || '').split(',').map(s => s.trim());
  return ids.includes(userId);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bumpadmin')
    .setDescription('🔧 Administration du réseau bump (Owners uniquement)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s
      .setName('blacklist')
      .setDescription('Blacklister/déblacklister un serveur')
      .addStringOption(o => o.setName('guild_id').setDescription('ID du serveur').setRequired(true))
      .addBooleanOption(o => o.setName('blacklist').setDescription('true=blacklister, false=retirer').setRequired(true))
      .addStringOption(o => o.setName('raison').setDescription('Raison')))
    .addSubcommand(s => s
      .setName('featured')
      .setDescription('Mettre un serveur en avant')
      .addStringOption(o => o.setName('guild_id').setDescription('ID du serveur').setRequired(true))
      .addIntegerOption(o => o.setName('jours').setDescription('Durée en jours (0 = retirer)').setRequired(true).setMinValue(0).setMaxValue(30)))
    .addSubcommand(s => s
      .setName('stats')
      .setDescription('Statistiques globales du réseau'))
    .addSubcommand(s => s
      .setName('reset_bumps')
      .setDescription('Reset les bumps d\'un serveur')
      .addStringOption(o => o.setName('guild_id').setDescription('ID du serveur').setRequired(true))),

  async execute(interaction, client) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ embeds: [errorEmbed('Accès refusé', 'Commande réservée aux owners du bot.')], ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const sub = interaction.options.getSubcommand();

    if (sub === 'blacklist') {
      const guildId = interaction.options.getString('guild_id');
      const bl = interaction.options.getBoolean('blacklist');
      const raison = interaction.options.getString('raison') || 'Raison non précisée';
      const server = await Server.findOneAndUpdate(
        { guildId },
        { blacklisted: bl, blacklistReason: bl ? raison : '' },
        { new: true }
      );
      if (!server) return interaction.editReply({ embeds: [errorEmbed('Introuvable', `Aucun serveur trouvé avec l'ID \`${guildId}\`.`)] });
      return interaction.editReply({
        embeds: [successEmbed(
          bl ? '🔨 Serveur blacklisté' : '✅ Blacklist retirée',
          `**${server.guildName || guildId}**\n${bl ? `Raison: ${raison}` : 'Le serveur peut de nouveau bumper.'}`
        )],
      });
    }

    if (sub === 'featured') {
      const guildId = interaction.options.getString('guild_id');
      const jours = interaction.options.getInteger('jours');
      const featured = jours > 0;
      const until = featured ? new Date(Date.now() + jours * 24 * 60 * 60 * 1000) : null;
      const server = await Server.findOneAndUpdate(
        { guildId },
        { featured, featuredUntil: until },
        { new: true }
      );
      if (!server) return interaction.editReply({ embeds: [errorEmbed('Introuvable', `Aucun serveur trouvé avec l'ID \`${guildId}\`.`)] });
      return interaction.editReply({
        embeds: [successEmbed(
          featured ? '⭐ Serveur mis en avant' : '✅ Mise en avant retirée',
          featured
            ? `**${server.guildName}** est mis en avant pour **${jours} jours** (jusqu'au <t:${Math.floor(until.getTime() / 1000)}:f>).`
            : `**${server.guildName}** n'est plus mis en avant.`
        )],
      });
    }

    if (sub === 'stats') {
      const [total, bumped, blacklisted, featured, agg] = await Promise.all([
        Server.countDocuments(),
        Server.countDocuments({ bumpCount: { $gt: 0 } }),
        Server.countDocuments({ blacklisted: true }),
        Server.countDocuments({ featured: true, featuredUntil: { $gt: new Date() } }),
        Server.aggregate([{ $group: { _id: null, totalBumps: { $sum: '$bumpCount' }, totalMembers: { $sum: '$memberCount' } } }]),
      ]);
      const a = agg[0] || { totalBumps: 0, totalMembers: 0 };
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle('📊 Stats Admin — Réseau Bumpify')
          .addFields(
            { name: '🏠 Serveurs enregistrés', value: `${total}`, inline: true },
            { name: '🚀 Ont bumpé', value: `${bumped}`, inline: true },
            { name: '🔨 Blacklistés', value: `${blacklisted}`, inline: true },
            { name: '⭐ Mis en avant', value: `${featured}`, inline: true },
            { name: '📊 Total bumps réseau', value: `${a.totalBumps.toLocaleString()}`, inline: true },
            { name: '👥 Membres représentés', value: `${a.totalMembers.toLocaleString()}`, inline: true },
            { name: '🤖 Serveurs bot', value: `${client.guilds.cache.size}`, inline: true },
          )
          .setTimestamp()],
      });
    }

    if (sub === 'reset_bumps') {
      const guildId = interaction.options.getString('guild_id');
      const server = await Server.findOneAndUpdate(
        { guildId },
        { bumpCount: 0, weeklyBumps: 0, monthlyBumps: 0, bumpStreak: 0, lastBump: null },
        { new: true }
      );
      if (!server) return interaction.editReply({ embeds: [errorEmbed('Introuvable', `Aucun serveur avec l'ID \`${guildId}\`.`)] });
      return interaction.editReply({ embeds: [successEmbed('✅ Bumps reset', `Les bumps de **${server.guildName}** ont été remis à zéro.`)] });
    }
  },
};
