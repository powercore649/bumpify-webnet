'use strict';
// models/StreamAlert.js — Alertes Twitch (live) & YouTube (nouvelles vidéos)
const mongoose = require('mongoose');

const streamAlertSchema = new mongoose.Schema({
  guildId:       { type: String, required: true },
  platform:      { type: String, enum: ['twitch', 'youtube'], required: true },

  // Identifiant technique : login Twitch (minuscule) ou Channel ID YouTube (UC...)
  identifier:    { type: String, required: true },
  displayName:   { type: String, default: null },
  avatarUrl:     { type: String, default: null },

  // Où et comment annoncer
  channelId:     { type: String, required: true },
  roleId:        { type: String, default: null },
  customMessage: { type: String, default: null }, // Placeholders: {streamer} {titre} {jeu} {lien} {chaine}
  enabled:       { type: Boolean, default: true },

  // ── État live Twitch ─────────────────────────────────────────────────────
  isLive:        { type: Boolean, default: false },
  lastStreamId:  { type: String, default: null },
  liveMessageId: { type: String, default: null },
  liveChannelId: { type: String, default: null }, // salon où le message live a été posté (pour édition à l'offline)

  // ── État YouTube ─────────────────────────────────────────────────────────
  lastVideoId:        { type: String, default: null },
  uploadsPlaylistId:  { type: String, default: null }, // Cache — évite un appel API supplémentaire à chaque check

  lastCheckedAt: { type: Date, default: null },
  lastError:     { type: String, default: null },
  addedBy:       { type: String, default: null },
  createdAt:     { type: Date, default: Date.now },
});

streamAlertSchema.index({ guildId: 1, platform: 1, identifier: 1 }, { unique: true });
streamAlertSchema.index({ platform: 1, enabled: 1 });

module.exports = mongoose.models.StreamAlert || mongoose.model('StreamAlert', streamAlertSchema);
