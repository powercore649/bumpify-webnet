// commands/warnconfig.js — Avertissements à paliers configurables (action auto à N warns)
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const WarnThresholds = require('../../models/WarnThresholds');
const { COLORS, errorEmbed, successEmbed } = require('../../utils/embeds');

async function getOrCreate(guildId) {
  let cfg = await WarnThresholds.findOne({ guildId });
  if (!cfg) cfg = await WarnThresholds.create({ guildId });
  return cfg;
}

const ACTION_LABELS = { mute: '🔇 Mute', kick: '👋 Kick', ban: '🔨 Ban' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnconfig')
    .setDescription('⚠️ Configurer les paliers d\'avertissements (action automatique à N warns)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(s => s.setName('ajouter').setDescription('Ajouter un palier d\'avertissements')
      .addIntegerOption(o => o.setName('seuil').setDescription('Nombre d\'avertissements déclenchant l\'action').setRequired(true).setMinValue(1))
      .addStringOption(o => o.setName('action').setDescription('Action à appliquer').setRequired(true).addChoices(
        { name: '🔇 Mute', value: 'mute' },
        { name: '👋 Kick', value: 'kick' },
        { name: '🔨 Ban',  value: 'ban'  },
      ))
      .addIntegerOption(o => o.setName('duree').setDescription('Durée du mute en minutes (uniquement pour action = mute, 0 = défaut)').setMinValue(0)))
    .addSubcommand(s => s.setName('retirer').setDescription('Retirer un palier d\'avertissements')
      .addIntegerOption(o => o.setName('seuil').setDescription('Seuil à retirer').setRequired(true).setMinValue(1)))
    .addSubcommand(s => s.setName('liste').setDescription('Voir les paliers configurés')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = await getOrCreate(interaction.guildId);

    if (sub === 'ajouter') {
      const seuil = interaction.options.getInteger('seuil');
      const action = interaction.options.getString('action');
      const duree = interaction.options.getInteger('duree') || 0;

      cfg.thresholds = cfg.thresholds.filter(t => t.count !== seuil);
      cfg.thresholds.push({ count: seuil, action, duration: duree });
      cfg.thresholds.sort((a, b) => a.count - b.count);
      await cfg.save();

      return interaction.reply({ embeds: [successEmbed('Palier ajouté', `À **${seuil} avertissement(s)** → **${ACTION_LABELS[action]}**${action === 'mute' && duree > 0 ? ` (${duree} min)` : ''}`)], ephemeral: true });
    }

    if (sub === 'retirer') {
      const seuil = interaction.options.getInteger('seuil');
      const exists = cfg.thresholds.some(t => t.count === seuil);
      if (!exists) return interaction.reply({ embeds: [errorEmbed('Introuvable', `Aucun palier à ${seuil} avertissements.`)], ephemeral: true });

      cfg.thresholds = cfg.thresholds.filter(t => t.count !== seuil);
      await cfg.save();
      return interaction.reply({ embeds: [successEmbed('Palier retiré', `Le palier à **${seuil} avertissement(s)** a été supprimé.`)], ephemeral: true });
    }

    if (sub === 'liste') {
      if (!cfg.thresholds.length) {
        return interaction.reply({ embeds: [errorEmbed('Aucun palier', 'Aucun palier d\'avertissements configuré. Utilisez `/warnconfig ajouter`.')], ephemeral: true });
      }
      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('⚠️ Paliers d\'avertissements configurés')
        .setDescription(cfg.thresholds.map(t => `**${t.count}** avertissement(s) → **${ACTION_LABELS[t.action]}**${t.action === 'mute' && t.duration > 0 ? ` (${t.duration} min)` : ''}`).join('\n'))
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
