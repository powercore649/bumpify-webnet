const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { COLORS, errorEmbed } = require('../../utils/embeds');
const Invite = require('../../models/Invite');
const fetch = require('node-fetch'); // pour QuickChart

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invites-avance')
    .setDescription('🔗 Voir les invitations du serveur et qui les a crées')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const guildInvites = await interaction.guild.invites.fetch();
      const dbInvites = await Invite.find({ guildId: interaction.guildId });

      let description = '';
      const labels = [];
      const values = [];

      for (const [code, inv] of guildInvites) {
        const dbInv = dbInvites.find(i => i.code === code);
        const creator = dbInv ? dbInv.createdByTag : 'Inconnu';
        const uses = inv.uses || 0;

        labels.push(code);
        values.push(uses);

        // QUI A ÉTÉ INVITÉ PAR QUI
        let invitedList = '*Aucun membre invité*';
        if (dbInv?.joinedUsers?.length > 0) {
          invitedList = dbInv.joinedUsers
            .map(u => `• ${u.tag}`)
            .join('\n');
        }

        description += `**${code}** → ${creator} (${uses} uses)\n` +
                       `Invités :\n${invitedList}\n\n`;
      }

      // GRAPHIQUE
      const chartConfig = {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Utilisations des invitations',
              data: values,
              backgroundColor: '#5865F2',
              borderColor: '#4752C4',
              borderWidth: 2,
              borderRadius: 6
            }
          ]
        },
        options: {
          plugins: {
            legend: { display: false },
            title: {
              display: true,
              text: 'Statistiques des invitations',
              color: '#ffffff',
              font: { size: 18 }
            }
          },
          scales: {
            x: { ticks: { color: '#ffffff' } },
            y: { ticks: { color: '#ffffff' }, beginAtZero: true }
          }
        }
      };

      const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('🔗 Invitations du serveur')
        .setDescription(description || '*Aucune invitation*')
        .setImage(chartUrl)
        .setTimestamp();

      interaction.editReply({ embeds: [embed] });

    } catch (err) {
      interaction.editReply({
        embeds: [errorEmbed('Erreur', 'Impossible de récupérer les invitations.')]
      });
    }
  },
};
