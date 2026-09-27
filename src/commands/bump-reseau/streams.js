// commands/streams.js — Gérer les streamers Twitch / chaînes YouTube suivis
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const WatchedStreamer = require('../../models/WatchedStreamer');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('streams')
    .setDescription('📺 Gérer les streamers Twitch / chaînes YouTube suivis')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s
      .setName('ajouter')
      .setDescription('Suivre un streamer/une chaîne')
      .addStringOption(o => o.setName('plateforme').setDescription('Twitch ou YouTube').setRequired(true)
        .addChoices({ name: 'Twitch', value: 'twitch' }, { name: 'YouTube', value: 'youtube' }))
      .addStringOption(o => o.setName('identifiant').setDescription('Login Twitch (ex: ninja) ou ID de chaîne YouTube (commence par UC...)').setRequired(true)))
    .addSubcommand(s => s
      .setName('retirer')
      .setDescription('Ne plus suivre un streamer/une chaîne')
      .addStringOption(o => o.setName('plateforme').setDescription('Twitch ou YouTube').setRequired(true)
        .addChoices({ name: 'Twitch', value: 'twitch' }, { name: 'YouTube', value: 'youtube' }))
      .addStringOption(o => o.setName('identifiant').setDescription('Login Twitch ou ID de chaîne YouTube').setRequired(true)))
    .addSubcommand(s => s.setName('liste').setDescription('Voir tous les streamers/chaînes suivis sur ce serveur')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'ajouter') {
      const platform = interaction.options.getString('plateforme');
      let identifier = interaction.options.getString('identifiant').trim();
      if (platform === 'twitch') identifier = identifier.toLowerCase().replace(/^@/, '');

      const exists = await WatchedStreamer.findOne({ guildId, platform, identifier });
      if (exists) {
        return interaction.reply({ embeds: [errorEmbed('Déjà suivi', `**${identifier}** est déjà suivi sur ce serveur.`)], ephemeral: true });
      }

      await WatchedStreamer.create({ guildId, platform, identifier, addedBy: interaction.user.id });

      const apiKeyMissing = platform === 'twitch'
        ? !(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET)
        : !process.env.YOUTUBE_API_KEY;

      const embed = successEmbed('Ajouté !', `**${identifier}** (${platform === 'twitch' ? 'Twitch' : 'YouTube'}) est maintenant suivi. Les abonnés au type "streams" du centre de notifications seront prévenus.`);
      if (apiKeyMissing) {
        embed.addFields({ name: '⚠️ Attention', value: `La clé API ${platform === 'twitch' ? 'Twitch' : 'YouTube'} n'est pas configurée côté bot — aucune détection n'aura lieu tant qu'elle ne l'est pas.` });
      }
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'retirer') {
      const platform = interaction.options.getString('plateforme');
      let identifier = interaction.options.getString('identifiant').trim();
      if (platform === 'twitch') identifier = identifier.toLowerCase().replace(/^@/, '');

      const deleted = await WatchedStreamer.findOneAndDelete({ guildId, platform, identifier });
      if (!deleted) {
        return interaction.reply({ embeds: [errorEmbed('Introuvable', `**${identifier}** n'est pas suivi sur ce serveur.`)], ephemeral: true });
      }
      return interaction.reply({ embeds: [successEmbed('Retiré', `**${identifier}** n'est plus suivi.`)], ephemeral: true });
    }

    if (sub === 'liste') {
      const docs = await WatchedStreamer.find({ guildId }).sort({ platform: 1, identifier: 1 });
      if (!docs.length) {
        return interaction.reply({ embeds: [errorEmbed('Aucun streamer suivi', 'Utilise `/streams ajouter` pour commencer.')], ephemeral: true });
      }

      const twitch = docs.filter(d => d.platform === 'twitch');
      const youtube = docs.filter(d => d.platform === 'youtube');

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('📺 Streamers / chaînes suivis')
        .addFields(
          { name: `🟣 Twitch (${twitch.length})`, value: twitch.length ? twitch.map(d => `${d.isLive ? '🔴' : '⚫'} ${d.displayName || d.identifier}`).join('\n') : '*Aucun*', inline: true },
          { name: `🔴 YouTube (${youtube.length})`, value: youtube.length ? youtube.map(d => `📹 ${d.displayName || d.identifier}`).join('\n') : '*Aucun*', inline: true },
        )
        .setFooter({ text: 'Les membres abonnés au type "streams" (/notifications) reçoivent un DM automatiquement.' });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
