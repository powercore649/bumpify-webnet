// commands/owner/license-admin.js — [Propriétaire uniquement] Gestion des clés de licence.
// Une clé de licence débloque les systèmes phares (bump, inter-serveur, etc.)
// sur UN serveur. L'owner génère la clé, le serveur l'active via /license activer.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const licenseGate = require('../../utils/licenseGate');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');

function keyPreview(key) {
  // Masque la clé en affichage public : BUMP-XXXX-…-XXXX
  const parts = String(key).split('-');
  return `${parts[0]}-${parts[1]}-••••-••••-${parts[4]}`;
}

function licenseLine(l) {
  const statut = l.revoked ? '🔴 Révoquée'
    : (l.expiresAt && new Date(l.expiresAt) < new Date()) ? '🟠 Expirée'
    : l.guildId ? '🟢 Active'
    : '⚪ Non activée';
  const serveur = l.guildId ? `**${l.guildName || l.guildId}**` : '—';
  const exp = l.expiresAt ? `expire <t:${Math.floor(new Date(l.expiresAt).getTime() / 1000)}:R>` : 'illimitée';
  return `${statut} — \`${keyPreview(l.key)}\` → ${serveur} (${exp})`;
}

module.exports = {
  isOwner: licenseGate.isOwner,

  data: new SlashCommandBuilder()
    .setName('license-admin')
    .setDescription('🔑 [Propriétaire uniquement] Générer et gérer les clés de licence')
    .addSubcommand(s => s.setName('generer').setDescription('Générer une nouvelle clé de licence')
      .addIntegerOption(o => o.setName('jours').setDescription('Durée de validité en jours (vide = illimitée)').setMinValue(1).setMaxValue(3650))
      .addStringOption(o => o.setName('note').setDescription('Note libre (ex: client #42)').setMaxLength(200)))
    .addSubcommand(s => s.setName('liste').setDescription('Voir toutes les clés de licence')
      .addStringOption(o => o.setName('filtre').setDescription('Filtrer les clés affichées').addChoices(
        { name: 'Toutes', value: 'all' },
        { name: 'Actives (liées à un serveur)', value: 'linked' },
        { name: 'Non activées', value: 'unused' },
        { name: 'Révoquées', value: 'revoked' },
      )))
    .addSubcommand(s => s.setName('info').setDescription('Détails d\'une clé (clé complète visible)')
      .addStringOption(o => o.setName('cle').setDescription('Clé complète (BUMP-…) ou ID du serveur').setRequired(true)))
    .addSubcommand(s => s.setName('revoquer').setDescription('Révoquer une clé (les features se reverrouillent immédiatement)')
      .addStringOption(o => o.setName('cle').setDescription('Clé complète (BUMP-…)').setRequired(true))
      .addStringOption(o => o.setName('raison').setDescription('Motif de la révocation').setMaxLength(200)))
    .addSubcommand(s => s.setName('delier').setDescription('Délier la licence d\'un serveur SANS révoquer la clé (réutilisable)')
      .addStringOption(o => o.setName('serveur_id').setDescription('ID du serveur').setRequired(true))),

  async execute(interaction, client) {
    if (!licenseGate.isOwner(interaction.user.id)) {
      return interaction.reply({ embeds: [errorEmbed('Accès refusé', 'Cette commande est réservée au(x) propriétaire(s) du bot.')], ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    // ── générer ─────────────────────────────────────────────────────────────
    if (sub === 'generer') {
      const jours = interaction.options.getInteger('jours');
      const note = interaction.options.getString('note') || '';
      await interaction.deferReply({ ephemeral: true });
      const license = await licenseGate.createLicense(interaction.user.id, { jours, note });

      const embed = new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('🔑 Clé de licence générée')
        .setDescription(`Transmettez cette clé à l'administrateur du serveur concerné. Il l'activera avec :\n\`/license activer cle:\`${license.key}\``)
        .addFields(
          { name: '🗝️ Clé', value: `\`${license.key}\`` },
          { name: '⏳ Validité', value: license.expiresAt ? `<t:${Math.floor(license.expiresAt.getTime() / 1000)}:R> (${jours} jours)` : 'Illimitée', inline: true },
          { name: '📝 Note', value: note || '*Aucune*', inline: true },
        )
        .setFooter({ text: 'Une clé = un serveur. Révocation : /license-admin revoquer' });
      return interaction.editReply({ embeds: [embed] });
    }

    // ── liste ───────────────────────────────────────────────────────────────
    if (sub === 'liste') {
      const filtre = interaction.options.getString('filtre') || 'all';
      let filter = {};
      if (filtre === 'linked') filter = { guildId: { $ne: null }, revoked: false };
      if (filtre === 'unused') filter = { guildId: null, revoked: false };
      if (filtre === 'revoked') filter = { revoked: true };

      const all = await licenseGate.listLicenses(filter);
      if (!all.length) {
        return interaction.reply({ embeds: [errorEmbed('Aucune clé', 'Aucune clé ne correspond à ce filtre.')], ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`🔑 Clés de licence (${all.length})`)
        .setDescription(all.slice(0, 25).map(licenseLine).join('\n'));
      if (all.length > 25) embed.setFooter({ text: `+ ${all.length - 25} autre(s) — affinez avec l'option filtre` });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── info ────────────────────────────────────────────────────────────────
    if (sub === 'info') {
      const q = interaction.options.getString('cle').trim();
      const license = await (q.startsWith('BUMP-')
        ? require('../../models/License').findOne({ key: q.toUpperCase() }).lean()
        : require('../../models/License').findOne({ guildId: q }).lean());
      if (!license) {
        return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Aucune clé ne correspond (clé complète `BUMP-…` ou ID de serveur).')], ephemeral: true });
      }

      const statut = license.revoked ? '🔴 Révoquée'
        : (license.expiresAt && new Date(license.expiresAt) < new Date()) ? '🟠 Expirée'
        : license.guildId ? '🟢 Active' : '⚪ Non activée';
      const embed = new EmbedBuilder()
        .setColor(license.revoked ? COLORS.error : COLORS.success)
        .setTitle(`🔑 ${keyPreview(license.key)} — ${statut}`)
        .addFields(
          { name: '🗝️ Clé complète', value: `\`${license.key}\`` },
          { name: 'Serveur', value: license.guildId ? `**${license.guildName || license.guildId}**\n(\`${license.guildId}\`)` : '—', inline: true },
          { name: 'Statut', value: statut, inline: true },
          { name: 'Validité', value: license.expiresAt ? `<t:${Math.floor(new Date(license.expiresAt).getTime() / 1000)}:R>` : 'Illimitée', inline: true },
          { name: 'Générée par', value: `<@${license.createdBy}>`, inline: true },
          { name: 'Générée le', value: `<t:${Math.floor(new Date(license.createdAt).getTime() / 1000)}:f>`, inline: true },
          { name: 'Activée par', value: license.activatedBy ? `<@${license.activatedBy}>` : '—', inline: true },
          { name: 'Activée le', value: license.activatedAt ? `<t:${Math.floor(new Date(license.activatedAt).getTime() / 1000)}:f>` : '—', inline: true },
          ...(license.revoked ? [{ name: 'Révocation', value: `Par <@${license.revokedBy || '?'}> — ${license.revokedReason || '*sans motif*'}` }] : []),
          { name: 'Note', value: license.note || '*Aucune*' },
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── revoquer ────────────────────────────────────────────────────────────
    if (sub === 'revoquer') {
      const key = interaction.options.getString('cle');
      const raison = interaction.options.getString('raison') || '';
      const res = await licenseGate.revokeLicense(key, interaction.user.id, raison);
      if (!res.ok) {
        return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Aucune clé ne correspond.')], ephemeral: true });
      }
      const where = res.affectedGuild ? `Les features licenciées de <@${res.affectedGuild}> sont **déjà reverrouillées**.` : 'La clé n\'était liée à aucun serveur.';
      return interaction.reply({ embeds: [successEmbed('Clé révoquée', `\`${keyPreview(res.license.key)}\` révoquée.\n${where}`)], ephemeral: true });
    }

    // ── delier ──────────────────────────────────────────────────────────────
    if (sub === 'delier') {
      const guildId = interaction.options.getString('serveur_id');
      const license = await require('../../models/License').findOne({ guildId }).lean();
      await licenseGate.unlinkGuild(guildId);
      if (!license) {
        return interaction.reply({ embeds: [errorEmbed('Aucune licence', 'Ce serveur n\'a aucune licence liée.')], ephemeral: true });
      }
      return interaction.reply({ embeds: [successEmbed('Licence déliée', `La clé \`${keyPreview(license.key)}\` est détachée de \`${guildId}\`.\nElle reste **valable** et réutilisable sur un autre serveur.`)], ephemeral: true });
    }
  },
};
