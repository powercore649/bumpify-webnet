// commands/rank.js — Affiche la carte de niveau (XP) d'un membre
const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const XP = require('../../models/XP');
const { getOrCreateConfig, getOrCreateXp, generateRankCard, computeLevel } = require('./xp');
const { COLORS, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('🏆 Voir votre carte de niveau (ou celle d\'un autre membre)')
    .addUserOption(o => o.setName('membre').setDescription('Le membre à afficher').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();

    const target = interaction.options.getUser('membre') || interaction.user;
    if (target.bot) {
      return interaction.editReply({ embeds: [errorEmbed('Impossible', 'Les bots n\'ont pas de niveau.')] });
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      return interaction.editReply({ embeds: [errorEmbed('Introuvable', 'Ce membre n\'est plus sur le serveur.')] });
    }

    const cfg = await getOrCreateConfig(interaction.guild.id);
    const doc = await getOrCreateXp(interaction.guild.id, target.id);
    const rank = await XP.countDocuments({ guildId: interaction.guild.id, totalXp: { $gt: doc.totalXp } }) + 1;
    const { xpIntoLevel, xpForNext } = computeLevel(doc.totalXp);
    const remaining = Math.max(0, xpForNext - xpIntoLevel);

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setDescription(`**XP Level**: \`${member.displayName}\`\n\`${remaining.toLocaleString()}\` experience points needed for the next level!`)
      .addFields(
        { name: '⬆️ · Levels', value: `${doc.level}`, inline: true },
        { name: '💵 · Experience', value: `${xpIntoLevel.toLocaleString()}/${xpForNext.toLocaleString()}`, inline: true },
      )
      .setThumbnail(member.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'Bumpify', iconURL: interaction.client.user.displayAvatarURL() })
      .setTimestamp();

    try {
      const buffer = await generateRankCard(member, doc, rank, cfg.cardColor);
      embed.setImage('attachment://rank.png');
      return interaction.editReply({ embeds: [embed], files: [new AttachmentBuilder(buffer, { name: 'rank.png' })] });
    } catch (err) {
      console.error('❌ rank canvas:', err.message);
      embed.addFields(
        { name: 'Rang', value: `#${rank}`, inline: true },
        { name: 'XP total', value: `${doc.totalXp.toLocaleString()}`, inline: true },
        { name: 'Messages', value: `${doc.messages.toLocaleString()}`, inline: true },
      );
      return interaction.editReply({ embeds: [embed] });
    }
  },
};
