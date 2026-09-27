const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('🎲 Lancer un dé')
    .addIntegerOption(o => o.setName('sides').setDescription('Nombre de faces (1-999)').setMinValue(2).setMaxValue(999)),

  async execute(interaction) {
    const sides = interaction.options.getInteger('sides') || 6;
    const result = Math.floor(Math.random() * sides) + 1;

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle(`🎲 Lancer de dé (1-${sides})`)
      .setDescription(`Résultat: **${result}**`)
      .setTimestamp();

    interaction.reply({ embeds: [embed] });
  },
};
