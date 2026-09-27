const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getOrCreateAutoMod } = require('./raidmode');
const { COLORS, successEmbed } = require('../../utils/embeds');

const ACTION_LABELS = {
  lock:     '🔒 Verrouiller les invitations',
  kick_new: '👤 Kick les comptes récents',
  verify:   '🛡️ Exiger une vérification',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raidautoconfig')
    .setDescription('🚨 Configurer le déclenchement automatique du mode raid')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('config').setDescription('Configurer le déclenchement automatique du mode raid')
      .addBooleanOption(o => o.setName('auto_declencheur').setDescription('Activer le déclenchement automatique (utilise le seuil de /automod raid)'))
      .addIntegerOption(o => o.setName('age_min_compte').setDescription('Âge minimum du compte en jours (0 = désactivé)').setMinValue(0))
      .addStringOption(o => o.setName('action').setDescription('Action appliquée lors du déclenchement automatique').addChoices(
        { name: '🔒 Verrouiller les invitations', value: 'lock' },
        { name: '👤 Kick les comptes récents',    value: 'kick_new' },
        { name: '🛡️ Exiger une vérification',    value: 'verify' },
      ))
      .addIntegerOption(o => o.setName('auto_desactivation_min').setDescription('Désactivation automatique après N minutes (0 = désactivé)').setMinValue(0)))
    .addSubcommand(s => s.setName('statut').setDescription('Voir la configuration du mode raid automatique')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const cfg = await getOrCreateAutoMod(guild.id);

    if (sub === 'config') {
      const autoTrigger = interaction.options.getBoolean('auto_declencheur');
      const ageMin = interaction.options.getInteger('age_min_compte');
      const action = interaction.options.getString('action');
      const autoDisable = interaction.options.getInteger('auto_desactivation_min');

      if (autoTrigger !== null) cfg.raidAutoTrigger = autoTrigger;
      if (ageMin !== null) cfg.raidMinAccountAge = ageMin;
      if (action) cfg.raidAutoAction = action;
      if (autoDisable !== null) cfg.raidAutoDisableMin = autoDisable;

      await cfg.save();
      return interaction.reply({ embeds: [successEmbed('Configuration du mode raid automatique mise à jour',
        `Déclenchement auto : **${cfg.raidAutoTrigger ? 'Activé' : 'Désactivé'}** (basé sur le seuil de \`/automod raid\`)\nÂge minimum du compte : **${cfg.raidMinAccountAge} jour(s)**\nAction : **${ACTION_LABELS[cfg.raidAutoAction]}**\nAuto-désactivation : **${cfg.raidAutoDisableMin > 0 ? `${cfg.raidAutoDisableMin} min` : 'Désactivée'}**`)], ephemeral: true });
    }

    if (sub === 'statut') {
      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('🚨 Mode Raid — Configuration automatique')
        .addFields(
          { name: 'Déclenchement auto', value: cfg.raidAutoTrigger ? '🟢 Activé' : '🔴 Désactivé', inline: true },
          { name: 'État actuel', value: cfg.raidModeActive ? '🚨 ACTIF' : '✅ Inactif', inline: true },
          { name: 'Seuil (depuis /automod raid)', value: `${cfg.raidThreshold} joins / ${cfg.raidWindow / 1000}s`, inline: false },
          { name: 'Âge minimum compte', value: cfg.raidMinAccountAge > 0 ? `${cfg.raidMinAccountAge} jour(s)` : '*Désactivé*', inline: true },
          { name: 'Action', value: ACTION_LABELS[cfg.raidAutoAction], inline: true },
          { name: 'Auto-désactivation', value: cfg.raidAutoDisableMin > 0 ? `${cfg.raidAutoDisableMin} min` : '*Désactivée*', inline: true },
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
