'use strict';
// utils/suggestionLogger.js — Journalisation configurable du système de suggestions
// Chaque action est (1) enregistrée en base pour le transcript web, et
// (2) optionnellement postée en direct dans le salon de logs choisi depuis le panel.

const { EmbedBuilder } = require('discord.js');
const { SuggestionLog, SuggestionConfig } = require('../models/Suggestion');
const { COLORS } = require('../utils/embeds');

const LOG_META = {
  created:        { label: '💡 Suggestion créée',        color: COLORS.info },
  upvoted:        { label: '👍 Vote positif',             color: COLORS.success },
  downvoted:      { label: '👎 Vote négatif',              color: COLORS.error },
  vote_changed:   { label: '🔄 Vote modifié',              color: COLORS.info },
  approved:       { label: '✅ Suggestion approuvée',      color: COLORS.success },
  denied:         { label: '❌ Suggestion refusée',        color: COLORS.error },
  auto_approved:  { label: '🤖 Auto-approuvée (seuil de votes)', color: COLORS.success },
  auto_denied:    { label: '🤖 Auto-refusée (seuil de votes)',   color: COLORS.error },
  edited:         { label: '✏️ Suggestion modifiée',       color: COLORS.warning },
  deleted:        { label: '🗑️ Suggestion supprimée',      color: COLORS.error },
  pinned:         { label: '📌 Suggestion épinglée',       color: COLORS.primary },
  unpinned:       { label: '📌 Suggestion désépinglée',    color: COLORS.primary },
  thread_created: { label: '💬 Fil de discussion créé',    color: COLORS.info },
  config_changed: { label: '⚙️ Configuration modifiée',    color: COLORS.primary },
};

/**
 * Enregistre une action sur une suggestion et la relaie dans le salon de logs si configuré.
 * @param {Object} opts
 * @param {import('discord.js').Client} [opts.client] - requis si vous voulez le relais en salon
 * @param {string} opts.guildId
 * @param {string} opts.suggestionId
 * @param {string} opts.action - clé de LOG_META
 * @param {string|null} [opts.actorId] - null pour une action automatique/système
 * @param {string} [opts.detail]
 * @param {number} [opts.suggestionNumber]
 */
async function logAction({ client, guildId, suggestionId, action, actorId = null, detail = '', suggestionNumber = null }) {
  await SuggestionLog.create({ guildId, suggestionId: String(suggestionId), action, actorId, detail });

  if (!client) return;
  try {
    const config = await SuggestionConfig.findOne({ guildId });
    if (!config?.logChannelId) return;

    const guild = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(config.logChannelId);
    if (!channel?.isTextBased()) return;

    const meta = LOG_META[action] || { label: action, color: COLORS.info };
    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setTitle(meta.label)
      .setDescription([
        suggestionNumber ? `**Suggestion :** #${suggestionNumber}` : null,
        actorId ? `**Par :** <@${actorId}>` : '**Par :** Système (automatique)',
        detail ? `**Détail :** ${detail}` : null,
      ].filter(Boolean).join('\n'))
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => {});
  } catch (_) { /* le logging ne doit jamais faire planter l'action principale */ }
}

/**
 * Historique complet d'une suggestion, trié chronologiquement (pour le transcript web et /suggestion transcript).
 */
async function getHistory(suggestionId) {
  return SuggestionLog.find({ suggestionId: String(suggestionId) }).sort({ date: 1 }).lean();
}

function formatLogLine(entry) {
  const meta = LOG_META[entry.action] || { label: entry.action };
  const ts = Math.floor(new Date(entry.date).getTime() / 1000);
  const who = entry.actorId ? `<@${entry.actorId}>` : 'Système';
  return `<t:${ts}:R> — ${meta.label} · ${who}${entry.detail ? ` · ${entry.detail}` : ''}`;
}

module.exports = { logAction, getHistory, formatLogLine, LOG_META };
