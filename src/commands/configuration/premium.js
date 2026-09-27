// commands/premium.js — Commande publique : voir le statut Premium + avantages
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isPremium, getPremiumInfo, LIMITS } = require('../../utils/premium');
const { COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('premium').setDescription('💎 Voir le statut Premium de ce serveur'),

  async execute(interaction) {
    const active = await isPremium(interaction.guildId);
    const info   = await getPremiumInfo(interaction.guildId);

    const embed = new EmbedBuilder()
      .setColor(active ? 0xFFD700 : COLORS.primary)
      .setTitle(active ? '💎 Serveur Premium actif !' : '💎 Bumpify Premium')
      .setThumbnail(interaction.guild.iconURL({ dynamic: true }));

    if (active) {
      const lim = LIMITS.premium;
      embed.setDescription(
        `Ce serveur profite du Premium **${info.tier}** !\n` +
        (info.expiresAt ? `Expire <t:${Math.floor(new Date(info.expiresAt).getTime()/1000)}:R>` : '✨ **Durée illimitée**')
      ).addFields(
        { name: '🎭 Auto-rôles', value: `${lim.autoroles}`, inline: true },
        { name: '🛒 Articles boutique', value: `${lim.shopItems}`, inline: true },
        { name: '🏅 Badges', value: `${lim.badges}`, inline: true },
        { name: '📅 Événements', value: `${lim.events}`, inline: true },
        { name: '✅ Tâches todo', value: `${lim.todos}`, inline: true },
        { name: '🎫 Catégories tickets', value: `${lim.ticketCategories}`, inline: true },
      );
    } else {
      const free = LIMITS.free;
      embed.setDescription(
        'Ce serveur utilise la version **gratuite** de Bumpify.\n\n' +
        'Le Premium est **100% gratuit** et accordé manuellement par les développeurs du bot ' +
        '(partenariats, serveurs actifs, beta testeurs...). Aucun paiement n\'est requis ou accepté.\n\n' +
        '📩 Pour en faire la demande, contactez l\'équipe Bumpify.'
      ).addFields(
        { name: '🎭 Auto-rôles (actuel)', value: `${free.autoroles}`, inline: true },
        { name: '🛒 Articles boutique', value: `${free.shopItems}`, inline: true },
        { name: '🏅 Badges', value: `${free.badges}`, inline: true },
      );
    }

    embed.setFooter({ text: 'Bumpify • Premium' }).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  },
};
