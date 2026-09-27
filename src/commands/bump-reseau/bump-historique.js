'use strict';
// commands/bump-historique.js — Historique complet et paginé de vos bumps
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const BumpHistory = require('../../models/BumpHistory');
const { COLORS, infoEmbed } = require('../../utils/embeds');

const PAGE_SIZE = 5;
const COLLECTOR_TIMEOUT_MS = 10 * 60 * 1000;

function fmtDate(d) {
  return `<t:${Math.floor(new Date(d).getTime() / 1000)}:f>`;
}

function buildHistoryEmbed(entries, page, totalPages, stats, username, avatarURL) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setAuthor({ name: `Historique de bumps — ${username}`, iconURL: avatarURL })
    .setThumbnail(avatarURL)
    .setTimestamp();

  if (!entries.length) {
    embed.setDescription('*Aucun bump enregistré pour le moment. Utilise `/bump` pour commencer !*');
    return embed;
  }

  const lines = entries.map((e, i) => {
    const n = page * PAGE_SIZE + i + 1;
    return [
      `**#${n}** — ${fmtDate(e.createdAt)}`,
      `🏷️ ${e.guildName || 'Serveur inconnu'} · 💰 +${e.coinsEarned} coins · 🔥 Streak ${e.streakAtTime}j`,
    ].join('\n');
  });

  embed.setDescription(
    `📊 **${stats.total}** bump(s) au total · 🔥 Meilleure streak : **${stats.bestStreak}** jour(s) · 💰 **${stats.totalCoins}** coins gagnés\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    lines.join('\n\n')
  );
  embed.setFooter({ text: `Page ${page + 1} / ${totalPages}` });

  return embed;
}

function buildRow(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bumphist_prev').setLabel('◀ Précédent').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('bumphist_next').setLabel('Suivant ▶').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
    new ButtonBuilder().setCustomId('bumphist_close').setLabel('✖').setStyle(ButtonStyle.Danger),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bump-historique')
    .setDescription('📜 Consultez l\'historique complet de vos bumps'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const all = await BumpHistory.find({ userId }).sort({ createdAt: -1 }).lean();

    if (!all.length) {
      return interaction.reply({
        embeds: [infoEmbed('Aucun historique', 'Tu n\'as pas encore bumpé de serveur (ou les bumps précédents ont eu lieu avant l\'activation de cette fonctionnalité). Utilise `/bump` pour commencer ton historique !')],
        ephemeral: true,
      });
    }

    const stats = {
      total: all.length,
      bestStreak: Math.max(...all.map(e => e.streakAtTime || 0)),
      totalCoins: all.reduce((s, e) => s + (e.coinsEarned || 0), 0),
    };

    const totalPages = Math.ceil(all.length / PAGE_SIZE);
    let page = 0;

    const render = (p) => {
      const entries = all.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
      return {
        embeds: [buildHistoryEmbed(entries, p, totalPages, stats, interaction.user.username, interaction.user.displayAvatarURL())],
        components: [buildRow(p, totalPages)],
      };
    };

    const message = await interaction.reply({ ...render(page), ephemeral: false, fetchReply: true });
    const collector = message.createMessageComponentCollector({ filter: i => i.user.id === userId, time: COLLECTOR_TIMEOUT_MS });

    collector.on('collect', async (i) => {
      if (i.customId === 'bumphist_close') { collector.stop('closed'); return i.update({ components: [] }); }
      if (i.customId === 'bumphist_prev') page = Math.max(0, page - 1);
      if (i.customId === 'bumphist_next') page = Math.min(totalPages - 1, page + 1);
      return i.update(render(page));
    });

    collector.on('end', (_, reason) => { if (reason !== 'closed') interaction.editReply({ components: [] }).catch(() => {}); });
  },
};
