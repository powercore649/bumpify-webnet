const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const FAQ = require('../../models/FAQ');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');
const { randomUUID } = require('crypto');

module.exports = {
  data: new SlashCommandBuilder().setName('faq').setDescription('❓ Questions fréquentes du serveur')
    .addSubcommand(s => s.setName('ajouter').setDescription('Ajouter une FAQ *(Admin)*')
      .addStringOption(o => o.setName('question').setDescription('Question').setRequired(true))
      .addStringOption(o => o.setName('réponse').setDescription('Réponse').setRequired(true)))
    .addSubcommand(s => s.setName('voir').setDescription('Parcourir la FAQ'))
    .addSubcommand(s => s.setName('supprimer').setDescription('Supprimer une FAQ *(Admin)*')
      .addStringOption(o => o.setName('id').setDescription('ID de la FAQ').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'ajouter') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Administrateur requis.')], ephemeral: true });
      const q = interaction.options.getString('question');
      const a = interaction.options.getString('réponse');
      const faqId = randomUUID().split('-')[0];
      await FAQ.create({ guildId: interaction.guildId, question: q, answer: a, faqId });
      return interaction.reply({ embeds: [successEmbed('FAQ ajoutée', `**Q:** ${q}\nID: \`${faqId}\``)], ephemeral: true });
    }

    if (sub === 'supprimer') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Administrateur requis.')], ephemeral: true });
      const faqId = interaction.options.getString('id');
      const del = await FAQ.findOneAndDelete({ guildId: interaction.guildId, faqId });
      if (!del) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'ID invalide.')], ephemeral: true });
      return interaction.reply({ embeds: [successEmbed('FAQ supprimée', del.question)], ephemeral: true });
    }

    if (sub === 'voir') {
      const list = await FAQ.find({ guildId: interaction.guildId });
      if (!list.length) return interaction.reply({ embeds: [errorEmbed('Vide', 'Aucune FAQ configurée.')], ephemeral: true });

      const menu = new StringSelectMenuBuilder().setCustomId('faq_select').setPlaceholder('Choisir une question…')
        .addOptions(list.slice(0,25).map(f => ({ label: f.question.slice(0,90), value: f.faqId })));

      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('❓ FAQ').setDescription('Sélectionnez une question dans le menu ci-dessous.')],
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true,
      });
    }
  },

  async handleSelect(interaction) {
    const faqId = interaction.values[0];
    const faq = await FAQ.findOne({ guildId: interaction.guildId, faqId });
    if (!faq) return interaction.reply({ content: '❌ FAQ introuvable.', ephemeral: true });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle(`❓ ${faq.question}`).setDescription(faq.answer)], ephemeral: true });
  },
};
