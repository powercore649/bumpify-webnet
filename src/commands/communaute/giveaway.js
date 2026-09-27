const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');
const Giveaway = require('../../models/Giveaway');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');
const { sendNotification } = require('../../utils/notificationManager');

const PAGE_SIZE = 10;
const MAX_TIMEOUT_MS = 2_147_483_647; // limite max de setTimeout (~24.85 jours) — au-delà, Node déclenche immédiatement

// setTimeout "sûr" : découpe les délais trop longs en plusieurs étapes pour ne jamais déborder
function scheduleAt(targetDate, callback) {
  const delay = targetDate.getTime() - Date.now();
  if (delay <= 0) return callback();
  if (delay <= MAX_TIMEOUT_MS) return setTimeout(callback, delay);
  return setTimeout(() => scheduleAt(targetDate, callback), MAX_TIMEOUT_MS);
}

// Reprogramme tous les giveaways en cours — à appeler au démarrage du bot (ready.js)
// car les setTimeout en mémoire sont perdus à chaque redémarrage.
async function rescheduleActiveGiveaways(client) {
  const active = await Giveaway.find({ ended: false });
  let rescheduled = 0, endedImmediately = 0;
  for (const giveaway of active) {
    if (giveaway.endAt.getTime() <= Date.now()) {
      endImmediately(giveaway, client);
      endedImmediately++;
    } else {
      scheduleAt(giveaway.endAt, () => {
        Giveaway.findById(giveaway._id).then(fresh => {
          if (fresh && !fresh.ended) endGiveaway(fresh, client).catch(console.error);
        });
      });
      rescheduled++;
    }
  }
  return { rescheduled, endedImmediately };
}

function endImmediately(giveaway, client) {
  Giveaway.findById(giveaway._id).then(fresh => {
    if (fresh && !fresh.ended) endGiveaway(fresh, client).catch(console.error);
  });
}

function parseTime(str) {
  const match = str.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const n = parseInt(match[1]);
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * units[match[2]];
}

function totalEntries(giveaway) {
  return giveaway.participants.reduce((sum, p) => sum + (p.entries || 1), 0);
}

function buildGiveawayEmbed(giveaway) {
  const timeLeft = giveaway.endAt - Date.now();
  const ended = giveaway.ended || timeLeft <= 0;

  const embed = new EmbedBuilder()
    .setColor(ended ? COLORS.info : 0xF1C40F)
    .setTitle(`🎉 ${giveaway.prize}`)
    .addFields(
      { name: '🏆 Gagnant(s)', value: String(giveaway.winners), inline: true },
      { name: '👥 Participants', value: String(giveaway.participants.length), inline: true },
      { name: '🎟️ Organisateur', value: `<@${giveaway.hostId}>`, inline: true },
    )
    .setFooter({ text: ended ? 'Giveaway terminé' : 'Cliquez sur 🎉 pour participer' })
    .setTimestamp(giveaway.endAt);

  if (giveaway.requiredRoleId) {
    embed.addFields({ name: '🔒 Rôle requis', value: `<@&${giveaway.requiredRoleId}>`, inline: true });
  }
  if (giveaway.bonusRoles.length) {
    embed.addFields({
      name: '⭐ Entrées bonus',
      value: giveaway.bonusRoles.map(b => `<@&${b.roleId}> : +${b.entries}`).join('\n'),
      inline: false,
    });
  }

  if (!ended) {
    embed.setDescription(`Se termine <t:${Math.floor(giveaway.endAt.getTime() / 1000)}:R>`);
  } else if (giveaway.winnerIds.length > 0) {
    embed.setDescription(`🎊 Gagnant(s): ${giveaway.winnerIds.map(id => `<@${id}>`).join(', ')}`);
  } else {
    embed.setDescription('Aucun participant. Personne n\'a gagné.');
  }

  return embed;
}

// Tirage pondéré : chaque participant a un poids = son nombre d'entrées
function drawWeightedWinners(participants, count) {
  const pool = participants.map(p => ({ userId: p.userId, weight: Math.max(1, p.entries || 1) }));
  const winners = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const total = pool.reduce((s, p) => s + p.weight, 0);
    let roll = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      roll -= pool[idx].weight;
      if (roll <= 0) break;
    }
    winners.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0].userId);
  }
  return winners;
}

async function endGiveaway(giveaway, client) {
  if (giveaway.ended) return;

  const winners = drawWeightedWinners(giveaway.participants, giveaway.winners);

  giveaway.ended = true;
  giveaway.winnerIds = winners;
  await Giveaway.updateOne({ _id: giveaway._id }, { ended: true, winnerIds: winners });

  try {
    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (channel && giveaway.messageId) {
      const msg = await channel.messages.fetch(giveaway.messageId).catch(() => null);
      const fresh = await Giveaway.findById(giveaway._id);
      if (msg && fresh) {
        await msg.edit({ embeds: [buildGiveawayEmbed(fresh)], components: [] });
        if (winners.length > 0) {
          await channel.send({
            content: winners.map(id => `<@${id}>`).join(', '),
            embeds: [new EmbedBuilder()
              .setColor(COLORS.success)
              .setTitle('🎊 Félicitations!')
              .setDescription(`${winners.map(id => `<@${id}>`).join(', ')} ${winners.length > 1 ? 'ont gagné' : 'a gagné'} **${giveaway.prize}**!`)
              .setFooter({ text: `Organisé par <@${giveaway.hostId}>` })],
          });

          // Centre de notifications — DM aux abonnés "giveaways" du serveur
          sendNotification(client, giveaway.guildId, 'giveaways', new EmbedBuilder()
            .setColor(COLORS.success)
            .setTitle('🎊 Giveaway terminé!')
            .setDescription(`**${giveaway.prize}**\nGagnant(s): ${winners.map(id => `<@${id}>`).join(', ')}`)
            .setTimestamp(), `Giveaway terminé : ${giveaway.prize}`).catch(err => console.error('notif giveaway end:', err.message));
        }
      }
    }
  } catch (err) {
    console.error('❌ endGiveaway:', err.message);
  }
}

// ─── Embed paginé de la liste des participants ────────────────────────────
function buildParticipantsPage(giveaway, page, perPage = PAGE_SIZE) {
  const sorted = [...giveaway.participants].sort((a, b) => a.joinedAt - b.joinedAt);
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  page = Math.max(0, Math.min(page, totalPages - 1));
  const slice = sorted.slice(page * perPage, page * perPage + perPage);

  const lines = slice.map((p, i) => {
    const rank = page * perPage + i + 1;
    const entriesTxt = p.entries > 1 ? ` *(x${p.entries} entrées)*` : '';
    return `\`${String(rank).padStart(3, ' ')}.\` <@${p.userId}>${entriesTxt}`;
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`👥 Participants — ${giveaway.prize}`)
    .setDescription(lines.length ? lines.join('\n') : '*Aucun participant pour le moment.*')
    .setFooter({ text: `Page ${page + 1}/${totalPages} • ${sorted.length} participant(s) • ${totalEntries(giveaway)} entrée(s) au total` });

  return { embed, page, totalPages };
}

function buildPaginationRow(page, totalPages, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gw_page_first').setLabel('« Début').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 0),
    new ButtonBuilder().setCustomId('gw_page_prev').setLabel('‹ Précédent').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 0),
    new ButtonBuilder().setCustomId('gw_page_next').setLabel('Suivant ›').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page >= totalPages - 1),
    new ButtonBuilder().setCustomId('gw_page_last').setLabel('Fin »').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page >= totalPages - 1),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('🎉 Gérer les giveaways')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s
      .setName('créer')
      .setDescription('Créer un giveaway')
      .addStringOption(o => o.setName('prix').setDescription('Que faites-vous gagner?').setRequired(true))
      .addStringOption(o => o.setName('durée').setDescription('Durée: 10m, 1h, 2d...').setRequired(true))
      .addIntegerOption(o => o.setName('gagnants').setDescription('Nombre de gagnants (défaut: 1)').setMinValue(1).setMaxValue(20))
      .addRoleOption(o => o.setName('rôle_requis').setDescription('Rôle obligatoire pour participer (optionnel)')))
    .addSubcommand(s => s
      .setName('terminer')
      .setDescription('Terminer un giveaway manuellement')
      .addStringOption(o => o.setName('message_id').setDescription('ID du message du giveaway').setRequired(true)))
    .addSubcommand(s => s
      .setName('relancer')
      .setDescription('Relancer un giveaway terminé')
      .addStringOption(o => o.setName('message_id').setDescription('ID du message du giveaway').setRequired(true)))
    .addSubcommand(s => s
      .setName('participants')
      .setDescription('Voir la liste paginée des participants')
      .addStringOption(o => o.setName('message_id').setDescription('ID du message du giveaway').setRequired(true)))
    .addSubcommandGroup(g => g
      .setName('bonus-role')
      .setDescription('Gérer les entrées bonus par rôle')
      .addSubcommand(s => s
        .setName('ajouter')
        .setDescription('Donner des entrées bonus à un rôle')
        .addStringOption(o => o.setName('message_id').setDescription('ID du message du giveaway').setRequired(true))
        .addRoleOption(o => o.setName('rôle').setDescription('Rôle concerné').setRequired(true))
        .addIntegerOption(o => o.setName('entrées').setDescription('Entrées bonus accordées').setRequired(true).setMinValue(1).setMaxValue(50)))
      .addSubcommand(s => s
        .setName('retirer')
        .setDescription('Retirer le bonus d\'un rôle')
        .addStringOption(o => o.setName('message_id').setDescription('ID du message du giveaway').setRequired(true))
        .addRoleOption(o => o.setName('rôle').setDescription('Rôle concerné').setRequired(true)))),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);
    const guild = interaction.guild;

    if (group === 'bonus-role') {
      const msgId = interaction.options.getString('message_id');
      const role = interaction.options.getRole('rôle');
      const giveaway = await Giveaway.findOne({ messageId: msgId, guildId: guild.id });
      if (!giveaway) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Giveaway introuvable.')], ephemeral: true });
      if (giveaway.ended) return interaction.reply({ embeds: [errorEmbed('Terminé', 'Ce giveaway est déjà terminé.')], ephemeral: true });

      if (sub === 'ajouter') {
        const entries = interaction.options.getInteger('entrées');
        giveaway.bonusRoles = giveaway.bonusRoles.filter(b => b.roleId !== role.id);
        giveaway.bonusRoles.push({ roleId: role.id, entries });
        await giveaway.save();
        return interaction.reply({ embeds: [successEmbed('Bonus ajouté', `<@&${role.id}> donne désormais +${entries} entrée(s).`)], ephemeral: true });
      }
      if (sub === 'retirer') {
        giveaway.bonusRoles = giveaway.bonusRoles.filter(b => b.roleId !== role.id);
        await giveaway.save();
        return interaction.reply({ embeds: [successEmbed('Bonus retiré', `<@&${role.id}> n'accorde plus d'entrées bonus.`)], ephemeral: true });
      }
    }

    if (sub === 'créer') {
      const prize = interaction.options.getString('prix');
      const dureeStr = interaction.options.getString('durée');
      const winners = interaction.options.getInteger('gagnants') ?? 1;
      const requiredRole = interaction.options.getRole('rôle_requis');
      const ms = parseTime(dureeStr);

      if (!ms || ms < 10000 || ms > 30 * 86400000) {
        return interaction.reply({ embeds: [errorEmbed('Durée invalide', 'Format: `10s`, `5m`, `2h`, `7d`. Max 30 jours.')], ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const endAt = new Date(Date.now() + ms);
      const giveaway = await Giveaway.create({
        guildId: guild.id,
        channelId: interaction.channel.id,
        hostId: interaction.user.id,
        prize, winners, endAt,
        requiredRoleId: requiredRole ? requiredRole.id : null,
      });

      const embed = buildGiveawayEmbed(giveaway);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`gw_join_${giveaway._id}`).setLabel('🎉 Participer').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`gw_list_${giveaway._id}`).setLabel('👥 Voir les participants').setStyle(ButtonStyle.Secondary),
      );

      const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
      await Giveaway.updateOne({ _id: giveaway._id }, { messageId: msg.id });

      // Centre de notifications — DM aux abonnés "giveaways" du serveur
      sendNotification(client, guild.id, 'giveaways', new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('🎉 Nouveau giveaway!')
        .setDescription(`**${prize}**\nSe termine <t:${Math.floor(endAt.getTime() / 1000)}:R> sur **${guild.name}**.`)
        .setURL(msg.url)
        .setTimestamp(), `Nouveau giveaway : ${prize}`).catch(err => console.error('notif giveaway create:', err.message));

      scheduleAt(endAt, () => {
        Giveaway.findById(giveaway._id).then(fresh => {
          if (fresh && !fresh.ended) endGiveaway(fresh, client).catch(console.error);
        });
      });

      return interaction.editReply({ embeds: [successEmbed('Giveaway créé!', `Le giveaway pour **${prize}** se termine <t:${Math.floor(endAt.getTime() / 1000)}:R>.`)] });
    }

    if (sub === 'terminer') {
      const msgId = interaction.options.getString('message_id');
      const giveaway = await Giveaway.findOne({ messageId: msgId, guildId: guild.id });
      if (!giveaway) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Giveaway introuvable.')], ephemeral: true });
      if (giveaway.ended) return interaction.reply({ embeds: [errorEmbed('Déjà terminé', 'Ce giveaway est déjà terminé.')], ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      await endGiveaway(giveaway, client);
      return interaction.editReply({ embeds: [successEmbed('Giveaway terminé!', 'Les gagnants ont été tirés au sort.')] });
    }

    if (sub === 'relancer') {
      const msgId = interaction.options.getString('message_id');
      const giveaway = await Giveaway.findOne({ messageId: msgId, guildId: guild.id });
      if (!giveaway) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Giveaway introuvable.')], ephemeral: true });
      if (!giveaway.ended) return interaction.reply({ embeds: [errorEmbed('En cours', 'Ce giveaway est encore en cours.')], ephemeral: true });

      const winners = drawWeightedWinners(giveaway.participants, giveaway.winners);
      giveaway.winnerIds = winners;
      giveaway.ended = true;
      await giveaway.save();

      try {
        const channel = await guild.channels.fetch(giveaway.channelId).catch(() => null);
        if (channel && winners.length > 0) {
          await channel.send({
            embeds: [new EmbedBuilder()
              .setColor(COLORS.success)
              .setTitle('🎊 Nouveau tirage!')
              .setDescription(`${winners.map(id => `<@${id}>`).join(', ')} ${winners.length > 1 ? 'ont gagné' : 'a gagné'} **${giveaway.prize}**!`)],
          });
        }
      } catch (_) {}

      return interaction.reply({ embeds: [successEmbed('Giveaway relancé!', `Nouveaux gagnants: ${winners.map(id => `<@${id}>`).join(', ') || 'Aucun participant.'}`)] });
    }

    if (sub === 'participants') {
      const msgId = interaction.options.getString('message_id');
      const giveaway = await Giveaway.findOne({ messageId: msgId, guildId: guild.id });
      if (!giveaway) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Giveaway introuvable.')], ephemeral: true });

      let page = 0;
      const { embed, totalPages } = buildParticipantsPage(giveaway, page);

      if (totalPages <= 1) {
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      const reply = await interaction.reply({ embeds: [embed], components: [buildPaginationRow(page, totalPages)], ephemeral: true, fetchReply: true });

      const col = reply.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 5 * 60 * 1000,
      });

      col.on('collect', async i => {
        const fresh = await Giveaway.findById(giveaway._id); // toujours à jour si des gens rejoignent entre-temps
        if (i.customId === 'gw_page_first') page = 0;
        else if (i.customId === 'gw_page_prev') page = Math.max(0, page - 1);
        else if (i.customId === 'gw_page_next') page = page + 1;
        else if (i.customId === 'gw_page_last') page = Infinity;

        const built = buildParticipantsPage(fresh, page);
        page = built.page;
        await i.update({ embeds: [built.embed], components: [buildPaginationRow(page, built.totalPages)] });
      });

      col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
    }
  },

  // Bouton participer (géré dans interactionCreate)
  async handleJoin(interaction, giveawayId) {
    const giveaway = await Giveaway.findById(giveawayId);
    if (!giveaway || giveaway.ended) {
      return interaction.reply({ embeds: [errorEmbed('Giveaway terminé', 'Ce giveaway est terminé.')], ephemeral: true });
    }

    const userId = interaction.user.id;
    const member = interaction.member;
    const existingIdx = giveaway.participants.findIndex(p => p.userId === userId);

    if (existingIdx !== -1) {
      giveaway.participants.splice(existingIdx, 1);
      await giveaway.save();
      const embed = buildGiveawayEmbed(giveaway);
      await interaction.update({ embeds: [embed] });
      return interaction.followUp({ embeds: [successEmbed('Retiré', 'Tu as été retiré du giveaway.')], ephemeral: true });
    }

    if (giveaway.requiredRoleId && !member.roles.cache.has(giveaway.requiredRoleId)) {
      return interaction.reply({ embeds: [errorEmbed('Rôle requis', `Il te faut le rôle <@&${giveaway.requiredRoleId}> pour participer.`)], ephemeral: true });
    }

    let entries = 1;
    for (const bonus of giveaway.bonusRoles) {
      if (member.roles.cache.has(bonus.roleId)) entries += bonus.entries;
    }

    giveaway.participants.push({ userId, joinedAt: new Date(), entries });
    await giveaway.save();
    const embed = buildGiveawayEmbed(giveaway);
    await interaction.update({ embeds: [embed] });
    return interaction.followUp({
      embeds: [successEmbed('Inscrit!', `Tu participes au giveaway pour **${giveaway.prize}**! 🎉${entries > 1 ? `\nGrâce à ton rôle, tu as **${entries} entrées** (meilleures chances de gagner).` : ''}`)],
      ephemeral: true,
    });
  },

  endGiveaway,
  rescheduleActiveGiveaways,

  // Bouton public "Voir les participants" (sur le message du giveaway, accessible à tous)
  async handleListButton(interaction, giveawayId) {
    const giveaway = await Giveaway.findById(giveawayId);
    if (!giveaway) {
      return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Ce giveaway n\'existe plus.')], ephemeral: true });
    }

    let page = 0;
    const { embed, totalPages } = buildParticipantsPage(giveaway, page);

    if (totalPages <= 1) {
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const reply = await interaction.reply({ embeds: [embed], components: [buildPaginationRow(page, totalPages)], ephemeral: true, fetchReply: true });

    const col = reply.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time: 5 * 60 * 1000,
    });

    col.on('collect', async i => {
      const fresh = await Giveaway.findById(giveawayId);
      if (!fresh) return;
      if (i.customId === 'gw_page_first') page = 0;
      else if (i.customId === 'gw_page_prev') page = Math.max(0, page - 1);
      else if (i.customId === 'gw_page_next') page = page + 1;
      else if (i.customId === 'gw_page_last') page = Infinity;

      const built = buildParticipantsPage(fresh, page);
      page = built.page;
      await i.update({ embeds: [built.embed], components: [buildPaginationRow(page, built.totalPages)] });
    });

    col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
  },
};
