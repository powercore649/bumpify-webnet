'use strict';
// commands/joke.js — v2 : catégories, suspense (chute cachée), notation 👍/👎, blague suivante
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('../../utils/embeds');
const { JOKES, CATEGORIES } = require('../../utils/jokesData');
const { pickRandomJoke, applyRating } = require('../../utils/jokeEngine');
const JokeRating = require('../../models/JokeRating');

const COLLECTOR_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RECENT_TRACKED = 15;

// Anti-répétition en mémoire (par utilisateur) — purement cosmétique, pas persisté en DB
const recentByUser = new Map();
function getRecent(userId) {
  if (!recentByUser.has(userId)) recentByUser.set(userId, new Set());
  return recentByUser.get(userId);
}
function trackRecent(userId, jokeId) {
  const set = getRecent(userId);
  set.add(jokeId);
  if (set.size > MAX_RECENT_TRACKED) {
    const first = set.values().next().value;
    set.delete(first);
  }
}

function categoryLabel(key) {
  return key === 'all' ? '🎲 Toutes catégories' : (CATEGORIES[key] || key);
}

function buildSetupEmbed(joke) {
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('😄 Blague')
    .setDescription(`${categoryLabel(joke.category)}\n\n**${joke.setup}**`)
    .setFooter({ text: 'Clique sur 😏 pour voir la chute...' });
}

async function buildPunchlineEmbed(joke) {
  const rating = await JokeRating.findOne({ jokeId: joke.id }) || { up: 0, down: 0 };
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('😄 Blague')
    .setDescription(`${categoryLabel(joke.category)}\n\n**${joke.setup}**\n\n😂 ${joke.punchline}`)
    .setFooter({ text: `👍 ${rating.up}  ·  👎 ${rating.down}` });
}

function setupRow(joke) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`joke_reveal_${joke.id}`).setLabel('😏 Voir la chute').setStyle(ButtonStyle.Primary),
  );
}

function punchlineRow(joke) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`joke_up_${joke.id}`).setLabel('👍').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`joke_down_${joke.id}`).setLabel('👎').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('joke_another').setLabel('🔄 Une autre').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('joke_stop').setLabel('✖').setStyle(ButtonStyle.Danger),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('joke')
    .setDescription('😄 Entendre une blague (avec chute cachée, notation, et plein de catégories)')
    .addStringOption(o => o.setName('categorie').setDescription('Choisir une catégorie').addChoices(
      { name: '🎲 Toutes catégories', value: 'all' },
      ...Object.entries(CATEGORIES).map(([value, name]) => ({ name, value })),
    )),

  async execute(interaction) {
    const category = interaction.options.getString('categorie') || 'all';
    const userId = interaction.user.id;

    let joke = pickRandomJoke(JOKES, { category, exclude: getRecent(userId) });
    if (!joke) {
      return interaction.reply({ content: '❌ Aucune blague disponible pour cette catégorie.', ephemeral: true });
    }
    trackRecent(userId, joke.id);

    const message = await interaction.reply({ embeds: [buildSetupEmbed(joke)], components: [setupRow(joke)], fetchReply: true });
    attachCollector(message, interaction, category);
  },
};

function attachCollector(message, interaction, category) {
  const userId = interaction.user.id;
  const collector = message.createMessageComponentCollector({ filter: i => i.user.id === userId, time: COLLECTOR_TIMEOUT_MS });
  let currentJoke = null;

  collector.on('collect', async (i) => {
    const id = i.customId;

    if (id.startsWith('joke_reveal_')) {
      const jokeId = id.replace('joke_reveal_', '');
      currentJoke = JOKES.find(j => j.id === jokeId);
      if (!currentJoke) return i.update({ content: '❌ Blague introuvable.', embeds: [], components: [] });
      return i.update({ embeds: [await buildPunchlineEmbed(currentJoke)], components: [punchlineRow(currentJoke)] });
    }

    if (id.startsWith('joke_up_') || id.startsWith('joke_down_')) {
      const jokeId = id.replace(id.startsWith('joke_up_') ? 'joke_up_' : 'joke_down_', '');
      const joke = JOKES.find(j => j.id === jokeId);
      if (!joke) return i.reply({ content: '❌ Blague introuvable.', ephemeral: true });

      let rating = await JokeRating.findOne({ jokeId });
      if (!rating) rating = await JokeRating.create({ jokeId });
      const result = applyRating(rating, i.user.id, id.startsWith('joke_up_') ? 'up' : 'down');
      if (!result.changed) return i.reply({ content: '❌ Tu as déjà voté ainsi pour cette blague.', ephemeral: true });
      await rating.save();

      return i.update({ embeds: [await buildPunchlineEmbed(joke)], components: [punchlineRow(joke)] });
    }

    if (id === 'joke_another') {
      const joke = pickRandomJoke(JOKES, { category, exclude: getRecent(userId) });
      if (!joke) return i.reply({ content: '❌ Aucune blague disponible.', ephemeral: true });
      trackRecent(userId, joke.id);
      return i.update({ embeds: [buildSetupEmbed(joke)], components: [setupRow(joke)] });
    }

    if (id === 'joke_stop') {
      collector.stop('closed');
      return i.update({ components: [] });
    }
  });

  collector.on('end', (_, reason) => {
    if (reason === 'closed') return;
    interaction.editReply({ components: [] }).catch(() => {});
  });
}
