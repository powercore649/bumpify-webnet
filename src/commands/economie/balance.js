const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Balance = require('../../models/Balance');
const { COLORS } = require('../../utils/embeds');
const { getAppEmoji } = require('../../utils/emojiSync');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('💰 Voir votre solde de pièces')
    .addUserOption(o => o.setName('user').setDescription('Utilisateur (vous par défaut)')),

  async execute(interaction, client) {
    await interaction.deferReply();
    const eCoin = getAppEmoji(client, 'bumpify_coin') || '💰';
    const user = interaction.options.getUser('user') || interaction.user;
    const balance = await Balance.findOne({ userId: user.id, guildId: interaction.guildId }) ||
                   await Balance.create({ userId: user.id, guildId: interaction.guildId });

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle(`${eCoin} Solde de ${user.username}`)
      .setThumbnail(user.displayAvatarURL())
      .addFields({ name: `${eCoin} Pièces`, value: `${balance.coins}`, inline: true })
      .setTimestamp();

    interaction.editReply({ embeds: [embed] });
  },
};
