const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const InviteUse = require('../../models/InviteUse');
const InviteConfig = require('../../models/InviteConfig');
const { COLORS, errorEmbed, successEmbed } = require('../../utils/embeds');

/**
 * Calcule les stats agrégées d'un inviteur sur un serveur donné.
 */
async function computeStats(guildId, inviterId) {
  const [joins, leaves, fakes] = await Promise.all([
    InviteUse.countDocuments({ guildId, inviterId }),
    InviteUse.countDocuments({ guildId, inviterId, left: true }),
    InviteUse.countDocuments({ guildId, inviterId, fake: true }),
  ]);
  const active = await InviteUse.countDocuments({ guildId, inviterId, left: false, fake: false });
  return { joins, leaves, fakes, active };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('🔗 Statistiques avancées du système d\'invitations')
    .addSubcommand(s => s.setName('voir')
      .setDescription('Voir les statistiques d\'invitation d\'un membre')
      .addUserOption(o => o.setName('membre').setDescription('Membre à consulter (par défaut: vous)')))
    .addSubcommand(s => s.setName('classement')
      .setDescription('Voir le classement des meilleurs inviteurs du serveur')
      .addIntegerOption(o => o.setName('page').setDescription('Numéro de page').setMinValue(1)))
    .addSubcommand(s => s.setName('invites-par')
      .setDescription('Lister les membres invités par une personne précise')
      .addUserOption(o => o.setName('membre').setDescription('L\'inviteur').setRequired(true)))
    .addSubcommand(s => s.setName('bonus')
      .setDescription('Ajouter/retirer manuellement des invitations bonus à un membre')
      .addUserOption(o => o.setName('membre').setDescription('Membre concerné').setRequired(true))
      .addIntegerOption(o => o.setName('montant').setDescription('Nombre à ajouter (négatif pour retirer)').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'voir') {
      await interaction.deferReply();
      const target = interaction.options.getUser('membre') || interaction.user;
      const stats = await computeStats(guildId, target.id);

      // Qui a invité ce membre ?
      const ownRecord = await InviteUse.findOne({ guildId, userId: target.id }).sort({ joinedAt: -1 });

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`🔗 Statistiques d'invitation — ${target.tag}`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: '✅ Invitations actives', value: `**${stats.active}**`, inline: true },
          { name: '📥 Total invités', value: `${stats.joins}`, inline: true },
          { name: '📤 Repartis', value: `${stats.leaves}`, inline: true },
          { name: '⚠️ Fake (compte trop récent)', value: `${stats.fakes}`, inline: true },
        )
        .setTimestamp();

      if (ownRecord) {
        embed.addFields({
          name: '🎟️ Invité par',
          value: ownRecord.inviterId ? `<@${ownRecord.inviterId}> (\`${ownRecord.code || 'inconnu'}\`)` : `Inconnu`,
          inline: false,
        });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'classement') {
      await interaction.deferReply();
      const page = interaction.options.getInteger('page') || 1;
      const perPage = 10;

      // Agrégation MongoDB : invitations actives (non-left, non-fake) groupées par inviteur
      const agg = await InviteUse.aggregate([
        { $match: { guildId, left: false, fake: false, inviterId: { $ne: null } } },
        { $group: { _id: '$inviterId', total: { $sum: 1 }, tag: { $first: '$inviterTag' } } },
        { $sort: { total: -1 } },
      ]);

      if (!agg.length) {
        return interaction.editReply({ embeds: [errorEmbed('Aucune donnée', 'Aucune invitation n\'a encore été trackée sur ce serveur.')] });
      }

      const totalPages = Math.ceil(agg.length / perPage);
      const clampedPage = Math.min(page, totalPages);
      const slice = agg.slice((clampedPage - 1) * perPage, clampedPage * perPage);

      const medals = ['🥇', '🥈', '🥉'];
      const lines = slice.map((entry, i) => {
        const rank = (clampedPage - 1) * perPage + i;
        const medal = medals[rank] || `**#${rank + 1}**`;
        return `${medal} <@${entry._id}> — **${entry.total}** invitation(s)`;
      });

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`🏆 Classement des invitations — ${interaction.guild.name}`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `Page ${clampedPage}/${totalPages} · ${agg.length} inviteur(s) au total` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'invites-par') {
      await interaction.deferReply();
      const target = interaction.options.getUser('membre');
      const records = await InviteUse.find({ guildId, inviterId: target.id }).sort({ joinedAt: -1 }).limit(25);

      if (!records.length) {
        return interaction.editReply({ embeds: [errorEmbed('Aucune invitation', `${target.tag} n'a invité personne pour le moment.`)] });
      }

      const lines = records.map(r => {
        const status = r.fake ? '⚠️ fake' : r.left ? '📤 reparti' : '✅ actif';
        return `<@${r.userId}> — ${status} — <t:${Math.floor(new Date(r.joinedAt).getTime() / 1000)}:R>`;
      });

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`🔗 Invitations de ${target.tag}`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: records.length === 25 ? '25 dernières invitations affichées' : `${records.length} invitation(s) au total` })
        .setThumbnail(target.displayAvatarURL())
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'bonus') {
      // Vérification manuelle de permission (setDefaultMemberPermissions ne s'applique pas
      // au niveau sous-commande ; pattern déjà utilisé ailleurs dans le bot)
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Vous devez avoir la permission **Gérer le serveur** pour utiliser cette commande.')], ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      const target = interaction.options.getUser('membre');
      const montant = interaction.options.getInteger('montant');

      // Les invitations bonus sont représentées par des entrées InviteUse synthétiques
      // (inviterId = target, userId = un identifiant unique fictif, method = 'unknown', code = 'BONUS')
      // afin de s'intégrer nativement au comptage/classement existant.
      if (montant > 0) {
        const docs = Array.from({ length: montant }, (_, i) => ({
          guildId,
          userId: `bonus-${target.id}-${Date.now()}-${i}`,
          userTag: 'Bonus manuel',
          inviterId: target.id,
          inviterTag: target.tag,
          code: 'BONUS',
          method: 'unknown',
          fake: false,
          left: false,
        }));
        await InviteUse.insertMany(docs);
      } else if (montant < 0) {
        const toRemove = await InviteUse.find({ guildId, inviterId: target.id, left: false, fake: false })
          .sort({ joinedAt: -1 }).limit(Math.abs(montant));
        if (toRemove.length) {
          await InviteUse.deleteMany({ _id: { $in: toRemove.map(d => d._id) } });
        }
      }

      const stats = await computeStats(guildId, target.id);
      return interaction.editReply({ embeds: [successEmbed('Bonus appliqué', `${target} a maintenant **${stats.active}** invitation(s) active(s).`)] });
    }
  },
};
