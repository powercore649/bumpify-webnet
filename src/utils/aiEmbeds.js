'use strict';
// utils/aiEmbeds.js — Embeds pour le système IA (panel config, stats live, réponses)

const { EmbedBuilder } = require('discord.js');
const { AVAILABLE_MODELS } = require('./geminiClient');

const AI_COLOR = 0x8E75F5; // violet Gemini

function modelLabel(value) {
  return AVAILABLE_MODELS.find((m) => m.value === value)?.label || value;
}

// ─── Embed principal du panel de configuration ────────────────────────────
function buildConfigPanelEmbed(guild, cfg, todayStats) {
  const lockStatus = cfg.locked && cfg.lockedUntil
    ? `🔒 Verrouillé — réessai <t:${Math.floor(cfg.lockedUntil.getTime() / 1000)}:R>`
    : '🔓 Non verrouillé';

  const quotaModeLabel = cfg.quotaFallbackMode === 'switch_model'
    ? '🔄 Changement de modèle automatique'
    : '🔒 Verrouillage du salon';

  const playgroundLabel = cfg.playgroundChannelId
    ? `<#${cfg.playgroundChannelId}>`
    : '*Non créé — bouton ci-dessous*';

  const embed = new EmbedBuilder()
    .setColor(AI_COLOR)
    .setTitle('🤖 Panel — Configuration IA (Gemini)')
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .setDescription('Configurez le chatbot IA de votre serveur. Les membres peuvent lui parler directement dans les salons configurés, ou via `/ia chat`.')
    .addFields(
      { name: 'Statut', value: cfg.enabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: 'Modèle', value: modelLabel(cfg.model), inline: true },
      { name: 'Température', value: `${cfg.temperature} *(créativité)*`, inline: true },
      { name: 'Salons actifs', value: cfg.channelIds.length ? cfg.channelIds.map((id) => `<#${id}>`).join(', ') : '*Aucun*', inline: false },
      { name: 'Rôles autorisés', value: cfg.allowedRoleIds.length ? cfg.allowedRoleIds.map((id) => `<@&${id}>`).join(', ') : '*Tout le monde*', inline: false },
      { name: 'Limite quotidienne / membre', value: cfg.dailyLimitPerUser > 0 ? `${cfg.dailyLimitPerUser} messages` : 'Illimité', inline: true },
      { name: 'Mémoire de contexte', value: `${cfg.maxHistoryPairs} échanges`, inline: true },
      { name: '📊 Messages aujourd\'hui', value: `${todayStats?.messageCount ?? 0}`, inline: true },
      { name: '🎯 Mode quota (si limite atteinte)', value: quotaModeLabel, inline: true },
      { name: '⏳ Durée du verrou', value: `${cfg.lockDurationMinutes} min`, inline: true },
      { name: '📛 Statut du verrou', value: lockStatus, inline: true },
      { name: '💥 Quotas atteints (all-time)', value: `${cfg.quotaHits}`, inline: true },
      { name: '🛝 Salon AI Playground', value: playgroundLabel, inline: true },
      { name: 'Prompt système', value: `\`\`\`${(cfg.systemPrompt || '').slice(0, 250)}\`\`\``, inline: false },
    )
    .setFooter({ text: 'Bumpify • IA Gemini' })
    .setTimestamp();

  return embed;
}

// ─── Embed du dashboard de statistiques (auto-actualisé) ──────────────────
function buildStatsEmbed(guild, cfg, todayStats, recentDays) {
  const uptime = cfg.createdAt ? `<t:${Math.floor(new Date(cfg.createdAt).getTime() / 1000)}:R>` : 'N/A';
  const errorRate = cfg.totalMessages > 0 ? ((cfg.totalErrors / cfg.totalMessages) * 100).toFixed(1) : '0.0';

  const embed = new EmbedBuilder()
    .setColor(AI_COLOR)
    .setTitle('📊 Dashboard IA — Statistiques en temps réel')
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .addFields(
      { name: '💬 Messages aujourd\'hui', value: `**${todayStats?.messageCount ?? 0}**`, inline: true },
      { name: '👥 Membres actifs aujourd\'hui', value: `**${todayStats?.uniqueUsers?.length ?? 0}**`, inline: true },
      { name: '📈 Total messages (all-time)', value: `**${cfg.totalMessages}**`, inline: true },
      { name: '⏱️ Temps de réponse moyen', value: `**${cfg.avgResponseMs ? Math.round(cfg.avgResponseMs) : 0} ms**`, inline: true },
      { name: '❌ Taux d\'erreur', value: `**${errorRate}%** (${cfg.totalErrors} erreurs)`, inline: true },
      { name: '🕐 Système actif depuis', value: uptime, inline: true },
      { name: '🔤 Tokens entrants (all-time)', value: `${cfg.totalTokensIn.toLocaleString()}`, inline: true },
      { name: '🔤 Tokens sortants (all-time)', value: `${cfg.totalTokensOut.toLocaleString()}`, inline: true },
      { name: '🤖 Modèle actif', value: modelLabel(cfg.model), inline: true },
    );

  if (recentDays?.length) {
    embed.addFields({
      name: '📅 7 derniers jours',
      value: recentDays.map((d) => `\`${d.date}\` — ${d.messageCount} msg · ${d.uniqueUsers.length} membres`).join('\n') || '*Aucune donnée*',
      inline: false,
    });
  }

  embed.setFooter({ text: 'Bumpify • Actualisé automatiquement toutes les 10s' }).setTimestamp();
  return embed;
}

// ─── Réponse de chat (mode /ia chat) ───────────────────────────────────────
function buildChatReplyEmbed(question, answer, model, responseMs) {
  const embed = new EmbedBuilder()
    .setColor(AI_COLOR)
    .addFields({ name: '💭 Question', value: question.length > 200 ? `${question.slice(0, 197)}...` : question, inline: false })
    .setDescription(answer.length > 4000 ? `${answer.slice(0, 3997)}...` : answer)
    .setFooter({ text: `Bumpify • ${modelLabel(model).split(' —')[0]} • ${responseMs}ms` });
  return embed;
}

module.exports = {
  AI_COLOR,
  modelLabel,
  buildConfigPanelEmbed,
  buildStatsEmbed,
  buildChatReplyEmbed,
};
