// commands/stats.js — Stats complètes : serveur, utilisateur, réseau global
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Server = require('../../models/Server');
const User   = require('../../models/User');
const { COLORS, errorEmbed } = require('../../utils/embeds');
const { BUMP_COOLDOWN_MS } = require('../../utils/bumpNetwork');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('📊 Statistiques de bumps')
    .addSubcommand(s => s.setName('serveur').setDescription('Stats du serveur actuel'))
    .addSubcommand(s => s.setName('utilisateur').setDescription('Stats d\'un utilisateur')
      .addUserOption(o => o.setName('user').setDescription('Utilisateur (vous par défaut)')))
    .addSubcommand(s => s.setName('reseau').setDescription('Statistiques globales du réseau Bumpify')),

  async execute(interaction) {
    await interaction.deferReply();
    const guild = interaction.guild;
    const sub   = interaction.options.getSubcommand();

    // ── Stats serveur ─────────────────────────────────────────────────────
    if (sub === 'serveur') {
      const server = await Server.findOne({ guildId: guild.id });
      if (!server || server.bumpCount === 0) {
        return interaction.editReply({ embeds: [errorEmbed('Aucune donnée', 'Ce serveur n\'a jamais bumpé. Faites `/bump` pour commencer !')] });
      }

      const topBumpers = await User.find({ guildId: guild.id }).sort({ bumps: -1 }).limit(5);
      const leaderboard = await Promise.all(topBumpers.map(async (u, i) => {
        const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
        try {
          const m = await interaction.client.users.fetch(u.userId);
          return `${medals[i]} **${m.username}** — ${u.bumps} bump(s)`;
        } catch {
          return `${medals[i]} *Inconnu* — ${u.bumps} bump(s)`;
        }
      }));

      const nextTs = server.lastBump
        ? Math.floor((new Date(server.lastBump).getTime() + BUMP_COOLDOWN_MS) / 1000)
        : null;
      const ready = !server.lastBump || Date.now() - new Date(server.lastBump).getTime() >= BUMP_COOLDOWN_MS;
      const isFeatured = server.featured && server.featuredUntil && new Date(server.featuredUntil) > new Date();

      const embed = new EmbedBuilder()
        .setColor(isFeatured ? 0xFFD700 : COLORS.primary)
        .setTitle(`📊 Statistiques — ${guild.name}`)
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .addFields(
          { name: '🚀 Total bumps',       value: `**${server.bumpCount}**`,      inline: true },
          { name: '📅 Cette semaine',     value: `**${server.weeklyBumps}**`,    inline: true },
          { name: '📆 Ce mois',           value: `**${server.monthlyBumps}**`,   inline: true },
          { name: '👍 Total votes',       value: `**${server.totalVotes}**`,     inline: true },
          { name: '🔥 Streak',            value: `**${server.bumpStreak}** jour(s)`, inline: true },
          { name: '💰 Coins distribués',  value: `**${server.totalCoinsEarned || 0}**`, inline: true },
          { name: '⏰ Statut bump',       value: ready ? '✅ **Disponible maintenant !**' : `<t:${nextTs}:R>`, inline: false },
          { name: '🏆 Top Bumpers',       value: leaderboard.join('\n') || '*Personne encore*' },
        );

      if (isFeatured) {
        embed.addFields({ name: '⭐ Mis en avant', value: `Jusqu\'au <t:${Math.floor(new Date(server.featuredUntil).getTime() / 1000)}:f>` });
      }
      embed.setFooter({ text: 'Bumpify • Statistiques serveur' }).setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    // ── Stats utilisateur ─────────────────────────────────────────────────
    if (sub === 'utilisateur') {
      const target    = interaction.options.getUser('user') || interaction.user;
      const userStats = await User.findOne({ userId: target.id, guildId: guild.id });

      if (!userStats || userStats.bumps === 0) {
        return interaction.editReply({ embeds: [errorEmbed('Aucune donnée', `**${target.username}** n'a pas encore bumpé ce serveur.`)] });
      }

      const rank = await User.countDocuments({ guildId: guild.id, bumps: { $gt: userStats.bumps } }) + 1;

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`📊 Stats — ${target.username}`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: '🚀 Total bumps',      value: `**${userStats.bumps}**`,        inline: true },
          { name: '🏆 Classement',       value: `**#${rank}**`,                  inline: true },
          { name: '📅 Cette semaine',    value: `**${userStats.weeklyBumps || 0}**`, inline: true },
          { name: '📆 Ce mois',          value: `**${userStats.monthlyBumps || 0}**`, inline: true },
          { name: '💰 Coins gagnés',     value: `**${userStats.coinsEarned || 0}**`, inline: true },
          { name: '🕐 Dernier bump',     value: `<t:${Math.floor(new Date(userStats.lastBump).getTime() / 1000)}:R>`, inline: true },
        )
        .setFooter({ text: 'Bumpify • Stats utilisateur' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── Stats réseau global ───────────────────────────────────────────────
    if (sub === 'reseau') {
      const [totalServers, totalBumpsAgg, topServers] = await Promise.all([
        Server.countDocuments({ blacklisted: false }),
        Server.aggregate([{ $group: { _id: null, total: { $sum: '$bumpCount' } } }]),
        Server.find({ blacklisted: false }).sort({ bumpCount: -1 }).limit(5).lean(),
      ]);

      const totalBumps = totalBumpsAgg[0]?.total || 0;

      const topList = await Promise.all(topServers.map(async (s, i) => {
        const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
        try {
          const g = await interaction.client.guilds.fetch(s.guildId).catch(() => null);
          const name = g?.name || s.guildName || '*Serveur inconnu*';
          return `${medals[i]} **${name}** — ${s.bumpCount} bumps`;
        } catch {
          return `${medals[i]} *Serveur inconnu* — ${s.bumpCount} bumps`;
        }
      }));

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('🌐 Statistiques — Réseau Bumpify')
        .setThumbnail(interaction.client.user.displayAvatarURL())
        .addFields(
          { name: '🌍 Serveurs dans le réseau', value: `**${totalServers}**`, inline: true },
          { name: '🚀 Bumps totaux',            value: `**${totalBumps.toLocaleString()}**`, inline: true },
          { name: '🤖 Serveurs connectés',      value: `**${interaction.client.guilds.cache.size}**`, inline: true },
          { name: '🏆 Top serveurs',            value: topList.join('\n') || '*Aucun encore*' },
        )
        .setFooter({ text: 'Bumpify • Statistiques réseau' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
