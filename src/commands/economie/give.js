const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Balance = require('../../models/Balance');
const { COLORS, errorEmbed, successEmbed } = require('../../utils/embeds');
const { getAppEmoji } = require('../../utils/emojiSync');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('💝 Donner des pièces à quelqu\'un')
    .addUserOption(o => o.setName('user').setDescription('Utilisateur').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Montant').setMinValue(1).setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');

    if (target.id === interaction.user.id) {
      return interaction.editReply({ embeds: [errorEmbed('Impossible', 'Vous ne pouvez pas vous donner des pièces à vous-même.')] });
    }

    // Vérifier le solde du donateur
    let senderBalance = await Balance.findOne({ userId: interaction.user.id, guildId: interaction.guildId });
    if (!senderBalance) {
      return interaction.editReply({ embeds: [errorEmbed('Solde insuffisant', 'Vous n\'avez pas de pièces.')] });
    }

    if (senderBalance.coins < amount) {
      return interaction.editReply({ embeds: [errorEmbed('Solde insuffisant', `Vous n'avez que ${senderBalance.coins} 🪙`)] });
    }

    // Transférer les pièces
    senderBalance.coins -= amount;
    await senderBalance.save();

    let targetBalance = await Balance.findOne({ userId: target.id, guildId: interaction.guildId });
    if (!targetBalance) {
      targetBalance = await Balance.create({ userId: target.id, guildId: interaction.guildId });
    }
    targetBalance.coins += amount;
    await targetBalance.save();

    const eCoin = getAppEmoji(interaction.client, 'bumpify_coin') || '💰';
    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle('💝 Transfert effectué!')
      .addFields(
        { name: '👤 De', value: interaction.user.tag, inline: true },
        { name: '➜', value: target.tag, inline: true },
        { name: `${eCoin} Montant`, value: `${amount} 🪙`, inline: true },
      )
      .setTimestamp();

    interaction.editReply({ embeds: [embed] });
  },
};
