// commands/status.js — [Propriétaire uniquement] Configurer le statut du bot
const { SlashCommandBuilder } = require('discord.js');
const BotStatus = require('../../models/BotStatus');
const { getBotStatus, applyBotStatus, DEFAULTS } = require('../../utils/botStatus');
const { errorEmbed, successEmbed, COLORS } = require('../../utils/embeds');
const { EmbedBuilder } = require('discord.js');

function getOwnerIds() {
  return (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
}
function isOwner(userId) {
  return getOwnerIds().includes(userId);
}

const TYPE_CHOICES = [
  { name: 'Statut personnalisé',  value: 'Custom' },
  { name: 'Joue à...',            value: 'Playing' },
  { name: 'Regarde...',           value: 'Watching' },
  { name: 'Écoute...',            value: 'Listening' },
  { name: 'En compétition sur...', value: 'Competing' },
  { name: 'Diffuse en direct...', value: 'Streaming' },
];

const PRESENCE_CHOICES = [
  { name: '🟢 En ligne',        value: 'online' },
  { name: '🌙 Inactif',         value: 'idle' },
  { name: '⛔ Ne pas déranger', value: 'dnd' },
  { name: '⚫ Invisible',       value: 'invisible' },
];

function buildStatusEmbed(cfg) {
  const typeLabel = TYPE_CHOICES.find(t => t.value === cfg.activityType)?.name || cfg.activityType;
  const presLabel = PRESENCE_CHOICES.find(p => p.value === cfg.presenceStatus)?.name || cfg.presenceStatus;
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🤖 Statut du bot')
    .addFields(
      { name: '🟢 Présence', value: presLabel, inline: true },
      { name: '🎭 Type', value: typeLabel, inline: true },
      { name: '📝 Texte', value: `\`${cfg.activityText}\``, inline: false },
      ...(cfg.activityType === 'Streaming' ? [{ name: '🔗 Lien du stream', value: cfg.streamUrl || '*Non défini*', inline: false }] : []),
    )
    .setFooter({ text: cfg.updatedBy ? `Dernière modification par ${cfg.updatedBy}` : 'Configuration par défaut' })
    .setTimestamp(cfg.updatedAt);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('🤖 [Propriétaire uniquement] Configurer le statut du bot')
    .addSubcommand(s => s
      .setName('definir')
      .setDescription('Définir le statut affiché par le bot')
      .addStringOption(o => o.setName('type').setDescription('Type d\'activité').setRequired(true).addChoices(...TYPE_CHOICES))
      .addStringOption(o => o.setName('texte').setDescription('Texte affiché après le type').setRequired(true).setMaxLength(128))
      .addStringOption(o => o.setName('presence').setDescription('Statut de présence (en ligne, inactif...)').addChoices(...PRESENCE_CHOICES))
      .addStringOption(o => o.setName('lien').setDescription('Lien Twitch/YouTube (uniquement pour "Diffuse en direct")')))
    .addSubcommand(s => s.setName('voir').setDescription('Voir le statut actuellement configuré'))
    .addSubcommand(s => s.setName('reinitialiser').setDescription('Revenir au statut par défaut')),

  async execute(interaction, client) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ embeds: [errorEmbed('Accès refusé', 'Cette commande est réservée au(x) propriétaire(s) du bot.')], ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'voir') {
      const cfg = await getBotStatus();
      return interaction.reply({ embeds: [buildStatusEmbed(cfg)], ephemeral: true });
    }

    if (sub === 'reinitialiser') {
      const cfg = await BotStatus.findOneAndUpdate(
        { key: 'main' },
        { ...DEFAULTS, updatedBy: interaction.user.tag, updatedAt: new Date() },
        { upsert: true, new: true },
      );
      await applyBotStatus(client);
      return interaction.reply({ embeds: [successEmbed('Statut réinitialisé', 'Le statut par défaut a été réappliqué.'), buildStatusEmbed(cfg)], ephemeral: true });
    }

    if (sub === 'definir') {
      const type   = interaction.options.getString('type');
      const texte  = interaction.options.getString('texte');
      const pres   = interaction.options.getString('presence');
      const lien   = interaction.options.getString('lien');

      if (type === 'Streaming') {
        const url = lien || (await getBotStatus()).streamUrl;
        if (!url || !/^https?:\/\/(www\.)?(twitch\.tv|youtube\.com)\//i.test(url)) {
          return interaction.reply({
            embeds: [errorEmbed('Lien requis', 'Pour le type "Diffuse en direct", fournis un lien Twitch (`twitch.tv/...`) ou YouTube (`youtube.com/...`) valide via l\'option `lien`.')],
            ephemeral: true,
          });
        }
      }

      const update = {
        activityType: type,
        activityText: texte,
        updatedBy:    interaction.user.tag,
        updatedAt:    new Date(),
      };
      if (pres) update.presenceStatus = pres;
      if (type === 'Streaming') update.streamUrl = lien || (await getBotStatus()).streamUrl;
      if (type !== 'Streaming') update.streamUrl = null;

      const cfg = await BotStatus.findOneAndUpdate({ key: 'main' }, update, { upsert: true, new: true });
      await applyBotStatus(client);

      return interaction.reply({
        embeds: [successEmbed('Statut mis à jour', 'Le nouveau statut est déjà appliqué.'), buildStatusEmbed(cfg)],
        ephemeral: true,
      });
    }
  },
};
