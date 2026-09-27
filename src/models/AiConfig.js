'use strict';
// models/AiConfig.js — Configuration du système de chat IA (Gemini) par serveur

const mongoose = require('mongoose');

const aiConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: false },

  // Salons où chaque message est automatiquement traité comme une conversation
  channelIds: { type: [String], default: [] },

  // Modèle & comportement
  model:          { type: String, default: 'gemini-2.5-flash' }, // gemini-2.5-flash | gemini-2.5-pro | gemini-2.0-flash
  temperature:    { type: Number, default: 0.9, min: 0, max: 2 },
  systemPrompt:   { type: String, default: 'Tu es un assistant Discord amical, utile et concis. Réponds dans la langue du message reçu.' },
  maxHistoryPairs:{ type: Number, default: 10 }, // nb d'échanges (user+model) conservés en mémoire

  // ── Comportement en cas de quota Gemini dépassé ─────────────────────────
  // 'switch_model' : bascule automatiquement sur un modèle de secours
  // 'lock_channel'  : verrouille temporairement le chat le temps que le quota revienne
  quotaFallbackMode:  { type: String, enum: ['switch_model', 'lock_channel'], default: 'switch_model' },
  lockDurationMinutes:{ type: Number, default: 5 },
  locked:              { type: Boolean, default: false },
  lockedUntil:         { type: Date, default: null },
  quotaHits:           { type: Number, default: 0 },

  // Salon "AI Playground" créé à la demande depuis le panel (jamais automatiquement)
  playgroundChannelId: { type: String, default: null },

  // Restrictions d'accès
  allowedRoleIds:   { type: [String], default: [] }, // vide = tout le monde peut parler à l'IA
  blockedUserIds:   { type: [String], default: [] },
  dailyLimitPerUser:{ type: Number, default: 30 },     // 0 = illimité

  // Compteurs globaux (persistants, jamais remis à zéro)
  totalMessages: { type: Number, default: 0 },
  totalTokensIn:  { type: Number, default: 0 },
  totalTokensOut: { type: Number, default: 0 },
  totalErrors:    { type: Number, default: 0 },
  avgResponseMs:  { type: Number, default: 0 },

  lastUsedAt: { type: Date, default: null },
  createdAt:  { type: Date, default: Date.now },
});

module.exports = mongoose.models.AiConfig || mongoose.model('AiConfig', aiConfigSchema);
