const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const Sanction = require('../../models/Sanction');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');

// Système de sanctions graduées : 1=warn, 2=warn, 3=mute 1h, 4=mute 24h, 5+=kick
const ESCALATION = [
  null,
  { action: 'Avertissement',     auto: null },
  { action: 'Avertissement',     auto: null },
  { action: 'Mute 1 heure',      auto: 'mute', duration: 60*60*1000 },
  { action: 'Mute 24 heures',    auto: 'mute', duration: 24*60*60*1000 },
  { action: 'Kick',              auto: 'kick' },
];

module.exports = {
  data: new SlashCommandBuilder().setName('sanction').setDescription('⚖️ Système de sanctions graduées (strikes)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(s => s.setName('ajouter').setDescription('Ajouter un strike à un membre')
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
      .addStringOption(o => o.setName('raison').setDescription('Raison du strike').setRequired(true)))
    .addSubcommand(s => s.setName('voir').setDescription('Voir les strikes d\'un membre')
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)))
    .addSubcommand(s => s.setName('reset').setDescription('Réinitialiser les strikes d\'un membre')
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))),

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const target = interaction.options.getUser('membre');

    if (sub === 'voir') {
      const s = await Sanction.findOne({ guildId: interaction.guildId, userId: target.id });
      if (!s || !s.strikes) return interaction.reply({ embeds: [errorEmbed('Aucun strike', `${target.username} n'a aucun strike.`)], ephemeral: true });
      const embed = new EmbedBuilder().setColor(COLORS.warning).setTitle(`⚖️ Strikes — ${target.username}`)
        .addFields({ name: 'Total', value: `${s.strikes} strike(s)`, inline: true });
      s.history.slice(-5).forEach((h, i) => embed.addFields({ name: `#${i+1} — ${h.action}`, value: `${h.reason}\n*par <@${h.by}> — <t:${Math.floor(new Date(h.createdAt).getTime()/1000)}:R>*` }));
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'reset') {
      await Sanction.findOneAndUpdate({ guildId: interaction.guildId, userId: target.id }, { strikes: 0, history: [] }, { upsert: true });
      return interaction.reply({ embeds: [successEmbed('Strikes réinitialisés', `Les strikes de **${target.username}** ont été remis à zéro.`)], ephemeral: true });
    }

    if (sub === 'ajouter') {
      const raison = interaction.options.getString('raison');
      let s = await Sanction.findOneAndUpdate(
        { guildId: interaction.guildId, userId: target.id },
        { $inc: { strikes: 1 }, $set: { lastStrike: new Date() } },
        { upsert: true, new: true }
      );

      const step = Math.min(s.strikes, 5);
      const esc  = ESCALATION[step];

      s.history.push({ reason: raison, action: esc.action, by: interaction.user.id });
      await s.save();

      let autoResult = '';
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (member && esc.auto === 'mute') {
        await member.timeout(esc.duration, raison).catch(() => {});
        autoResult = `\n🔇 **Action automatique :** mute appliqué`;
      } else if (member && esc.auto === 'kick') {
        await member.kick(raison).catch(() => {});
        autoResult = `\n👢 **Action automatique :** membre expulsé`;
      }

      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.warning)
        .setTitle(`⚖️ Strike #${s.strikes} ajouté`)
        .setDescription(`**${target.username}** a maintenant **${s.strikes}** strike(s).\nAction : **${esc.action}**${autoResult}`)
        .addFields({ name: 'Raison', value: raison })] });
    }
  },
};
