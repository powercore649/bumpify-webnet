const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const AdvancedPoll = require('../../models/AdvancedPoll');
const { COLORS, errorEmbed, successEmbed } = require('../../utils/embeds');

function buildResultsBar(votes, options) {
  const counts = new Array(options.length).fill(0);
  for (const v of votes.values()) counts[v]++;
  const total = counts.reduce((a,b) => a+b, 0) || 1;
  return options.map((opt, i) => {
    const pct = Math.round((counts[i] / total) * 100);
    const bar = '█'.repeat(Math.round(pct/5)).padEnd(20, '░');
    return `**${opt}**\n\`${bar}\` ${counts[i]} vote(s) (${pct}%)`;
  }).join('\n\n');
}

module.exports = {
  data: new SlashCommandBuilder().setName('sondage').setDescription('📊 Sondage avancé multi-options (anonyme ou public)')
    .addStringOption(o => o.setName('question').setDescription('Question du sondage').setRequired(true))
    .addStringOption(o => o.setName('options').setDescription('Options séparées par des virgules (2-10)').setRequired(true))
    .addBooleanOption(o => o.setName('anonyme').setDescription('Cacher qui a voté pour quoi ?'))
    .addIntegerOption(o => o.setName('durée_minutes').setDescription('Durée en minutes (0 = illimité)').setMinValue(0)),

  async execute(interaction) {
    const question = interaction.options.getString('question');
    const optsRaw  = interaction.options.getString('options').split(',').map(s => s.trim()).filter(Boolean);
    const anonymous= interaction.options.getBoolean('anonyme') || false;
    const duréeMin = interaction.options.getInteger('durée_minutes') || 0;

    if (optsRaw.length < 2 || optsRaw.length > 10) return interaction.reply({ embeds: [errorEmbed('Options invalides', 'Il faut entre 2 et 10 options.')], ephemeral: true });

    const endsAt = duréeMin > 0 ? new Date(Date.now() + duréeMin * 60000) : null;

    const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(`📊 ${question}`)
      .setDescription(buildResultsBar(new Map(), optsRaw))
      .setFooter({ text: `${anonymous ? '🔒 Anonyme' : '👁️ Public'}${endsAt ? ` • Fin dans ${duréeMin}min` : ''}` })
      .setTimestamp();

    const menu = new StringSelectMenuBuilder().setCustomId('sondage_vote_temp').setPlaceholder('Choisir une option…')
      .addOptions(optsRaw.map((o, i) => ({ label: o.slice(0,90), value: String(i) })));

    const msg = await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], fetchReply: true });

    const poll = await AdvancedPoll.create({ guildId: interaction.guildId, messageId: msg.id, channelId: interaction.channelId, question, options: optsRaw, anonymous, endsAt, createdBy: interaction.user.id });

    // Mettre à jour le customId avec l'ID réel
    const realMenu = new StringSelectMenuBuilder().setCustomId(`sondage_vote_${poll._id}`).setPlaceholder('Choisir une option…')
      .addOptions(optsRaw.map((o, i) => ({ label: o.slice(0,90), value: String(i) })));
    await interaction.editReply({ components: [new ActionRowBuilder().addComponents(realMenu)] });

    if (endsAt) setTimeout(() => closePoll(interaction.client, poll._id).catch(() => {}), duréeMin * 60000);
  },

  async handleVote(interaction, pollId, choiceIdx) {
    const poll = await AdvancedPoll.findById(pollId);
    if (!poll || poll.closed) return interaction.reply({ content: '❌ Ce sondage est fermé.', ephemeral: true });
    poll.votes.set(interaction.user.id, choiceIdx);
    await poll.save();

    const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(`📊 ${poll.question}`)
      .setDescription(buildResultsBar(poll.votes, poll.options))
      .setFooter({ text: `${poll.anonymous ? '🔒 Anonyme' : '👁️ Public'} • ${poll.votes.size} vote(s)` })
      .setTimestamp();
    await interaction.update({ embeds: [embed] });
  },
};

async function closePoll(client, pollId) {
  const poll = await AdvancedPoll.findById(pollId);
  if (!poll || poll.closed) return;
  poll.closed = true;
  await poll.save();
  try {
    const channel = await client.channels.fetch(poll.channelId);
    const msg = await channel.messages.fetch(poll.messageId);
    const embed = new EmbedBuilder().setColor(COLORS.warning).setTitle(`📊 [TERMINÉ] ${poll.question}`)
      .setDescription(buildResultsBar(poll.votes, poll.options))
      .setFooter({ text: `Sondage clos • ${poll.votes.size} vote(s) au total` })
      .setTimestamp();
    await msg.edit({ embeds: [embed], components: [] });
  } catch (_) {}
}
