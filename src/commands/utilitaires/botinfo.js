const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const os = require('os');
const { COLORS } = require('../../utils/embeds');
const { version } = require('../../../package.json');

const SITE_URL    = 'https://zyntra.dpdns.org';
const SUPPORT_URL = 'https://discord.gg/p6FZP8mfUP';

// Nom d'hébergeur affiché — l'hébergement réel n'est pas détectable par code
// (ce n'est pas une information que Node.js peut lire), donc c'est un texte
// à ajuster ici si vous changez d'hébergeur.
const HOSTING_LABEL = "Zyntra Cloud";

function getOwnerIds() {
  return (process.env.OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function formatRelative(date) {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} heure${hours > 1 ? 's' : ''}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days} jour${days > 1 ? 's' : ''}`;
  const months = Math.floor(days / 30);
  return `il y a ${months} mois`;
}

function formatDate(date) {
  return date.toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

module.exports = {
  data: new SlashCommandBuilder().setName('botinfo').setDescription('🤖 Informations complètes sur Bumpify'),

  async execute(interaction) {
    const client = interaction.client;
    const used = process.memoryUsage();
    const ownerIds = getOwnerIds();

    const createdAt = client.user.createdAt;
    const startedAt = new Date(Date.now() - client.uptime);

    const totalMembers = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
    const totalChannels = client.channels.cache.size;
    const totalRoles = client.guilds.cache.reduce((a, g) => a + g.roles.cache.size, 0);
    const totalBoosts = client.guilds.cache.reduce((a, g) => a + (g.premiumSubscriptionCount || 0), 0);
    const shardCount = client.shard?.count ?? 1;

    const cpuModel = os.cpus()?.[0]?.model?.replace(/\s+/g, ' ').trim() || 'Inconnu';
    const osLabel = `${os.type()} ${os.release()}`;

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setAuthor({ name: `${client.user.username}`, iconURL: client.user.displayAvatarURL() })
      .setTitle('Informations sur le bot')
      .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
      .addFields(
        {
          name: '🤖・Identité',
          value: [
            `**Nom :** ${client.user} \`${client.user.tag}\``,
            `**ID :** ${client.user.id}`,
            `**Date de création :** ${formatDate(createdAt)} (${formatRelative(createdAt)})`,
          ].join('\n'),
        },
        {
          name: '🔷・Développeur',
          value: ownerIds.length
            ? `**Nom :** ${ownerIds.map((id) => `<@${id}>`).join(' ')}`
            : '*Non configuré (OWNER_IDS manquant dans .env)*',
        },
        {
          name: '📊・Statistiques du bot',
          value: [
            `**Démarré :** ${formatDate(startedAt)} (${formatRelative(startedAt)})`,
            `**Serveurs :** ${client.guilds.cache.size.toLocaleString()} (${shardCount} shard${shardCount > 1 ? 's' : ''})`,
            `**Utilisateurs :** ${totalMembers.toLocaleString()}`,
            `**Salons :** ${totalChannels.toLocaleString()}`,
            `**Rôles :** ${totalRoles.toLocaleString()}`,
            `**Boosts :** ${totalBoosts.toLocaleString()}`,
            `**Ping avec l'API Discord :** ${client.ws.ping}ms`,
          ].join('\n'),
        },
        {
          name: '💻・Informations techniques',
          value: [
            `**Hébergeur :** ${HOSTING_LABEL}`,
            `**Système d'exploitation :** ${osLabel}`,
            `**Processeur :** ${cpuModel}`,
            `**Mémoire utilisée :** ${(used.heapUsed / 1024 / 1024).toFixed(0)} Mo`,
            `**Node.js :** ${process.version}`,
            `**discord.js :** v${require('discord.js').version}`,
            `**Version du bot :** v${version}`,
          ].join('\n'),
        },
      )
      .setFooter({ text: `Demandé par ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();

    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Inviter Bumpify').setEmoji('🔗').setStyle(ButtonStyle.Link).setURL(inviteUrl),
      new ButtonBuilder().setLabel('Serveur support').setEmoji('💬').setStyle(ButtonStyle.Link).setURL(SUPPORT_URL),
      new ButtonBuilder().setLabel('Site Internet').setEmoji('🌐').setStyle(ButtonStyle.Link).setURL(SITE_URL),
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  },
};
