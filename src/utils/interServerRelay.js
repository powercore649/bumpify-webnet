// utils/interServerRelay.js — Relai inter-serveur v2
const {
  EmbedBuilder,
  WebhookClient,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const InterServer = require('../models/InterServer');
const { COLORS } = require('./embeds');

const MAX_CONTENT_LENGTH = 1900;
const RELAY_COOLDOWN_MS  = 500;
// Anti-spam : un même utilisateur ne peut relayer plus de 5 messages par 10s par réseau
const spamTracker = new Map(); // key: `${userId}:${networkId}` → { count, resetAt }

// ── Anti-spam relai ──────────────────────────────────────────────────────────
function isSpam(userId, networkId) {
  const key = `${userId}:${networkId}`;
  const now  = Date.now();
  let entry  = spamTracker.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + 10_000 };
    spamTracker.set(key, entry);
    return false;
  }
  entry.count++;
  if (entry.count > 5) return true;
  return false;
}

// ── Nettoyage du contenu ─────────────────────────────────────────────────────
function sanitizeContent(content, config) {
  if (!content) return null;
  let clean = content
    .replace(/@everyone/g, '@\u200beveryone')
    .replace(/@here/g,     '@\u200bhere');
  if (!config.allowMentions) {
    clean = clean.replace(/<@[!&]?(\d+)>/g, '[mention supprimée]');
  }
  if (!config.allowLinks) {
    clean = clean.replace(/https?:\/\/[^\s]+/gi, '[lien supprimé]');
  }
  return clean.slice(0, MAX_CONTENT_LENGTH) || null;
}

// ── Construire l'embed principal du message relayé ───────────────────────────
function buildMessageEmbed(message, sourceConfig, replyInfo) {
  const guild   = message.guild;
  const author  = message.author;
  const content = sanitizeContent(message.content, sourceConfig);  const embed = new EmbedBuilder()
  .setColor(COLORS.primary)
  .setAuthor({
      name:    `${author.username}`,
      iconURL: author.displayAvatarURL({ extension: 'png', size: 128 }),
    })
    .setFooter({
      text:    `📡 ${guild.name} • Réseau: ${sourceConfig.networkName}`,
      iconURL: guild.iconURL({ dynamic: true }) || undefined,
    })
    .setTimestamp(message.createdAt);

  if (content) embed.setDescription(content);

  if (replyInfo) {
    embed.addFields({
      name:   `↩️ En réponse à ${replyInfo.authorName}`,
      value:  replyInfo.content
        ? `> ${replyInfo.content.slice(0, 100)}${replyInfo.content.length > 100 ? '…' : ''}`
        : '> *[Message non disponible]*',
      inline: false,
    });
  }

  return embed;
}

// ── Bouton "Voir le message" ─────────────────────────────────────────────────
function buildViewButton(messageURL) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('🔗 Voir le message')
      .setStyle(ButtonStyle.Link)
      .setURL(messageURL),
  );
}

// ── Récupérer les infos de reply ─────────────────────────────────────────────
async function getReplyInfo(message, config) {
  if (!message.reference?.messageId) return null;
  try {
    const replied = await message.channel.messages.fetch(message.reference.messageId);
    if (!replied) return null;
    return {
      authorName: replied.author?.username || 'Inconnu',
      content:    sanitizeContent(replied.content, config) || '',
      url:        replied.url,
    };
  } catch {
    return null;
  }
}

// ── Relai principal ──────────────────────────────────────────────────────────
async function relayMessage(message, sourceConfig) {
  if (!message || !sourceConfig) return;

  // Anti-spam
  if (isSpam(message.author.id, sourceConfig.networkId)) {
    return; // silencieusement ignoré
  }

  const targets = await InterServer.find({
    networkId: sourceConfig.networkId,
    active:    true,
    channelId: { $ne: sourceConfig.channelId },
  });

  if (!targets.length) return;

  const replyInfo       = await getReplyInfo(message, sourceConfig);
  const attachments     = [...message.attachments.values()];
  const imageAttachments = sourceConfig.allowImages
    ? attachments.filter(a => a.contentType?.startsWith('image/')) : [];
  const fileAttachments  = attachments.filter(a => !a.contentType?.startsWith('image/'));
  const stickers         = [...(message.stickers?.values() ?? [])];
  const forwardedEmbeds  = message.embeds.slice(0, 3);
  const messageURL       = `https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id}`;

  const mainEmbed = buildMessageEmbed(message, sourceConfig, replyInfo);

  if (fileAttachments.length > 0) {
    const fileLines = fileAttachments.map(a => `📎 [${a.name}](${a.url})`).join('\n');
    const current   = mainEmbed.data.description || '';
    mainEmbed.setDescription([current, fileLines].filter(Boolean).join('\n'));
  }
  if (stickers.length > 0) {
    const stickerLine = `🪄 Sticker: ${stickers.map(s => s.name).join(', ')}`;
    const current     = mainEmbed.data.description || '';
    mainEmbed.setDescription([current, stickerLine].filter(Boolean).join('\n'));
  }

  const viewButton = buildViewButton(messageURL);

  for (const target of targets) {
    try {
      if (!target.webhookId || !target.webhookToken) continue;

      const webhook = new WebhookClient({ id: target.webhookId, token: target.webhookToken });

      const embeds = [mainEmbed.toJSON()];

      if (imageAttachments.length > 0 && !target.compact) {
        imageAttachments.slice(0, 3).forEach(img => {
          embeds.push(new EmbedBuilder().setImage(img.url).setColor(COLORS.primary).toJSON());
        });
      }

      if (forwardedEmbeds.length > 0 && embeds.length < 4) {
        forwardedEmbeds.slice(0, 4 - embeds.length).forEach(e => embeds.push(e.toJSON()));
      }

      if (imageAttachments.length > 0 && target.compact) {
        const imgUrls = imageAttachments.map(a => a.url).join('\n');
        const current = mainEmbed.data.description || '';
        mainEmbed.setDescription([current, imgUrls].filter(Boolean).join('\n').slice(0, MAX_CONTENT_LENGTH));
      }

      const payload = {
        username:  `${message.author.username} • ${message.guild.name}`.slice(0, 80),
        avatarURL: message.author.displayAvatarURL({ extension: 'png', size: 128 }),
        embeds,
        components: [viewButton],
      };

      await webhook.send(payload);
      await InterServer.updateOne({ _id: target._id }, { $inc: { messagesSent: 1 } });
      await new Promise(r => setTimeout(r, RELAY_COOLDOWN_MS));
    } catch (err) {
      if (err.code === 10015 || err.status === 404) {
        await InterServer.updateOne(
          { _id: target._id },
          { webhookId: null, webhookToken: null, active: false }
        );
        console.warn(`⚠️ Webhook mort ${target.guildId}/${target.channelId}, désactivé.`);
      } else {
        console.error(`❌ Relai → ${target.channelId}:`, err.message);
      }
    }
  }

  await InterServer.updateOne({ _id: sourceConfig._id }, { $inc: { messagesSent: 1 } });
}

// ── Créer / renouveler le webhook d'un salon ─────────────────────────────────
async function createNetworkWebhook(channel, networkName) {
  try {
    const existing = await channel.fetchWebhooks();
    const old      = existing.find(w => w.name.startsWith('🔗 Bumpify'));
    if (old) await old.delete().catch(() => {});

    const wh = await channel.createWebhook({
      name:   `🔗 Bumpify · ${networkName}`.slice(0, 80),
      avatar: null,
      reason: 'Bumpify Inter-Serveur',
    });

    return { webhookId: wh.id, webhookToken: wh.token };
  } catch (err) {
    console.error('❌ Création webhook:', err.message);
    return null;
  }
}

// ── Nettoyer le tracker anti-spam (pour éviter les fuites mémoire) ────────────
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of spamTracker.entries()) {
    if (now > val.resetAt) spamTracker.delete(key);
  }
}, 30_000);

module.exports = { relayMessage, createNetworkWebhook };
