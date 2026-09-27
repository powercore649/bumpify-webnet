const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { errorEmbed } = require('../../utils/embeds');
module.exports = {
  data: new SlashCommandBuilder().setName('announce').setDescription('📢 Envoyer une annonce dans un salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o=>o.setName('message').setDescription('Contenu de l\'annonce').setRequired(true))
    .addChannelOption(o=>o.setName('salon').setDescription('Salon cible (actuel par défaut)').addChannelTypes(ChannelType.GuildText))
    .addStringOption(o=>o.setName('titre').setDescription('Titre de l\'embed'))
    .addStringOption(o=>o.setName('couleur').setDescription('Couleur hex (ex: #FF0000)'))
    .addBooleanOption(o=>o.setName('ping_everyone').setDescription('Pinger @everyone ?')),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral:true });
    const msg     = interaction.options.getString('message');
    const ch      = interaction.options.getChannel('salon') || interaction.channel;
    const titre   = interaction.options.getString('titre') || '📢 Annonce';
    const hex     = interaction.options.getString('couleur') || '#5865F2';
    const pingAll = interaction.options.getBoolean('ping_everyone') || false;
    const color   = parseInt(hex.replace('#',''),16) || 0x5865F2;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(titre)
      .setDescription(msg)
      .setFooter({text:`Annoncé par ${interaction.user.tag}`,iconURL:interaction.user.displayAvatarURL()})
      .setTimestamp();

    try {
      await ch.send({ content:pingAll?'@everyone':null, embeds:[embed] });
      return interaction.editReply({ content:`✅ Annonce envoyée dans <#${ch.id}>.` });
    } catch(err) {
      return interaction.editReply({ embeds:[errorEmbed('Erreur',err.message)] });
    }
  },
};
