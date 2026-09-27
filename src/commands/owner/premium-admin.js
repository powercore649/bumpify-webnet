// commands/premium-admin.js — Réservé au(x) propriétaire(s) du bot (OWNER_IDS dans .env)
// Active/désactive le Premium gratuitement sur n'importe quel serveur. Aucun paiement.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Premium = require('../../models/Premium');
const { invalidateCache } = require('../../utils/premium');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');

function getOwnerIds() {
  return (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
}

function isOwner(userId) {
  return getOwnerIds().includes(userId);
}

module.exports = {
  isOwner,

  data: new SlashCommandBuilder()
    .setName('premium-admin')
    .setDescription('🔑 [Propriétaire uniquement] Gérer le Premium d\'un serveur')
    .addSubcommand(s => s.setName('activer').setDescription('Activer le Premium sur un serveur')
      .addStringOption(o => o.setName('serveur_id').setDescription('ID du serveur').setRequired(true))
      .addStringOption(o => o.setName('tier').setDescription('Niveau').addChoices({ name: 'Standard', value: 'standard' }, { name: 'Plus', value: 'plus' }))
      .addIntegerOption(o => o.setName('jours').setDescription('Durée en jours (vide = illimité)').setMinValue(1))
      .addStringOption(o => o.setName('raison').setDescription('Note (ex: partenaire, beta testeur)')))
    .addSubcommand(s => s.setName('désactiver').setDescription('Désactiver le Premium sur un serveur')
      .addStringOption(o => o.setName('serveur_id').setDescription('ID du serveur').setRequired(true)))
    .addSubcommand(s => s.setName('liste').setDescription('Voir tous les serveurs Premium'))
    .addSubcommand(s => s.setName('info').setDescription('Voir le statut Premium d\'un serveur')
      .addStringOption(o => o.setName('serveur_id').setDescription('ID du serveur').setRequired(true))),

  async execute(interaction, client) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ embeds: [errorEmbed('Accès refusé', 'Cette commande est réservée au(x) propriétaire(s) du bot.')], ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'activer') {
      const guildId = interaction.options.getString('serveur_id');
      const tier    = interaction.options.getString('tier') || 'standard';
      const jours   = interaction.options.getInteger('jours');
      const raison  = interaction.options.getString('raison') || '';
      const expiresAt = jours ? new Date(Date.now() + jours * 86400000) : null;

      const guild = await client.guilds.fetch(guildId).catch(() => null);

      await Premium.findOneAndUpdate(
        { guildId },
        { active: true, grantedBy: interaction.user.id, grantedAt: new Date(), expiresAt, reason: raison, tier },
        { upsert: true }
      );
      invalidateCache(guildId);

      return interaction.reply({ embeds: [successEmbed('✅ Premium activé',
        `Serveur : **${guild?.name || guildId}**\nTier : **${tier}**\nDurée : ${expiresAt ? `<t:${Math.floor(expiresAt.getTime()/1000)}:R>` : '**Illimitée**'}\nRaison : ${raison || '*Aucune*'}`)], ephemeral: true });
    }

    if (sub === 'désactiver') {
      const guildId = interaction.options.getString('serveur_id');
      await Premium.findOneAndUpdate({ guildId }, { active: false });
      invalidateCache(guildId);
      return interaction.reply({ embeds: [successEmbed('✅ Premium désactivé', `Serveur : \`${guildId}\``)], ephemeral: true });
    }

    if (sub === 'liste') {
      const all = await Premium.find({ active: true });
      if (!all.length) return interaction.reply({ embeds: [errorEmbed('Aucun', 'Aucun serveur Premium actif.')], ephemeral: true });

      const lines = await Promise.all(all.map(async p => {
        const g = await client.guilds.fetch(p.guildId).catch(() => null);
        const exp = p.expiresAt ? `expire <t:${Math.floor(new Date(p.expiresAt).getTime()/1000)}:R>` : 'illimité';
        return `**${g?.name || p.guildId}** — ${p.tier} — ${exp}`;
      }));

      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle(`🔑 Serveurs Premium (${all.length})`).setDescription(lines.join('\n'))], ephemeral: true });
    }

    if (sub === 'info') {
      const guildId = interaction.options.getString('serveur_id');
      const p = await Premium.findOne({ guildId });
      const g = await client.guilds.fetch(guildId).catch(() => null);
      if (!p) return interaction.reply({ embeds: [errorEmbed('Non premium', `**${g?.name || guildId}** n'a jamais eu de Premium.`)], ephemeral: true });

      return interaction.reply({ embeds: [new EmbedBuilder().setColor(p.active ? COLORS.success : COLORS.error)
        .setTitle(`🔑 ${g?.name || guildId}`)
        .addFields(
          { name: 'Statut', value: p.active ? '🟢 Actif' : '🔴 Inactif', inline: true },
          { name: 'Tier', value: p.tier, inline: true },
          { name: 'Expire', value: p.expiresAt ? `<t:${Math.floor(new Date(p.expiresAt).getTime()/1000)}:R>` : 'Illimité', inline: true },
          { name: 'Activé par', value: p.grantedBy ? `<@${p.grantedBy}>` : '—', inline: true },
          { name: 'Raison', value: p.reason || '*Aucune*' },
        )], ephemeral: true });
    }
  },
};
