const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { COLORS, errorEmbed, successEmbed } = require('../../utils/embeds');

// Stockage en mémoire des votes (userId → choix)
const pollVotes = new Map(); // pollId → Map(userId, choiceIndex)

const EMOJIS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

function buildPollEmbed(question, choices, votes, ended = false) {
  const totalVotes = [...votes.values()].length;

  const fields = choices.map((choice, i) => {
    const count = [...votes.values()].filter(v => v === i).length;
    const pct   = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    const bar   = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    return {
      name:   `${EMOJIS[i]} ${choice}`,
      value:  `\`${bar}\` **${count}** vote(s) (${pct}%)`,
      inline: false,
    };
  });

  return new EmbedBuilder()
    .setColor(ended ? COLORS.info : COLORS.primary)
    .setTitle(`📊 ${question}`)
    .addFields(...fields)
    .setFooter({ text: `${totalVotes} vote(s) au total${ended ? ' • Sondage terminé' : ''}` })
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('📊 Créer un sondage')
    .addStringOption(o => o.setName('question').setDescription('La question du sondage').setRequired(true).setMaxLength(200))
    .addStringOption(o => o.setName('choix').setDescription('Choix séparés par | ex: Oui|Non|Peut-être').setRequired(true).setMaxLength(500))
    .addIntegerOption(o => o.setName('durée').setDescription('Durée en minutes (0 = illimité)').setMinValue(0).setMaxValue(1440)),

  async execute(interaction, client) {
    const question = interaction.options.getString('question');
    const rawChoix = interaction.options.getString('choix');
    const durée    = interaction.options.getInteger('durée') ?? 0;
    const choices  = rawChoix.split('|').map(c => c.trim()).filter(Boolean).slice(0, 10);

    if (choices.length < 2) {
      return interaction.reply({ embeds: [errorEmbed('Choix insuffisants', 'Séparez au moins 2 choix avec `|`. Ex: `Oui|Non`')], ephemeral: true });
    }

    const pollId = `poll_${Date.now()}_${interaction.user.id}`;
    const votes  = new Map();
    pollVotes.set(pollId, votes);

    const embed = buildPollEmbed(question, choices, votes);
    const rows  = [];
    const row   = new ActionRowBuilder();

    choices.forEach((_, i) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${pollId}_vote_${i}`)
          .setLabel(EMOJIS[i])
          .setStyle(ButtonStyle.Secondary)
      );
      if ((i + 1) % 5 === 0 || i === choices.length - 1) {
        rows.push(row.toJSON ? new ActionRowBuilder().addComponents([...row.components]) : row);
        row.components = [];
      }
    });

    // Bouton terminer (uniquement pour l'auteur)
    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${pollId}_end`).setLabel('🏁 Terminer').setStyle(ButtonStyle.Danger),
    );

    const msg = await interaction.reply({ embeds: [embed], components: [...rows, closeRow], fetchReply: true });

    // Auto-terminer si durée définie
    if (durée > 0) {
      setTimeout(async () => {
        const finalVotes = pollVotes.get(pollId) || new Map();
        const finalEmbed = buildPollEmbed(question, choices, finalVotes, true);
        await msg.edit({ embeds: [finalEmbed], components: [] }).catch(() => {});
        pollVotes.delete(pollId);
      }, durée * 60 * 1000);
    }
  },

  // ── Votes et fin du sondage (géré dans interactionCreate) ────────────────
  async handlePollInteraction(interaction, pollId, type, choiceIndex) {
    const votes = pollVotes.get(pollId);
    if (!votes) return interaction.reply({ embeds: [errorEmbed('Sondage expiré', 'Ce sondage n\'existe plus en mémoire.')], ephemeral: true });

    // Extraire les données du message original
    const embed    = interaction.message.embeds[0];
    const question = embed.title.replace('📊 ', '');
    const choices  = embed.fields.map(f => f.name.replace(/^[^\s]+ /, ''));

    if (type === 'end') {
      if (interaction.user.id !== interaction.message.interaction?.user?.id && !interaction.member.permissions.has('ManageMessages')) {
        return interaction.reply({ embeds: [errorEmbed('Accès refusé', 'Seul l\'auteur du sondage peut le terminer.')], ephemeral: true });
      }
      const finalEmbed = buildPollEmbed(question, choices, votes, true);
      pollVotes.delete(pollId);
      return interaction.update({ embeds: [finalEmbed], components: [] });
    }

    if (type === 'vote') {
      const userId  = interaction.user.id;
      const prevote = votes.get(userId);

      if (prevote === choiceIndex) {
        votes.delete(userId); // Retirer son vote
      } else {
        votes.set(userId, choiceIndex);
      }

      const updatedEmbed = buildPollEmbed(question, choices, votes);
      await interaction.update({ embeds: [updatedEmbed] });

      const label = prevote === choiceIndex
        ? 'Vote retiré'
        : `Vote enregistré: ${EMOJIS[choiceIndex]} ${choices[choiceIndex]}`;
      return interaction.followUp({ embeds: [successEmbed(label, '')], ephemeral: true });
    }
  },

  pollVotes,
};
