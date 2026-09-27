// commands/network.js — Informations globales sur le réseau Bumpify
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Server = require('../../models/Server');
const InterServer = require('../../models/InterServer');
const { COLORS } = require('../../utils/embeds');
const { computeScore } = require('../../utils/bumpNetwork');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('network')
    .setDescription('🌐 Statistiques globales du réseau Bumpify'),

  async execute(interaction, client) {
    await interaction.deferReply();

    const [
      totalServers,
      totalBumpDocs,
      interServerLinks,
      activeNetworks,
      featuredServers,
      topServer,
    ] = await Promise.all([
      Server.countDocuments({ blacklisted: false }),
      Server.aggregate([{ $group: { _id: null, total: { $sum: '$bumpCount' }, members: { $sum: '$memberCount' } } }]),
      InterServer.countDocuments({ active: true }),
      InterServer.distinct('networkId', { active: true }),
      Server.countDocuments({ featured: true, featuredUntil: { $gt: new Date() } }),
      Server.find({ bumpCount: { $gt: 0 }, blacklisted: false }).lean().then(docs =>
        docs.sort((a, b) => computeScore(b) - computeScore(a))[0]
      ),
    ]);

    const agg = totalBumpDocs[0] || { total: 0, members: 0 };

    // Stats du serveur courant
    const myServer = await Server.findOne({ guildId: interaction.guildId });
    const isInNetwork = !!myServer;
    const interServerConfig = await InterServer.findOne({ guildId: interaction.guildId, active: true });

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle('🌐 Réseau Bumpify — Vue globale')
      .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
      .addFields(
        {
          name: '📊 Statistiques globales',
          value: [
            `🏠 **${totalServers}** serveur(s) dans le réseau`,
            `🚀 **${agg.total.toLocaleString()}** bumps au total`,
            `👥 **${agg.members.toLocaleString()}** membres représentés`,
            `📡 **${interServerLinks}** liaison(s) inter-serveur actives`,
            `🔗 **${activeNetworks.length}** réseau(x) inter-serveur`,
            `⭐ **${featuredServers}** serveur(s) mis en avant`,
          ].join('\n'),
          inline: false,
        },
        {
          name: '🏆 Serveur #1 du réseau',
          value: topServer
            ? `**${topServer.guildName}** — ${topServer.bumpCount} bumps • ${topServer.weeklyBumps} cette semaine${topServer.inviteLink ? `\n[Rejoindre](${topServer.inviteLink})` : ''}`
            : '*Aucun serveur encore*',
          inline: false,
        },
        {
          name: '📍 Ce serveur',
          value: [
            `Réseau bumps: ${isInNetwork ? '✅ Connecté' : '❌ Non connecté'}`,
            isInNetwork ? `Bumps totaux: **${myServer.bumpCount}** • Streak: **${myServer.bumpStreak}j**` : 'Faites `/config` puis `/bump` pour rejoindre !',
            interServerConfig ? `Inter-serveur: ✅ Réseau \`${interServerConfig.networkName}\`` : `Inter-serveur: ❌ Non connecté`,
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: 'Bumpify • Réseau inter-communautés' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
