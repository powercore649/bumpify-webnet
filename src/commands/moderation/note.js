const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const Note = require('../../models/Note');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('note').setDescription('📝 Gérer les notes sur les membres')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(s=>s.setName('ajouter').setDescription('Ajouter une note')
      .addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true))
      .addStringOption(o=>o.setName('note').setDescription('Contenu de la note').setRequired(true)))
    .addSubcommand(s=>s.setName('voir').setDescription('Voir les notes d\'un membre')
      .addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true)))
    .addSubcommand(s=>s.setName('supprimer').setDescription('Supprimer une note')
      .addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true))
      .addIntegerOption(o=>o.setName('index').setDescription('Numéro de la note (voir /note voir)').setRequired(true).setMinValue(1))),

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const target = interaction.options.getUser('membre');

    if(sub==='ajouter') {
      const texte = interaction.options.getString('note');
      await Note.create({ guildId:interaction.guildId, userId:target.id, modId:interaction.user.id, note:texte });
      return interaction.reply({ embeds:[successEmbed('Note ajoutée',`Note pour **${target.username}** :\n\`\`\`${texte}\`\`\``)], ephemeral:true });
    }

    if(sub==='voir') {
      const notes = await Note.find({ guildId:interaction.guildId, userId:target.id }).sort({createdAt:-1}).limit(10);
      if(!notes.length) return interaction.reply({ embeds:[errorEmbed('Aucune note',`Pas de notes pour **${target.username}**.`)], ephemeral:true });
      const embed = new EmbedBuilder().setColor(COLORS.info).setTitle(`📝 Notes — ${target.username}`).setTimestamp();
      notes.forEach((n,i)=>{
        embed.addFields({name:`#${i+1} — <t:${Math.floor(new Date(n.createdAt).getTime()/1000)}:d>`,value:`${n.note}\n*par <@${n.modId}>*`});
      });
      return interaction.reply({ embeds:[embed], ephemeral:true });
    }

    if(sub==='supprimer') {
      const idx   = interaction.options.getInteger('index')-1;
      const notes = await Note.find({ guildId:interaction.guildId, userId:target.id }).sort({createdAt:-1});
      if(!notes[idx]) return interaction.reply({ embeds:[errorEmbed('Introuvable','Note introuvable.')], ephemeral:true });
      await Note.deleteOne({ _id:notes[idx]._id });
      return interaction.reply({ embeds:[successEmbed('Note supprimée',`Note #${idx+1} de **${target.username}** supprimée.`)], ephemeral:true });
    }
  },
};
