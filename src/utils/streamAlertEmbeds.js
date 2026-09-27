'use strict';
// utils/streamAlertEmbeds.js — Templates de message & embeds stylés pour les alertes Twitch/YouTube

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const TWITCH_COLOR  = 0x9146FF;
const YOUTUBE_COLOR = 0xFF0000;

const DEFAULT_TWITCH_MESSAGE  = '🔴 **{streamer}** est en live sur Twitch !';
const DEFAULT_YOUTUBE_MESSAGE = '📺 **{chaine}** vient de publier une nouvelle vidéo !';

// ─── Remplacer les placeholders {streamer} {chaine} {titre} {jeu} {lien} ──────
function renderTemplate(template, data = {}) {
  const map = {
    streamer: data.streamer || data.chaine || '',
    chaine:   data.chaine   || data.streamer || '',
    titre:    data.titre    || '',
    jeu:      data.jeu      || '',
    lien:     data.lien     || '',
  };
  return String(template).replace(/\{(streamer|chaine|titre|jeu|lien)\}/g, (_, key) => map[key]);
}

// ─── Redimensionner une miniature Twitch (URL template {width}x{height}) ─────
function resolveTwitchThumb(url, w = 1280, h = 720) {
  if (!url) return null;
  return url.replace('{width}', w).replace('{height}', h) + `?t=${Date.now()}`;
}

// ─── Embed : un streamer Twitch passe en live ─────────────────────────────────
function buildTwitchLiveEmbed({ login, displayName, avatarUrl, title, gameName, thumbnailUrl, viewerCount, startedAt }) {
  const url = `https://twitch.tv/${login}`;
  const embed = new EmbedBuilder()
    .setColor(TWITCH_COLOR)
    .setAuthor({ name: `${displayName || login} est en live sur Twitch !`, iconURL: avatarUrl || undefined, url })
    .setTitle(title || 'Stream en cours')
    .setURL(url)
    .setFooter({ text: 'Bumpify • Alertes Twitch' })
    .setTimestamp(startedAt ? new Date(startedAt) : new Date());

  if (avatarUrl) embed.setThumbnail(avatarUrl);
  const thumb = resolveTwitchThumb(thumbnailUrl);
  if (thumb) embed.setImage(thumb);

  const fields = [];
  if (gameName)                        fields.push({ name: '🎮 Jeu',       value: gameName,                 inline: true });
  if (typeof viewerCount === 'number') fields.push({ name: '👀 Viewers',   value: String(viewerCount),      inline: true });
  fields.push({ name: '🔗 Lien', value: `[Regarder le stream](${url})`, inline: true });
  embed.addFields(fields);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('🔴 Regarder sur Twitch').setStyle(ButtonStyle.Link).setURL(url),
  );

  return { embed, row, url };
}

// ─── Embed : une nouvelle vidéo YouTube est publiée ───────────────────────────
function buildYoutubeVideoEmbed({ channelName, channelId, title, url, thumbnail, description, publishedAt }) {
  const channelUrl = `https://www.youtube.com/channel/${channelId}`;
  const embed = new EmbedBuilder()
    .setColor(YOUTUBE_COLOR)
    .setAuthor({ name: `${channelName || 'Chaîne YouTube'} a publié une nouvelle vidéo !`, url: channelUrl })
    .setTitle(title || 'Nouvelle vidéo')
    .setURL(url)
    .setFooter({ text: 'Bumpify • Alertes YouTube' })
    .setTimestamp(publishedAt ? new Date(publishedAt) : new Date());

  if (description) embed.setDescription(description);
  if (thumbnail)   embed.setImage(thumbnail);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('▶️ Regarder sur YouTube').setStyle(ButtonStyle.Link).setURL(url),
  );

  return { embed, row, url };
}

module.exports = {
  TWITCH_COLOR,
  YOUTUBE_COLOR,
  DEFAULT_TWITCH_MESSAGE,
  DEFAULT_YOUTUBE_MESSAGE,
  renderTemplate,
  resolveTwitchThumb,
  buildTwitchLiveEmbed,
  buildYoutubeVideoEmbed,
};
