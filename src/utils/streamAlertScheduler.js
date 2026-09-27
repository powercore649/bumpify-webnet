'use strict';
// utils/streamAlertScheduler.js — Planificateur autonome des alertes Twitch & YouTube
// Indépendant des autres crons — deux boucles séparées (Twitch : rapide, YouTube : API officielle).

const StreamAlert = require('../models/StreamAlert');
const twitch  = require('./twitchFetcher');
const youtube = require('./youtubeFetcher');
const {
  renderTemplate,
  DEFAULT_TWITCH_MESSAGE,
  DEFAULT_YOUTUBE_MESSAGE,
  buildTwitchLiveEmbed,
  buildYoutubeVideoEmbed,
} = require('./streamAlertEmbeds');

let twitchStarted  = false;
let youtubeStarted = false;

// ─── Envoyer un message d'alerte dans un salon Discord ────────────────────────
async function sendAlert(client, alert, { embed, row, url }, defaultMessage, placeholders) {
  const guild = client.guilds.cache.get(alert.guildId);
  if (!guild) return null;
  const channel = guild.channels.cache.get(alert.channelId);
  if (!channel?.isTextBased()) return null;

  const perms = channel.permissionsFor(guild.members.me);
  if (!perms?.has(['SendMessages', 'EmbedLinks'])) return null;

  const mention  = alert.roleId ? `<@&${alert.roleId}> ` : '';
  const template = alert.customMessage?.trim() || defaultMessage;
  const content  = mention + renderTemplate(template, { ...placeholders, lien: url });

  try {
    return await channel.send({ content, embeds: [embed], components: [row] });
  } catch (err) {
    console.error(`[StreamAlerts] Envoi échoué (${alert.platform}/${alert.identifier}):`, err.message);
    return null;
  }
}

// ─── TWITCH — vérifier tous les streamers suivis (tous serveurs confondus) ───
async function checkTwitch(client) {
  if (!twitch.isConfigured()) return; // Silencieux si non configuré

  const alerts = await StreamAlert.find({ platform: 'twitch', enabled: true });
  if (!alerts.length) return;

  const logins = [...new Set(alerts.map((a) => a.identifier.toLowerCase()))];

  let liveStreams = [];
  try {
    liveStreams = await twitch.getStreamsByLogin(logins);
  } catch (err) {
    console.error('[StreamAlerts][Twitch] Erreur API:', err.message);
    return;
  }

  const liveByLogin = new Map(liveStreams.map((s) => [s.user_login.toLowerCase(), s]));

  for (const alert of alerts) {
    try {
      const stream = liveByLogin.get(alert.identifier.toLowerCase());

      // ── Passe en live ──────────────────────────────────────────────────
      if (stream && (!alert.isLive || alert.lastStreamId !== stream.id)) {
        const { embed, row, url } = buildTwitchLiveEmbed({
          login:        alert.identifier,
          displayName:  stream.user_name || alert.displayName || alert.identifier,
          avatarUrl:    alert.avatarUrl,
          title:        stream.title,
          gameName:     stream.game_name,
          thumbnailUrl: stream.thumbnail_url,
          viewerCount:  stream.viewer_count,
          startedAt:    stream.started_at,
        });

        const msg = await sendAlert(client, alert, { embed, row, url }, DEFAULT_TWITCH_MESSAGE, {
          streamer: stream.user_name || alert.displayName || alert.identifier,
          titre:    stream.title || '',
          jeu:      stream.game_name || '',
        });

        alert.isLive        = true;
        alert.lastStreamId  = stream.id;
        alert.liveMessageId = msg?.id || null;
        alert.liveChannelId = msg?.channelId || null;
        alert.lastCheckedAt = new Date();
        alert.lastError     = null;
        await alert.save();

        if (msg) console.log(`🔴 [StreamAlerts] ${alert.identifier} est en live → ${alert.guildId}`);
      }
      // ── Passe hors-ligne ──────────────────────────────────────────────
      else if (!stream && alert.isLive) {
        alert.isLive        = false;
        alert.lastStreamId  = null;
        alert.liveMessageId = null;
        alert.liveChannelId = null;
        alert.lastCheckedAt = new Date();
        await alert.save();
      } else {
        alert.lastCheckedAt = new Date();
        await alert.save().catch(() => {});
      }
    } catch (err) {
      console.error(`[StreamAlerts][Twitch] ${alert.identifier}:`, err.message);
      alert.lastError = err.message;
      await alert.save().catch(() => {});
    }
  }
}

// ─── YOUTUBE — vérifier chaque chaîne suivie via l'API officielle ─────────────
async function checkYoutube(client) {
  if (!youtube.isConfigured()) return; // Silencieux si non configuré

  const alerts = await StreamAlert.find({ platform: 'youtube', enabled: true });
  if (!alerts.length) return;

  for (const alert of alerts) {
    try {
      // Récupérer/rafraîchir l'ID de playlist "uploads" si manquant (migration ou 1ère fois)
      let playlistId = alert.uploadsPlaylistId;
      if (!playlistId) {
        const info = await youtube.fetchChannelInfo({ id: alert.identifier });
        if (!info?.uploadsPlaylistId) {
          alert.lastError = 'Chaîne introuvable via l\'API YouTube';
          await alert.save().catch(() => {});
          continue;
        }
        playlistId = info.uploadsPlaylistId;
        alert.uploadsPlaylistId = playlistId;
        alert.displayName       = info.title || alert.displayName;
        alert.avatarUrl         = info.thumbnail || alert.avatarUrl;
      }

      const videos = await youtube.fetchLatestVideos(playlistId, 5);
      if (!videos.length) { alert.lastCheckedAt = new Date(); await alert.save().catch(() => {}); continue; }

      const latest = videos[0];

      // Baseline — première vérification, on ne poste pas l'historique
      if (!alert.lastVideoId) {
        alert.lastVideoId   = latest.videoId;
        alert.lastCheckedAt = new Date();
        await alert.save();
        continue;
      }

      if (latest.videoId !== alert.lastVideoId) {
        // Poster les nouvelles vidéos non encore vues (de la plus ancienne à la plus récente)
        const idx = videos.findIndex((v) => v.videoId === alert.lastVideoId);
        const toPost = idx === -1 ? [latest] : videos.slice(0, idx).reverse();

        for (const video of toPost) {
          const { embed, row, url } = buildYoutubeVideoEmbed({
            channelName: alert.displayName,
            channelId:   alert.identifier,
            title:       video.title,
            url:         video.url,
            thumbnail:   video.thumbnail,
            description: video.description,
            publishedAt: video.publishedAt,
          });

          const msg = await sendAlert(client, alert, { embed, row, url }, DEFAULT_YOUTUBE_MESSAGE, {
            chaine: alert.displayName || alert.identifier,
            titre:  video.title || '',
          });

          if (msg) console.log(`📺 [StreamAlerts] Nouvelle vidéo ${alert.identifier} → ${alert.guildId}`);
          await new Promise((r) => setTimeout(r, 400));
        }

        alert.lastVideoId = latest.videoId;
      }

      alert.lastCheckedAt = new Date();
      alert.lastError     = null;
      await alert.save();
    } catch (err) {
      console.error(`[StreamAlerts][YouTube] ${alert.identifier}:`, err.message);
      alert.lastError = err.message;
      await alert.save().catch(() => {});
    }

    // Petite pause entre chaque chaîne (confort, pas requis par le quota)
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ─── Démarrer les deux boucles ─────────────────────────────────────────────────
function startStreamAlertScheduler(client) {
  // Twitch — toutes les 2 minutes (le live est sensible au temps réel)
  if (!twitchStarted) {
    twitchStarted = true;
    console.log('🟣 [StreamAlerts] Scheduler Twitch démarré' + (twitch.isConfigured() ? '' : ' (⚠️ non configuré — TWITCH_CLIENT_ID/SECRET manquants)'));
    const runTwitch = () => checkTwitch(client).catch((err) => console.error('[StreamAlerts][Twitch] scheduler:', err.message));
    setTimeout(runTwitch, 15_000);
    setInterval(runTwitch, 2 * 60 * 1000);
  }

  // YouTube — toutes les 5 minutes (API officielle, quota très large avec playlistItems)
  if (!youtubeStarted) {
    youtubeStarted = true;
    console.log('🔴 [StreamAlerts] Scheduler YouTube démarré' + (youtube.isConfigured() ? '' : ' (⚠️ non configuré — YOUTUBE_API_KEY manquant)'));
    const runYoutube = () => checkYoutube(client).catch((err) => console.error('[StreamAlerts][YouTube] scheduler:', err.message));
    setTimeout(runYoutube, 25_000);
    setInterval(runYoutube, 5 * 60 * 1000);
  }
}

module.exports = { startStreamAlertScheduler, checkTwitch, checkYoutube };
