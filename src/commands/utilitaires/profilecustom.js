// commands/profilecustom.js — Personnalisation avancée de la carte de profil (fond, accent, badges)
const { SlashCommandBuilder } = require('discord.js');
const ProfileCustom = require('../../models/ProfileCustom');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

const HEX_REGEX = /^#?[0-9a-fA-F]{6}$/;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profilecustom')
    .setDescription('🎨 Personnaliser l\'apparence de ta carte de profil')
    .addStringOption(o => o.setName('couleur_fond').setDescription('Couleur de fond personnalisée (hex, ex: #1a1b2e)'))
    .addStringOption(o => o.setName('banniere').setDescription('URL d\'une image de bannière de fond'))
    .addStringOption(o => o.setName('couleur_accent').setDescription('Couleur d\'accent (barre / anneau avatar, hex, ex: #FF5733)'))
    .addBooleanOption(o => o.setName('afficher_badges').setDescription('Afficher tes badges sur la carte de profil')),

  async execute(interaction) {
    const bgColor = interaction.options.getString('couleur_fond');
    const bannerUrl = interaction.options.getString('banniere');
    const accentColor = interaction.options.getString('couleur_accent');
    const showBadges = interaction.options.getBoolean('afficher_badges');

    if (bgColor && !HEX_REGEX.test(bgColor)) {
      return interaction.reply({ embeds: [errorEmbed('Couleur invalide', 'Format attendu pour la couleur de fond : #RRGGBB')], ephemeral: true });
    }
    if (accentColor && !HEX_REGEX.test(accentColor)) {
      return interaction.reply({ embeds: [errorEmbed('Couleur invalide', 'Format attendu pour la couleur d\'accent : #RRGGBB')], ephemeral: true });
    }
    if (bannerUrl && !/^https?:\/\//i.test(bannerUrl)) {
      return interaction.reply({ embeds: [errorEmbed('URL invalide', 'La bannière doit être une URL valide (http(s)://...)')], ephemeral: true });
    }
    if (bgColor === null && bannerUrl === null && accentColor === null && showBadges === null) {
      return interaction.reply({ embeds: [errorEmbed('Rien à modifier', 'Spécifie au moins un champ à mettre à jour.')], ephemeral: true });
    }

    const update = {};
    if (bgColor) update.bgColor = bgColor.startsWith('#') ? bgColor : `#${bgColor}`;
    if (bannerUrl !== null) update.bannerUrl = bannerUrl;
    if (accentColor) update.accentColor = accentColor.startsWith('#') ? accentColor : `#${accentColor}`;
    if (showBadges !== null) update.showBadges = showBadges;

    await ProfileCustom.findOneAndUpdate({ userId: interaction.user.id, guildId: interaction.guildId }, update, { upsert: true });

    return interaction.reply({ embeds: [successEmbed('Personnalisation enregistrée', 'Utilise `/profile` pour voir le résultat !')], ephemeral: true });
  },
};
