const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const AntiScamConfig = require('../../models/AntiScamConfig');
const Warn = require('../../models/Warn');
const { scanImage } = require('../../utils/antiScam');
const { COLORS } = require('../../utils/embeds');

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i; // GIF exclu : animé, souvent instable avec l'OCR

function suspicionColor(score) {
  if (score >= 80) return 0xed4245; // rouge
  if (score >= 50) return 0xfee75c; // jaune
  return 0x57f287; // vert
}

async function applySanction(message, config, author, factors, score) {
  const guild = message.guild;
  let sanctionLabel = 'Aucune';

  try {
    if (config.action === 'warn') {
      await Warn.create({
        userId: author.id,
        guildId: guild.id,
        warnedBy: message.client.user.id,
        reason: `[Anti-Arnaque] Image suspecte détectée (${score}%)`,
      });
      sanctionLabel = 'Avertissement';
    } else if (config.action === 'mute') {
      const member = await guild.members.fetch(author.id).catch(() => null);
      if (member?.moderatable) {
        await member.timeout(config.muteDuration * 60 * 1000, 'Anti-Arnaque : image suspecte détectée');
        sanctionLabel = `Mute (${config.muteDuration} min)`;
      }
    } else if (config.action === 'kick') {
      const member = await guild.members.fetch(author.id).catch(() => null);
      if (member?.kickable) {
        await member.kick('Anti-Arnaque : image suspecte détectée');
        sanctionLabel = 'Kick';
      }
    } else if (config.action === 'ban') {
      const member = await guild.members.fetch(author.id).catch(() => null);
      if (member?.bannable ?? guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
        await guild.members.ban(author.id, { reason: 'Anti-Arnaque : image suspecte détectée' });
        sanctionLabel = 'Membre Banni (Ban)';
      }
    }
  } catch (err) {
    console.error('❌ Anti-Arnaque — échec de la sanction:', err.message);
    sanctionLabel = `${sanctionLabel} (échec — permissions insuffisantes ?)`;
  }

  if (config.deleteMessage) {
    await message.delete().catch(() => {});
    sanctionLabel += sanctionLabel !== 'Aucune' ? ' + Message Supprimé' : 'Message Supprimé';
  }

  return sanctionLabel;
}

async function sendAlert(message, config, author, factors, score, imageUrl, sanctionLabel) {
  if (!config.logChannelId) return;
  const channel = message.guild.channels.cache.get(config.logChannelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(suspicionColor(score))
    .setTitle("🛡️ Alerte : Tentative d'Arnaque Image Détectée")
    .setDescription(`Un contenu suspect a été intercepté et analysé par le module de sécurité anti-arnaque de **${message.client.user.username}**.`)
    .addFields(
      {
        name: "👤 Détails de l'Auteur",
        value: `**Nom d'utilisateur :** ${author.username}\n**Identifiant Discord :** ${author.id} (<@${author.id}>)\n**Salon d'envoi :** <#${message.channel.id}>`,
      },
      {
        name: '🛰️ Analyse des Menaces',
        value: `**Indice de suspicion :** \`${score}%\`\n**Facteurs de détection :**\n${factors.map((f) => `• ${f}`).join('\n')}`,
      },
      {
        name: '⚙️ Action Automatique',
        value: `**Sanction appliquée :** \`${sanctionLabel}\``,
      },
    )
    .setTimestamp();

  if (imageUrl && !config.deleteMessage) embed.setImage(imageUrl);

  await channel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (!message.guild || message.author.bot) return;
    if (message.attachments.size === 0) return;

    const config = await AntiScamConfig.findOne({ guildId: message.guild.id });
    if (!config || !config.enabled) return;
    if (config.exemptChannels.includes(message.channel.id)) return;
    if (message.member?.roles.cache.some((r) => config.exemptRoles.includes(r.id))) return;

    const image = message.attachments.find((a) => IMAGE_EXT.test(a.name || '') || ['image/png', 'image/jpeg', 'image/webp'].includes(a.contentType || ''));
    if (!image) return;

    try {
      const { score, factors } = await scanImage(image.url, config);

      config.totalScanned += 1;
      if (score >= config.threshold) config.totalDetected += 1;
      await config.save();

      if (score < config.threshold || factors.length === 0) return;

      const sanctionLabel = config.action === 'none'
        ? 'Aucune (alerte uniquement)'
        : await applySanction(message, config, message.author, factors, score);

      await sendAlert(message, config, message.author, factors, score, image.url, sanctionLabel);
    } catch (err) {
      console.error('❌ Anti-Arnaque — erreur de scan:', err.message);
    }
  },
};
