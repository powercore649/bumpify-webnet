'use strict';
// utils/suggestionLogger.js — Journalisation configurable du système de suggestions
// Chaque action est (1) enregistrée en base pour l'historique/transcript web, et
// (2) optionnellement relayée en direct dans le salon de logs choisi depuis le panneau.
// Les types de logs sont filtrables individuellement (config.logTypes, null = tout).

const { EmbedBuilder } = require('discord.js');
const { SuggestionLog, SuggestionConfig, Suggestion } = require('../models/Suggestion');
const { COLORS } = require('../utils/embeds');

const LOG_META = {
  created:        { label: '💡 Suggestion créée',                   color: COLORS.info },
  upvoted:        { label: '👍 Vote positif',                        color: COLORS.success },
  downvoted:      { label: '👎 Vote négatif',                        color: COLORS.error },
  vote_changed:   { label: '🔄 Vote modifié',                        color: COLORS.info },
  approved:       { label: '✅ Suggestion approuvée',               color: COLORS.success },
  denied:         { label: '❌ Suggestion refusée',                 color: COLORS.error },
  auto_approved:  { label: '🤖 Auto-approuvée (seuil de votes)',    color: COLORS.success },
  auto_denied:    { label: '🤖 Auto-refusée (seuil de votes)',      color: COLORS.error },
  edited:         { label: '✏️ Suggestion modifiée',                color: COLORS.warning },
  deleted:        { label: '🗑️ Suggestion supprimée',              color: COLORS.error },
  pinned:         { label: '📌 Suggestion épinglée',                color: COLORS.primary },
  unpinned:       { label: '📌 Suggestion désépinglée',             color: COLORS.primary },
  thread_created: { label: '💬 Fil de discussion créé',             color: COLORS.info },
  config_changed: { label: '⚙️ Configuration modifiée',             color: COLORS.primary },
};

/** Types de logs exposés dans le panneau (ordre stable, defaults = tous actifs). */
const LOG_TYPE_KEYS = [
  'created', 'upvoted', 'downvoted', 'vote_changed',
  'approved', 'denied', 'auto_approved', 'auto_denied',
  'edited', 'deleted', 'pinned', 'thread_created', 'config_changed',
];

const LOG_TYPE_LABELS = {
  created:        '💡 Suggestions créées',
  upvoted:        '👍 Votes positifs',
  downvoted:      '👎 Votes négatifs',
  vote_changed:   '🔄 Votes modifiés',
  approved:       '✅ Approbations',
  denied:         '❌ Refus',
  auto_approved:  '🤖 Auto-approbations',
  auto_denied:    '🤖 Auto-refus',
  edited:         '✏️ Modifications',
  deleted:        '🗑️ Suppressions',
  pinned:         '📌 Épinglage',
  thread_created: '💬 Fils créés',
  config_changed: '⚙️ Configuration',
};

/** Un type est actif si logTypes est null (tout) ou si logTypes[key] !== false. */
function isLogTypeEnabled(config, key) {
  const lt = config?.logTypes;
  if (!lt) return true;
  return lt[key] !== false;
}

/**
 * Enregistre une action sur une suggestion et la relaie dans le salon de logs si configuré.
 * @param {Object} opts
 * @param {import('discord.js').Client} [opts.client] - requis pour le relais en salon
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
    if (!isLogTypeEnabled(config, action)) return;

    const guild = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(config.logChannelId);
    if (!channel?.isTextBased()) return;

    const meta = LOG_META[action] || { label: action, color: COLORS.info };

    // Enrichissement : nom de l'auteur + titre de la suggestion concernée.
    let authorLine = '**Par :** Système (automatique)';
    if (actorId) {
      let name = null;
      try {
        const member = await guild.members.fetch(actorId).catch(() => null);
        name = member?.displayName || (await client.users.fetch(actorId).catch(() => null))?.username || null;
      } catch (_) {}
      authorLine = name ? `**Par :** ${name}` : `**Par :** <@${actorId}>`;
    }

    let sugLine = suggestionNumber ? `**Suggestion :** #${suggestionNumber}` : null;
    if (!sugLine && suggestionId && suggestionId !== 'config') {
      const sug = await Suggestion.findById(suggestionId).select('number content').lean().catch(() => null);
      if (sug) sugLine = `**Suggestion :** #${sug.number} — ${(sug.content || '').slice(0, 60)}`;
    }

    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setTitle(meta.label)
      .setDescription([
        sugLine,
        authorLine,
        detail ? `**Détail :** ${detail}` : null,
      ].filter(Boolean).join('\n'))
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => {});
  } catch (_) { /* le logging ne doit jamais faire planter l'action principale */ }
}

/**
 * Historique complet d'une suggestion, trié chronologiquement (transcript web).
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

module.exports = { logAction, getHistory, formatLogLine, LOG_META, LOG_TYPE_KEYS, LOG_TYPE_LABELS, isLogTypeEnabled };
