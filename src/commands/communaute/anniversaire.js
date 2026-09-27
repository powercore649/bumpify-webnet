const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Birthday = require('../../models/Birthday');
const { successEmbed, errorEmbed, COLORS } = require('../../utils/embeds');

const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // février tolérant (29) pour accepter le 29/02

module.exports = {
  data: new SlashCommandBuilder()
    .setName('anniversaire')
    .setDescription('🎂 Gérer votre date d\'anniversaire sur ce serveur')
    .addSubcommand((s) => s.setName('definir').setDescription('Définir votre date d\'anniversaire')
      .addIntegerOption((o) => o.setName('jour').setDescription('Jour (1-31)').setMinValue(1).setMaxValue(31).setRequired(true))
      .addIntegerOption((o) => o.setName('mois').setDescription('Mois (1-12)').setMinValue(1).setMaxValue(12).setRequired(true))
      .addIntegerOption((o) => o.setName('annee').setDescription('Année de naissance (optionnel, jamais affichée publiquement)').setMinValue(1900).setMaxValue(new Date().getFullYear())))
    .addSubcommand((s) => s.setName('supprimer').setDescription('Supprimer votre date d\'anniversaire enregistrée'))
    .addSubcommand((s) => s.setName('voir').setDescription('Voir la date d\'anniversaire de quelqu\'un')
      .addUserOption((o) => o.setName('membre').setDescription('Le membre (vous par défaut)')))
    .addSubcommand((s) => s.setName('liste').setDescription('Voir les 10 prochains anniversaires du serveur')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'definir') {
      const day = interaction.options.getInteger('jour');
      const month = interaction.options.getInteger('mois');
      const year = interaction.options.getInteger('annee');

      if (day > DAYS_IN_MONTH[month - 1]) {
        return interaction.reply({ embeds: [errorEmbed('Date invalide', `${MONTH_NAMES[month - 1]} ne compte pas ${day} jours.`)], ephemeral: true });
      }

      await Birthday.findOneAndUpdate(
        { guildId, userId: interaction.user.id },
        { day, month, year: year ?? null, lastAnnouncedYear: null },
        { upsert: true },
      );

      return interaction.reply({
        embeds: [successEmbed('Anniversaire enregistré', `Votre anniversaire est fixé au **${day} ${MONTH_NAMES[month - 1]}**.`)],
        ephemeral: true,
      });
    }

    if (sub === 'supprimer') {
      await Birthday.deleteOne({ guildId, userId: interaction.user.id });
      return interaction.reply({ embeds: [successEmbed('Anniversaire supprimé')], ephemeral: true });
    }

    if (sub === 'voir') {
      const target = interaction.options.getUser('membre') || interaction.user;
      const bday = await Birthday.findOne({ guildId, userId: target.id });
      if (!bday) {
        return interaction.reply({ embeds: [errorEmbed('Aucune date enregistrée', `${target.id === interaction.user.id ? 'Vous n\'avez' : `${target.username} n'a`} pas encore défini de date d'anniversaire.`)], ephemeral: true });
      }
      return interaction.reply({
        embeds: [successEmbed('Anniversaire', `🎂 **${target.username}** — ${bday.day} ${MONTH_NAMES[bday.month - 1]}`)],
        ephemeral: true,
      });
    }

    if (sub === 'liste') {
      const all = await Birthday.find({ guildId });
      if (all.length === 0) {
        return interaction.reply({ embeds: [errorEmbed('Aucun anniversaire enregistré sur ce serveur')], ephemeral: true });
      }

      const now = new Date();
      const todayIdx = now.getMonth() * 31 + now.getDate();

      const sorted = all
        .map((b) => ({ ...b.toObject(), sortKey: (b.month * 31 + b.day - todayIdx + 372) % 372 }))
        .sort((a, b) => a.sortKey - b.sortKey)
        .slice(0, 10);

      const lines = sorted.map((b) => `<@${b.userId}> — **${b.day} ${MONTH_NAMES[b.month - 1]}**`);

      const embed = new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle('🎂 Prochains anniversaires')
        .setDescription(lines.join('\n'))
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }
  },
};
