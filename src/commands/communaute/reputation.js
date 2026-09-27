// commands/reputation.js — Réputation entre membres (système de points donnés par les membres)
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const Reputation = require('../../models/Reputation');
const ReputationConfig = require('../../models/ReputationConfig');
const { COLORS, errorEmbed, successEmbed } = require('../../utils/embeds');
const { getAppEmoji } = require('../../utils/emojiSync');

async function getOrCreateConfig(guildId) {
  let cfg = await ReputationConfig.findOne({ guildId });
  if (!cfg) cfg = await ReputationConfig.create({ guildId });
  return cfg;
}

const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reputation')
    .setDescription('⭐ Système de réputation entre membres')
    .addSubcommand(s => s.setName('donner').setDescription('Donner un point de réputation à un membre')
      .addUserOption(o => o.setName('membre').setDescription('Membre à qui donner un point').setRequired(true)))
    .addSubcommand(s => s.setName('voir').setDescription('Voir le score de réputation d\'un membre')
      .addUserOption(o => o.setName('membre').setDescription('Membre (vous par défaut)')))
    .addSubcommand(s => s.setName('classement').setDescription('Classement de réputation du serveur'))
    .addSubcommand(s => s.setName('config').setDescription('Configurer le système de réputation *(Admin)*')
      .addBooleanOption(o => o.setName('activer').setDescription('Activer/désactiver'))
      .addIntegerOption(o => o.setName('cooldown_heures').setDescription('Délai entre deux dons au même membre (heures)').setMinValue(1))
      .addChannelOption(o => o.setName('salon').setDescription('Restreindre à un salon (laisser vide pour autoriser partout)'))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = await getOrCreateConfig(interaction.guildId);

    // ── config (Admin) ───────────────────────────────────────────────────
    if (sub === 'config') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Vous devez avoir la permission "Gérer le serveur".')], ephemeral: true });
      }
      const activer = interaction.options.getBoolean('activer');
      const cooldown = interaction.options.getInteger('cooldown_heures');
      const salon = interaction.options.getChannel('salon');

      if (activer !== null) cfg.enabled = activer;
      if (cooldown !== null) cfg.cooldownHours = cooldown;
      if (salon) cfg.channelId = salon.id;

      await cfg.save();
      return interaction.reply({ embeds: [successEmbed('Configuration mise à jour',
        `Statut : **${cfg.enabled ? 'Activé' : 'Désactivé'}**\nCooldown : **${cfg.cooldownHours}h**\nSalon : ${cfg.channelId ? `<#${cfg.channelId}>` : '*Partout*'}`)], ephemeral: true });
    }

    if (!cfg.enabled) {
      return interaction.reply({ embeds: [errorEmbed('Système désactivé', 'Le système de réputation est désactivé sur ce serveur.')], ephemeral: true });
    }

    if (cfg.channelId && interaction.channelId !== cfg.channelId) {
      return interaction.reply({ embeds: [errorEmbed('Salon non autorisé', `Cette commande est restreinte au salon <#${cfg.channelId}>.`)], ephemeral: true });
    }

    // ── donner ────────────────────────────────────────────────────────────
    if (sub === 'donner') {
      const target = interaction.options.getUser('membre');

      if (target.id === interaction.user.id) {
        return interaction.reply({ embeds: [errorEmbed('Action impossible', 'Vous ne pouvez pas vous donner un point à vous-même.')], ephemeral: true });
      }
      if (target.bot) {
        return interaction.reply({ embeds: [errorEmbed('Action impossible', 'Vous ne pouvez pas donner de réputation à un bot.')], ephemeral: true });
      }

      let entry = await Reputation.findOne({ guildId: interaction.guildId, userId: target.id });
      if (!entry) entry = new Reputation({ guildId: interaction.guildId, userId: target.id });

      const cooldownMs = cfg.cooldownHours * 60 * 60 * 1000;
      const lastGiven = entry.givenBy.find(g => g.userId === interaction.user.id);
      if (lastGiven && Date.now() - new Date(lastGiven.date).getTime() < cooldownMs) {
        const nextAt = new Date(new Date(lastGiven.date).getTime() + cooldownMs);
        return interaction.reply({ embeds: [errorEmbed('Cooldown actif', `Vous devez attendre <t:${Math.floor(nextAt.getTime() / 1000)}:R> avant de redonner un point à ${target.username}.`)], ephemeral: true });
      }

      entry.points += 1;
      entry.givenBy = entry.givenBy.filter(g => g.userId !== interaction.user.id);
      entry.givenBy.push({ userId: interaction.user.id, date: new Date() });
      await entry.save();

      const eStarGive = getAppEmoji(interaction.client, 'bumpify_star') || '⭐';
      return interaction.reply({ embeds: [successEmbed('Point de réputation donné', `${eStarGive} Vous avez donné un point de réputation à **${target.username}** !\nNouveau score : **${entry.points}** point(s).`)] });
    }

    // ── voir ──────────────────────────────────────────────────────────────
    if (sub === 'voir') {
      const target = interaction.options.getUser('membre') || interaction.user;
      const entry = await Reputation.findOne({ guildId: interaction.guildId, userId: target.id });
      const points = entry?.points || 0;

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`${getAppEmoji(interaction.client, 'bumpify_star') || '⭐'} Réputation de ${target.username}`)
        .setThumbnail(target.displayAvatarURL())
        .addFields({ name: 'Points de réputation', value: `**${points}**` })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // ── classement ────────────────────────────────────────────────────────
    if (sub === 'classement') {
      await interaction.deferReply();
      const top = await Reputation.find({ guildId: interaction.guildId, points: { $gt: 0 } }).sort({ points: -1 }).limit(10);
      if (!top.length) {
        return interaction.editReply({ embeds: [errorEmbed('Vide', 'Personne n\'a encore de réputation sur ce serveur.')] });
      }

      let desc = '';
      for (const [i, e] of top.entries()) {
        let username = '*Inconnu*';
        try { username = (await interaction.client.users.fetch(e.userId)).username; } catch {}
        desc += `${medals[i]} **${username}** — ${e.points} point(s)\n`;
      }

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`${getAppEmoji(interaction.client, 'bumpify_star') || '⭐'} Classement de réputation — ${interaction.guild.name}`)
        .setDescription(desc)
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }
  },
};
