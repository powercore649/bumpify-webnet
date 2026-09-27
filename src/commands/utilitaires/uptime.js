const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/embeds');
const START = Date.now();
module.exports = {
  data: new SlashCommandBuilder().setName('uptime').setDescription('⏱️ Voir depuis combien de temps le bot est en ligne'),
  async execute(interaction) {
    const ms = Date.now() - START;
    const s=Math.floor(ms/1000)%60, m=Math.floor(ms/60000)%60, h=Math.floor(ms/3600000)%24, d=Math.floor(ms/86400000);
    const used = process.memoryUsage();
    return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.info)
      .setTitle('⏱️ Uptime')
      .addFields(
        {name:'🕐 En ligne depuis', value:`**${d}j ${h}h ${m}m ${s}s**`, inline:false},
        {name:'📅 Démarré le',      value:`<t:${Math.floor(START/1000)}:f>`, inline:true},
        {name:'💾 RAM utilisée',    value:`**${(used.heapUsed/1024/1024).toFixed(1)} MB**`, inline:true},
        {name:'🌍 Serveurs',        value:`**${interaction.client.guilds.cache.size}**`, inline:true},
      ).setTimestamp()], ephemeral:true });
  },
};
