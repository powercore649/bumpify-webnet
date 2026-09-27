const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Fishing = require('../../models/Fishing');
const { COLORS, errorEmbed } = require('../../utils/embeds');
const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

module.exports = {
  data: new SlashCommandBuilder().setName('fishboard').setDescription('🏆 Classement des meilleurs pêcheurs'),
  async execute(interaction) {
    await interaction.deferReply();
    const top = await Fishing.find({ guildId: interaction.guildId, totalCatch: { $gt: 0 } }).sort({ totalValue: -1 }).limit(10);
    if (!top.length) return interaction.editReply({ embeds: [errorEmbed('Aucune donnée', 'Personne n\'a encore pêché. `/fish` pour commencer !')] });

    let desc = '';
    for (const [i, p] of top.entries()) {
      try { const u = await interaction.client.users.fetch(p.userId); desc += `${medals[i]} **${u.username}** — ${p.totalValue} 🪙 (${p.totalCatch} prises)\n　 Meilleure prise : ${p.bestCatch || '—'}\n`; }
      catch { desc += `${medals[i]} *Inconnu* — ${p.totalValue} 🪙\n`; }
    }
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('🏆 Classement Pêche').setDescription(desc)] });
  },
};
