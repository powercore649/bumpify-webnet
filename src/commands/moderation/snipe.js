const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS, errorEmbed } = require('../../utils/embeds');

// Cache en mémoire : Map<channelId, {content, author, createdAt}>
const snipeCache = new Map();

module.exports = {
  snipeCache,
  data: new SlashCommandBuilder().setName('snipe').setDescription('👻 Voir le dernier message supprimé dans ce salon'),
  async execute(interaction) {
    const data = snipeCache.get(interaction.channelId);
    if(!data) return interaction.reply({ embeds:[errorEmbed('Aucun snipe','Aucun message supprimé récemment dans ce salon.')], ephemeral:true });
    return interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('👻 Dernier message supprimé')
      .setDescription(data.content||'*[Aucun contenu textuel]*')
      .setThumbnail(data.authorAvatar)
      .addFields(
        {name:'✍️ Auteur',value:`<@${data.authorId}> (${data.authorTag})`,inline:true},
        {name:'🕐 Envoyé',value:`<t:${Math.floor(data.createdAt/1000)}:R>`,inline:true},
      )
      .setFooter({text:'Bumpify • Snipe'})
      .setTimestamp()] });
  },
};
