'use strict';
// utils/notificationManager.js — Système de notifications en temps réel
// Gère l'envoi des notifications et la mise à jour du panel live.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { NotificationSub, NotificationLog, NotificationConfig, NotificationUserLog, NotificationFeed } = require('../models/Notification');
const { COLORS } = require('../utils/embeds');

// ─── Construire l'embed du panel live ────────────────────────────────────────
async function buildPanelEmbed(guild, config) {
  // Dernières notifications (5 max)
  const logs = await NotificationLog.find({ guildId: guild.id })
    .sort({ sentAt: -1 })
    .limit(5)
    .lean();

  // Nombre d'abonnés par type
  const [totalSubs, fgSubs, gwSubs, evSubs, stSubs] = await Promise.all([
    NotificationSub.countDocuments({ guildId: guild.id }),
    NotificationSub.countDocuments({ guildId: guild.id, freeGames: true }),
    NotificationSub.countDocuments({ guildId: guild.id, giveaways: true }),
    NotificationSub.countDocuments({ guildId: guild.id, events: true }),
    NotificationSub.countDocuments({ guildId: guild.id, streams: true }),
  ]);

  const lastLogsText = logs.length > 0
    ? logs.map(l => {
        const ts = Math.floor(new Date(l.sentAt).getTime() / 1000);
        return `<t:${ts}:R> — **${l.title}** *(${l.sentTo} notifié(s))*`;
      }).join('\n')
    : '*Aucune notification encore envoyée.*';

  const ok = v => v ? '🟢' : '🔴';

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🔔 Panel de Notifications — Temps Réel')
    .setDescription('Ce panel se met à jour automatiquement à chaque notification envoyée.')
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .addFields(
      {
        name: '⚙️ Configuration',
        value: [
          `${ok(config.freeGamesEnabled)} Jeux gratuits`,
          `${ok(config.bumpsEnabled)} Bumps`,
          `${ok(config.giveawaysEnabled)} Giveaways`,
          `${ok(config.eventsEnabled)} Événements`,
          `${ok(config.streamsEnabled)} Streams`,
          `📋 Logs: ${config.logChannelId ? `<#${config.logChannelId}>` : '*Non défini*'}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '👥 Abonnés',
        value: [
          `Total: **${totalSubs}**`,
          `🎮 Jeux gratuits: **${fgSubs}**`,
          `🎉 Giveaways: **${gwSubs}**`,
          `📅 Événements: **${evSubs}**`,
          `📺 Streams: **${stSubs}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '📨 Dernières notifications',
        value: lastLogsText,
        inline: false,
      },
    )
    .setFooter({ text: `Bumpify • Mis à jour` })
    .setTimestamp();
}

// ─── Mettre à jour le panel live ─────────────────────────────────────────────
async function updateLivePanel(client, guildId) {
  try {
    const config = await NotificationConfig.findOne({ guildId });
    if (!config?.panelChannelId || !config?.panelMessageId) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(config.panelChannelId);
    if (!channel?.isTextBased()) return;

    const embed = await buildPanelEmbed(guild, config);
    const row   = buildPanelButtons();

    const msg = await channel.messages.fetch(config.panelMessageId).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed], components: [row] }).catch(() => {});
    } else {
      // Message supprimé — en recréer un
      const newMsg = await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
      if (newMsg) {
        await NotificationConfig.findOneAndUpdate(
          { guildId },
          { panelMessageId: newMsg.id }
        );
      }
    }
  } catch (err) {
    console.error('updateLivePanel:', err.message);
  }
}

// ─── Boutons du panel ─────────────────────────────────────────────────────────
function buildPanelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('notif_subscribe')
      .setLabel('🔔 S\'abonner')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('notif_unsubscribe')
      .setLabel('🔕 Se désabonner')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('notif_my_prefs')
      .setLabel('⚙️ Mes préférences')
      .setStyle(ButtonStyle.Secondary),
  );
}

// ─── Fil personnel — embed listant l'historique de notifications d'un membre ──
async function buildUserFeedEmbed(client, userId) {
  const logs = await NotificationUserLog.find({ userId }).sort({ createdAt: -1 }).limit(15).lean();
  const unreadCount = await NotificationUserLog.countDocuments({ userId, read: false });

  const lines = logs.length
    ? logs.map(l => {
        const ts = Math.floor(new Date(l.createdAt).getTime() / 1000);
        const dot = l.read ? '⚪' : '🔵';
        const guildName = client.guilds.cache.get(l.guildId)?.name || 'Serveur';
        return `${dot} **${l.title}** *(${guildName})* — <t:${ts}:R>`;
      }).join('\n')
    : '*Aucune notification pour le moment.*';

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('📬 Votre fil de notifications')
    .setDescription(lines)
    .setFooter({ text: unreadCount > 0 ? `${unreadCount} non lue(s)` : 'Tout est lu' })
    .setTimestamp();
}

function buildUserFeedButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('notif_feed_refresh').setLabel('🔄 Actualiser').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('notif_feed_read_all').setLabel('✅ Tout marquer comme lu').setStyle(ButtonStyle.Success),
  );
}

// ─── Fil personnel — envoie ou met à jour le message DM live d'un membre ─────
// opts.createIfMissing: si true, crée le DM même si aucun fil n'existe encore.
// Retourne true si le DM a pu être envoyé/édité, false si les DMs sont fermés.
async function updateUserFeed(client, userId, opts = {}) {
  try {
    let feed = await NotificationFeed.findOne({ userId });
    if (!feed && !opts.createIfMissing) return false;

    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return false;

    const embed = await buildUserFeedEmbed(client, userId);
    const row = buildUserFeedButtons();

    // Tente d'éditer le message existant
    if (feed?.dmMessageId) {
      try {
        const dm = await user.createDM();
        const msg = await dm.messages.fetch(feed.dmMessageId).catch(() => null);
        if (msg) {
          await msg.edit({ embeds: [embed], components: [row] });
          await NotificationFeed.updateOne({ userId }, { updatedAt: new Date() });
          return true;
        }
      } catch (_) { /* message supprimé ou inaccessible — on en renvoie un nouveau plus bas */ }
    }

    // Sinon envoie un nouveau message DM et mémorise son ID
    const sent = await user.send({ embeds: [embed], components: [row] }).catch(() => null);
    if (!sent) return false;

    await NotificationFeed.findOneAndUpdate(
      { userId },
      { userId, dmChannelId: sent.channelId, dmMessageId: sent.id, updatedAt: new Date() },
      { upsert: true },
    );
    return true;
  } catch (err) {
    console.error('updateUserFeed:', err.message);
    return false;
  }
}

// ─── Envoyer une notification à tous les abonnés d'un type ───────────────────
const CONFIG_FIELD_BY_TYPE = {
  freeGames: 'freeGamesEnabled',
  bumps:     'bumpsEnabled',
  giveaways: 'giveawaysEnabled',
  events:    'eventsEnabled',
  streams:   'streamsEnabled',
};

async function sendNotification(client, guildId, type, embed, title) {
  try {
    const config = await NotificationConfig.findOne({ guildId });
    const configField = CONFIG_FIELD_BY_TYPE[type];
    if (configField && config && config[configField] === false) return 0; // type désactivé côté serveur

    const subs = await NotificationSub.find({ guildId, [type]: true });
    let sent = 0;

    for (const sub of subs) {
      try {
        if (sub.via === 'dm') {
          const user = await client.users.fetch(sub.userId).catch(() => null);
          if (user) {
            await user.send({ embeds: [embed] }).catch(() => {});
            sent++;
          }
        }

        // Historique personnel — alimente "/notifications mes-notifications"
        await NotificationUserLog.create({
          userId: sub.userId, guildId, type, title,
          description: embed?.data?.description || '',
        });

        // Rafraîchit le fil DM live si l'utilisateur en a déjà ouvert un
        // (ne crée jamais de nouveau DM ici — seulement s'il en existe déjà un)
        updateUserFeed(client, sub.userId, { createIfMissing: false }).catch(() => {});
      } catch (_) {}
    }

    // Logger la notification
    await NotificationLog.create({ guildId, type, title, sentTo: sent });

    // Log dans le salon de logs si configuré
    if (config?.logChannelId) {
      const guild = client.guilds.cache.get(guildId);
      const logCh = guild?.channels.cache.get(config.logChannelId);
      if (logCh) {
        await logCh.send({
          embeds: [new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle(`🔔 Notification envoyée — ${title}`)
            .addFields(
              { name: 'Type',      value: type,           inline: true },
              { name: 'Envoyée à', value: `${sent} utilisateur(s)`, inline: true },
            )
            .setTimestamp()],
        }).catch(() => {});
      }
    }

    // Mettre à jour le panel live
    await updateLivePanel(client, guildId);

    return sent;
  } catch (err) {
    console.error('sendNotification:', err.message);
    return 0;
  }
}

module.exports = {
  buildPanelEmbed,
  buildPanelButtons,
  updateLivePanel,
  sendNotification,
  buildUserFeedEmbed,
  buildUserFeedButtons,
  updateUserFeed,
};
