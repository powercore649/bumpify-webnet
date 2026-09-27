const mongoose = require('mongoose');

// Réseau inter-serveur : chaque document = un salon d'un serveur lié à un réseau
const interServerSchema = new mongoose.Schema({
  // Réseau auquel appartient ce salon
  networkId:    { type: String, required: true },   // ID unique du réseau (ex: "general-fr")
  networkName:  { type: String, default: 'Réseau' },

  // Salon de ce serveur dans le réseau
  guildId:      { type: String, required: true },
  channelId:    { type: String, required: true },
  webhookId:    { type: String, default: null },
  webhookToken: { type: String, default: null },

  // Paramètres
  active:       { type: Boolean, default: true },
  allowImages:  { type: Boolean, default: true },
  allowLinks:   { type: Boolean, default: true },
  allowMentions:{ type: Boolean, default: false }, // @everyone/@here bloqués par défaut
  compact:      { type: Boolean, default: false }, // mode compact (sans embed)

  // Stats
  messagesSent: { type: Number, default: 0 },
  joinedAt:     { type: Date, default: Date.now },
});

// Un salon ne peut appartenir qu'à un seul réseau
interServerSchema.index({ channelId: 1 }, { unique: true });
interServerSchema.index({ networkId: 1 });
interServerSchema.index({ guildId: 1 });

module.exports = mongoose.model('InterServer', interServerSchema);
