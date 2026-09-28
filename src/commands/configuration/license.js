// commands/configuration/license.js — Activation de la licence par le serveur.
// L'owner du bot génère une clé (/license-admin générer). L'administrateur du
// serveur l'active ici : /license activer cle:BUMP-XXXX-XXXX-XXXX-XXXX.
// La licence débloque les systèmes phares : bump, inter-serveur, territoires…
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const License = require('../../models/License');
const licenseGate = require('../../utils/licenseGate');
const { COLORS, successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');

function fmtDate(d) {
  return d ? `<t:${Math.floor(new Date(d).getTime() / 1000)}:R>` : '—';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('license')
    .setDescription('🔑 Activer et gérer la licence de ce serveur')
    .setDefaultMemberPermissions('8') // Administrateur
    .setDMPermission(false)
    .addSubcommand(s => s.setName('activer').setDescription('Activer une clé de licence sur ce serveur')
      .addStringOption(o => o.setName('cle').setDescription('Clé reçue de l\'owner (format BUMP-XXXX-XXXX-XXXX-XXXX)').setRequired(true)))
    .addSubcommand(s => s.setName('statut').setDescription('Voir la licence actuelle de ce serveur et ce qu\'elle débloque'))
    .addSubcommand(s => s.setName('desactiver').setDescription('Désactiver la licence de ce serveur (la clé reste réutilisable)')),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    // ── activer ─────────────────────────────────────────────────────────────
    if (sub === 'activer') {
      const rawKey = interaction.options.getString('cle');
      const res = await licenseGate.activateLicense(rawKey, guild.id, guild.name, interaction.user.id);

      if (!res.ok) {
        const messages = {
          not_found: 'Cette clé n\'existe pas. Vérifiez la saisie (format `BUMP-XXXX-XXXX-XXXX-XXXX`, majuscules).',
          revoked: 'Cette clé a été **révoquée** par l\'owner du bot. Demandez-en une nouvelle.',
          expired: 'Cette clé a **expiré**. Demandez une nouvelle clé à l\'owner du bot.',
          used_elsewhere: 'Cette clé est déjà activée sur un autre serveur — **une clé ne fonctionne que sur un seul serveur**.',
        };
        return interaction.reply({ embeds: [errorEmbed('Activation impossible', messages[res.reason] || 'Erreur inconnue.')], ephemeral: true });
      }

      const license = res.license;
      const wasAlreadyLinked = license.activatedAt && Date.now() - new Date(license.activatedAt).getTime() < 5000 ? false : true;

      const embed = new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('🎉 Licence activée !')
        .setDescription(
          `Le serveur **${guild.name}** dispose maintenant du **système complet** Bumpify :\n`
          + `${licenseGate.LICENSE_REQUIRED_COMMANDS.map(c => `• \`/${c}\``).join('\n')}`,
        )
        .addFields(
          { name: '⏳ Validité', value: license.expiresAt ? `Expire ${fmtDate(license.expiresAt)}` : 'Illimitée', inline: true },
          { name: '🔁 Remplacement', value: wasAlreadyLinked ? 'L\'ancienne clé de ce serveur a été déliée (réutilisable).' : 'Première activation sur ce serveur.', inline: true },
        )
        .setFooter({ text: 'Bumpify • Licences' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── statut ──────────────────────────────────────────────────────────────
    if (sub === 'statut') {
      const { status, license } = await licenseGate.getLicenseStatus(guild.id);

      const lockedList = licenseGate.LICENSE_REQUIRED_COMMANDS.map(c => `\`/${c}\``).join(', ');
      const unlockedList = licenseGate.LICENSE_REQUIRED_COMMANDS.map(c => `✅ \`/${c}\``).join('\n');

      if (status === 'active') {
        const embed = new EmbedBuilder()
          .setColor(COLORS.success)
          .setTitle('🔓 Licence active')
          .setDescription(`Ce serveur dispose du **système complet** : ${unlockedList}`)
          .addFields(
            { name: '⏳ Validité', value: license.expiresAt ? `Expire ${fmtDate(license.expiresAt)}` : 'Illimitée', inline: true },
            { name: '🗝️ Clé', value: `\`${license.key.split('-').slice(0, 2).join('-')}-••••-••••-••••\``, inline: true },
            { name: '📅 Activée', value: fmtDate(license.activatedAt), inline: true },
          );
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      const labels = {
        none: 'Aucune licence sur ce serveur.',
        expired: 'La licence de ce serveur a **expiré**.',
        revoked: 'La licence de ce serveur a été **révoquée** par l\'owner.',
      };
      const embed = new EmbedBuilder()
        .setColor(status === 'none' ? COLORS.info : COLORS.error)
        .setTitle(status === 'none' ? '🔒 Serveur sans licence' : '⛔ Licence inactive')
        .setDescription(`${labels[status]}\n\n**Verrouillé :** ${lockedList}\n\nDemandez une clé à l'owner du bot puis activez-la avec :\n\`/license activer cle:BUMP-XXXX-XXXX-XXXX-XXXX\`\n\n*Le reste du bot (modération, XP, économie, bienvenue…) reste accessible.*`);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── desactiver ──────────────────────────────────────────────────────────
    if (sub === 'desactiver') {
      const license = await License.findOne({ guildId: guild.id }).lean();
      if (!license) {
        return interaction.reply({ embeds: [infoEmbed('Aucune licence', 'Ce serveur n\'a pas de licence activée.')], ephemeral: true });
      }
      await licenseGate.unlinkGuild(guild.id);
      const masked = `\`${license.key.split('-').slice(0, 2).join('-')}-••••-••••-••••\``;
      return interaction.reply({
        embeds: [successEmbed('Licence désactivée', `La clé ${masked} est détachée de ce serveur.\nLes systèmes licenciés sont reverrouillés. La clé reste **valable** et réutilisable.`)],
        ephemeral: true,
      });
    }
  },
};
