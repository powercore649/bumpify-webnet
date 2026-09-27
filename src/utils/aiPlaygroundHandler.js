'use strict';
// utils/aiPlaygroundHandler.js — Traite un message envoyé dans le salon AI Playground :
// vérifie le verrou, interroge l'IA (avec bascule automatique de modèle), répond, et
// verrouille automatiquement le salon si TOUS les modèles sont en quota dépassé.

const { EmbedBuilder } = require('discord.js');
const AiPlaygroundConfig = require('../models/AiPlaygroundConfig');
const { askAI } = require('./aiService');
const { COLORS, errorEmbed } = require('../utils/embeds');

const MAX_PROMPT_LENGTH = 2000;

async function handleAiPlaygroundMessage(message, cfg, client) {
  if (!message.content?.trim()) return;

  // ── Salon verrouillé : on prévient sans spammer (une réaction suffit) ──
  if (cfg.locked) {
    await message.react('🔒').catch(() => {});
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    await message.reply({ embeds: [errorEmbed('IA non configurée', 'La clé `GEMINI_API_KEY` n\'est pas définie dans le `.env` du bot. Contactez un administrateur.')] }).catch(() => {});
    return;
  }

  await message.channel.sendTyping().catch(() => {});

  const prompt = message.content.slice(0, MAX_PROMPT_LENGTH);
  const result = await askAI(prompt, cfg.modelChain);

  if (result.ok) {
    const chunks = splitForDiscord(result.text);
    for (const chunk of chunks) {
      await message.reply({ content: chunk, allowedMentions: { repliedUser: false } }).catch(() => {});
    }
    return;
  }

  if (result.allExhausted) {
    // ── Tous les modèles sont en quota dépassé : verrouille réellement le salon ──
    const freshCfg = await AiPlaygroundConfig.findOne({ guildId: message.guild.id, _id: cfg._id });
    if (freshCfg && !freshCfg.locked) {
      freshCfg.locked = true;
      freshCfg.lockedReason = 'Tous les modèles IA ont atteint leur quota';
      freshCfg.lockedAt = new Date();
      await freshCfg.save();

      const { applyChannelLockState } = require('../commands/utilitaires/ai-playground');
      await applyChannelLockState(message.guild, freshCfg).catch(() => {});

      const soonestText = result.soonestAt ? `\nRéessayez <t:${Math.floor(new Date(result.soonestAt).getTime() / 1000)}:R>.` : '';
      await message.channel.send({
        embeds: [new EmbedBuilder()
          .setColor(COLORS.error)
          .setTitle('🔒 Salon verrouillé — Quota IA dépassé')
          .setDescription(`Tous les modèles configurés ont atteint leur limite de quota. Le salon est verrouillé jusqu'à ce qu'un modèle redevienne disponible.${soonestText}`)
          .setFooter({ text: 'Déverrouillage automatique dès qu\'un modèle est de nouveau disponible' })],
      }).catch(() => {});
    } else {
      await message.react('🔒').catch(() => {});
    }
    return;
  }

  // ── Erreur normale (pas un quota) : on informe sans verrouiller le salon ──
  await message.reply({ embeds: [errorEmbed('Erreur IA', result.error || 'Une erreur inattendue est survenue. Réessayez plus tard.')] }).catch(() => {});
}

function splitForDiscord(text, maxLen = 1900) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('\n', maxLen);
    if (cut <= 0) cut = maxLen;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

module.exports = { handleAiPlaygroundMessage, splitForDiscord };
