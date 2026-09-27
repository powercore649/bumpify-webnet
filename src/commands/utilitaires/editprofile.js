const { SlashCommandBuilder } = require('discord.js');
const ProfileCustom = require('../../models/ProfileCustom');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('editprofile').setDescription('🎨 Personnaliser ton profil Bumpify')
    .addStringOption(o => o.setName('bio').setDescription('Ta bio (max 200 caractères)').setMaxLength(200))
    .addStringOption(o => o.setName('citation').setDescription('Ta citation favorite (max 100 caractères)').setMaxLength(100))
    .addStringOption(o => o.setName('couleur').setDescription('Couleur du thème (hex, ex: #FF5733)')),

  async execute(interaction) {
    const bio    = interaction.options.getString('bio');
    const quote  = interaction.options.getString('citation');
    const couleur= interaction.options.getString('couleur');

    if (couleur && !/^#?[0-9a-fA-F]{6}$/.test(couleur)) {
      return interaction.reply({ embeds: [errorEmbed('Couleur invalide', 'Format attendu : #RRGGBB')], ephemeral: true });
    }
    if (!bio && !quote && !couleur) {
      return interaction.reply({ embeds: [errorEmbed('Rien à modifier', 'Spécifie au moins un champ à mettre à jour.')], ephemeral: true });
    }

    const update = {};
    if (bio !== null) update.bio = bio;
    if (quote !== null) update.quote = quote;
    if (couleur) update.themeColor = couleur.startsWith('#') ? couleur : `#${couleur}`;

    await ProfileCustom.findOneAndUpdate({ userId: interaction.user.id, guildId: interaction.guildId }, update, { upsert: true });

    return interaction.reply({ embeds: [successEmbed('Profil mis à jour', 'Utilise `/profile` pour voir le résultat !')], ephemeral: true });
  },
};
