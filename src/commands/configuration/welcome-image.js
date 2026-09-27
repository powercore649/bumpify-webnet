// commands/configuration/welcome-image.js — Aperçu des images de bienvenue
// Délègue le rendu aux 4 styles du moteur welcomeCards (gradient, glass,
// banner, minimal) + support du fond personnalisé. Permet de tester un style
// précis sans toucher à la configuration du serveur.
const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits,
} = require('discord.js');
const { renderWelcomeImage } = require('../../utils/welcomeCards');
const { COLORS, successEmbed } = require('../../utils/embeds');
const { Welcome } = require('../../models/Welcome');

const STYLE_CHOICES = [
  { name: '🌈 Gradient néon (signature Bumpify)', value: 'gradient' },
  { name: '❄️ Vitrail de glace', value: 'glass' },
  { name: '🎭 Bandeau diagonal', value: 'banner' },
  { name: '⬜ Carte épurée', value: 'minimal' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome-image')
    .setDescription('🖼️ Prévisualiser une image de bienvenue Bumpify')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o
      .setName('style')
      .setDescription('Style de carte à prévisualiser (celui du serveur par défaut)')
      .addChoices(...STYLE_CHOICES))
    .addUserOption(o => o
      .setName('utilisateur')
      .setDescription('Utilisateur à simuler (vous par défaut)')),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getMember('utilisateur') || interaction.member;
    const requestedStyle = interaction.options.getString('style');

    let cfg = null;
    try {
      cfg = await Welcome.findOne({ guildId: interaction.guildId });
    } catch { /* pas de config : rendu par défaut */ }

    const config = {
      imageStyle: requestedStyle || cfg?.imageStyle || 'gradient',
      backgroundUrl: cfg?.backgroundUrl || null,
      imageText: cfg?.imageText || null,
      showFooter: cfg?.showFooter !== false,
    };

    try {
      const buf = await renderWelcomeImage(target, interaction.guild, config);
      const suffix = requestedStyle && cfg?.imageStyle && requestedStyle !== cfg.imageStyle
        ? `\n⚠️ Style demandé différent de la config du serveur (**${cfg.imageStyle}**) — aperçu seul.`
        : '';
      return interaction.editReply({
        content: `🖼️ Style : **${config.imageStyle}**${suffix}`,
        files: [new AttachmentBuilder(buf, { name: 'welcome-preview.png' })],
      });
    } catch (err) {
      console.error('welcome-image canvas:', err);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(COLORS.error).setTitle('❌ Erreur canvas').setDescription(err.message)],
      });
    }
  },
};
