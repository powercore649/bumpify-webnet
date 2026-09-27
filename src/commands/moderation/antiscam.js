const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const AntiScamConfig = require('../../models/AntiScamConfig');
const { COLORS, successEmbed } = require('../../utils/embeds');

async function getOrCreate(guildId) {
  let cfg = await AntiScamConfig.findOne({ guildId });
  if (!cfg) cfg = await AntiScamConfig.create({ guildId });
  return cfg;
}

const ACTION_LABELS = {
  none: 'Aucune (alerte uniquement)',
  warn: '⚠️ Avertissement',
  mute: '🔇 Mute temporaire',
  kick: '👢 Kick',
  ban: '🔨 Ban',
};

module.exports = {
  getOrCreate,
  data: new SlashCommandBuilder()
    .setName('antiscam')
    .setDescription("🛡️ Configurer le système anti-arnaque par image")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('activer').setDescription('Activer ou désactiver le système')
      .addBooleanOption((o) => o.setName('etat').setDescription('Activé ?').setRequired(true)))
    .addSubcommand((s) => s.setName('salon').setDescription("Définir le salon d'alerte")
      .addChannelOption((o) => o.setName('salon').setDescription('Salon des alertes').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((s) => s.setName('seuil').setDescription("Définir le seuil de suspicion déclenchant l'action")
      .addIntegerOption((o) => o.setName('valeur').setDescription('0 à 100').setMinValue(0).setMaxValue(100).setRequired(true)))
    .addSubcommand((s) => s.setName('action').setDescription('Action appliquée quand le seuil est atteint')
      .addStringOption((o) => o.setName('type').setDescription('Action').setRequired(true).addChoices(
        { name: 'Aucune (alerte uniquement)', value: 'none' },
        { name: '⚠️ Avertissement', value: 'warn' },
        { name: '🔇 Mute temporaire', value: 'mute' },
        { name: '👢 Kick', value: 'kick' },
        { name: '🔨 Ban', value: 'ban' },
      ))
      .addIntegerOption((o) => o.setName('duree_mute').setDescription('Durée du mute en minutes (si action = mute)').setMinValue(1)))
    .addSubcommand((s) => s.setName('supprimer-message').setDescription('Supprimer automatiquement le message suspect ?')
      .addBooleanOption((o) => o.setName('etat').setDescription('Supprimer ?').setRequired(true)))
    .addSubcommand((s) => s.setName('categories').setDescription('Activer/désactiver des catégories de détection')
      .addBooleanOption((o) => o.setName('crypto').setDescription('Crypto / faux giveaways'))
      .addBooleanOption((o) => o.setName('urgence').setDescription("Incitation à l'action / urgence"))
      .addBooleanOption((o) => o.setName('usurpation').setDescription('Usurpation de marque connue'))
      .addBooleanOption((o) => o.setName('financier').setDescription('Retrait / transfert financier suspect')))
    .addSubcommand((s) => s.setName('mot-cle').setDescription('Ajouter ou retirer un mot-clé personnalisé')
      .addStringOption((o) => o.setName('action').setDescription('Ajouter ou retirer').setRequired(true).addChoices(
        { name: 'Ajouter', value: 'add' }, { name: 'Retirer', value: 'remove' },
      ))
      .addStringOption((o) => o.setName('mot').setDescription('Le mot-clé').setRequired(true)))
    .addSubcommand((s) => s.setName('exempter-role').setDescription('Exempter un rôle du scan')
      .addRoleOption((o) => o.setName('role').setDescription('Rôle à exempter').setRequired(true))
      .addBooleanOption((o) => o.setName('retirer').setDescription('Retirer cette exemption ?')))
    .addSubcommand((s) => s.setName('exempter-salon').setDescription('Exempter un salon du scan')
      .addChannelOption((o) => o.setName('salon').setDescription('Salon à exempter').setRequired(true))
      .addBooleanOption((o) => o.setName('retirer').setDescription('Retirer cette exemption ?')))
    .addSubcommand((s) => s.setName('statut').setDescription('Voir la configuration actuelle et les statistiques')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = await getOrCreate(interaction.guild.id);

    if (sub === 'activer') {
      cfg.enabled = interaction.options.getBoolean('etat');
      await cfg.save();
      return interaction.reply({ embeds: [successEmbed('Système anti-arnaque', cfg.enabled ? 'Activé ✅' : 'Désactivé ❌')], ephemeral: true });
    }

    if (sub === 'salon') {
      cfg.logChannelId = interaction.options.getChannel('salon').id;
      await cfg.save();
      return interaction.reply({ embeds: [successEmbed('Salon d\'alerte mis à jour', `<#${cfg.logChannelId}>`)], ephemeral: true });
    }

    if (sub === 'seuil') {
      cfg.threshold = interaction.options.getInteger('valeur');
      await cfg.save();
      return interaction.reply({ embeds: [successEmbed('Seuil mis à jour', `Indice de suspicion déclencheur : **${cfg.threshold}%**`)], ephemeral: true });
    }

    if (sub === 'action') {
      cfg.action = interaction.options.getString('type');
      const duree = interaction.options.getInteger('duree_mute');
      if (duree) cfg.muteDuration = duree;
      await cfg.save();
      return interaction.reply({ embeds: [successEmbed('Action mise à jour', ACTION_LABELS[cfg.action])], ephemeral: true });
    }

    if (sub === 'supprimer-message') {
      cfg.deleteMessage = interaction.options.getBoolean('etat');
      await cfg.save();
      return interaction.reply({ embeds: [successEmbed('Suppression automatique', cfg.deleteMessage ? 'Activée' : 'Désactivée')], ephemeral: true });
    }

    if (sub === 'categories') {
      const crypto = interaction.options.getBoolean('crypto');
      const urgence = interaction.options.getBoolean('urgence');
      const usurpation = interaction.options.getBoolean('usurpation');
      const financier = interaction.options.getBoolean('financier');
      if (crypto !== null) cfg.detectCrypto = crypto;
      if (urgence !== null) cfg.detectUrgency = urgence;
      if (usurpation !== null) cfg.detectImpersonation = usurpation;
      if (financier !== null) cfg.detectFinancial = financier;
      await cfg.save();
      return interaction.reply({ embeds: [successEmbed('Catégories de détection mises à jour',
        `Crypto/giveaways : **${cfg.detectCrypto ? 'ON' : 'OFF'}**\nUrgence : **${cfg.detectUrgency ? 'ON' : 'OFF'}**\nUsurpation : **${cfg.detectImpersonation ? 'ON' : 'OFF'}**\nFinancier : **${cfg.detectFinancial ? 'ON' : 'OFF'}**`)], ephemeral: true });
    }

    if (sub === 'mot-cle') {
      const action = interaction.options.getString('action');
      const mot = interaction.options.getString('mot').trim().toLowerCase();
      if (action === 'add') {
        if (!cfg.customKeywords.includes(mot)) cfg.customKeywords.push(mot);
      } else {
        cfg.customKeywords = cfg.customKeywords.filter((k) => k !== mot);
      }
      await cfg.save();
      return interaction.reply({ embeds: [successEmbed('Mots-clés personnalisés', cfg.customKeywords.length ? cfg.customKeywords.map((k) => `\`${k}\``).join(', ') : '*Aucun*')], ephemeral: true });
    }

    if (sub === 'exempter-role') {
      const role = interaction.options.getRole('role');
      const retirer = interaction.options.getBoolean('retirer');
      if (retirer) cfg.exemptRoles = cfg.exemptRoles.filter((r) => r !== role.id);
      else if (!cfg.exemptRoles.includes(role.id)) cfg.exemptRoles.push(role.id);
      await cfg.save();
      return interaction.reply({ embeds: [successEmbed('Rôles exemptés', cfg.exemptRoles.length ? cfg.exemptRoles.map((r) => `<@&${r}>`).join(', ') : '*Aucun*')], ephemeral: true });
    }

    if (sub === 'exempter-salon') {
      const salon = interaction.options.getChannel('salon');
      const retirer = interaction.options.getBoolean('retirer');
      if (retirer) cfg.exemptChannels = cfg.exemptChannels.filter((c) => c !== salon.id);
      else if (!cfg.exemptChannels.includes(salon.id)) cfg.exemptChannels.push(salon.id);
      await cfg.save();
      return interaction.reply({ embeds: [successEmbed('Salons exemptés', cfg.exemptChannels.length ? cfg.exemptChannels.map((c) => `<#${c}>`).join(', ') : '*Aucun*')], ephemeral: true });
    }

    if (sub === 'statut') {
      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('🛡️ Anti-Arnaque — Configuration')
        .addFields(
          { name: 'État', value: cfg.enabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
          { name: 'Salon d\'alerte', value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : '*Non défini*', inline: true },
          { name: 'Seuil', value: `${cfg.threshold}%`, inline: true },
          { name: 'Action', value: ACTION_LABELS[cfg.action], inline: true },
          { name: 'Suppression message', value: cfg.deleteMessage ? 'Oui' : 'Non', inline: true },
          { name: 'Durée mute', value: cfg.action === 'mute' ? `${cfg.muteDuration} min` : '—', inline: true },
          { name: 'Catégories', value: `Crypto: ${cfg.detectCrypto ? '✅' : '❌'} · Urgence: ${cfg.detectUrgency ? '✅' : '❌'} · Usurpation: ${cfg.detectImpersonation ? '✅' : '❌'} · Financier: ${cfg.detectFinancial ? '✅' : '❌'}`, inline: false },
          { name: 'Mots-clés perso', value: cfg.customKeywords.length ? cfg.customKeywords.map((k) => `\`${k}\``).join(', ') : '*Aucun*', inline: false },
          { name: 'Rôles exemptés', value: cfg.exemptRoles.length ? cfg.exemptRoles.map((r) => `<@&${r}>`).join(', ') : '*Aucun*', inline: true },
          { name: 'Salons exemptés', value: cfg.exemptChannels.length ? cfg.exemptChannels.map((c) => `<#${c}>`).join(', ') : '*Aucun*', inline: true },
          { name: 'Statistiques', value: `${cfg.totalScanned} image(s) scannée(s) · ${cfg.totalDetected} détection(s)`, inline: false },
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
