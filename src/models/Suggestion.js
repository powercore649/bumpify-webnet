const mongoose = require('mongoose');

const CATEGORY_KEYS = ['general', 'bot', 'serveur', 'design', 'regles'];

const suggestionSchema = new mongoose.Schema({
  guildId:    { type: String, required: true },
  channelId:  { type: String, required: true },
  messageId:  { type: String, default: null },
  threadId:   { type: String, default: null },
  authorId:   { type: String, required: true },
  content:    { type: String, required: true },
  number:     { type: Number, required: true },
  category:   { type: String, enum: CATEGORY_KEYS, default: 'general' },
  anonymous:  { type: Boolean, default: false },
  status:     { type: String, enum: ['pending', 'approved', 'denied'], default: 'pending' },
  upvotes:    { type: Number, default: 0 },
  downvotes:  { type: Number, default: 0 },
  voters:     { type: [String], default: [] },     // qui a voté (empêche le double-vote)
  voteChoice: { type: mongoose.Schema.Types.Mixed, default: {} }, // { userId: 'up' | 'down' } — permet de changer son vote
  reason:     { type: String, default: null },      // raison de refus/approbation
  pinned:     { type: Boolean, default: false },
  autoResolved: { type: Boolean, default: false },   // résolue automatiquement par seuil de votes
  editedAt:   { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: String, default: null },
  createdAt:  { type: Date, default: Date.now },
});
suggestionSchema.index({ guildId: 1, number: 1 });
suggestionSchema.index({ guildId: 1, status: 1 });
suggestionSchema.index({ guildId: 1, authorId: 1 });

const suggestionConfigSchema = new mongoose.Schema({
  guildId:            { type: String, required: true, unique: true },
  channelId:          { type: String, default: null },
  logChannelId:       { type: String, default: null },
  enabled:            { type: Boolean, default: false },

  // ── Logs avancés ──
  // null = tous les événements relayés ; sinon objet { eventKey: boolean }
  logTypes:           { type: mongoose.Schema.Types.Mixed, default: null },

  // ── Anti-abus ──
  cooldownMinutes:    { type: Number, default: 0 },     // 0 = désactivé
  requiredRoleId:     { type: String, default: null },  // rôle requis pour proposer, null = tout le monde

  // ── Fonctionnalités ──
  anonymousAllowed:   { type: Boolean, default: true },
  categoriesEnabled:  { type: [String], default: CATEGORY_KEYS },
  autoThread:         { type: Boolean, default: false }, // crée un fil de discussion par suggestion
  dmNotify:           { type: Boolean, default: true },  // DM l'auteur au changement de statut

  // ── Seuils d'auto-modération (0 = désactivé) ──
  autoApproveAt:      { type: Number, default: 0 },      // votes nets (up - down) pour auto-approuver
  autoDenyAt:          { type: Number, default: 0 },      // votes nets négatifs pour auto-refuser (valeur positive, ex: 5 → -5 nets)

  // ── Transcript web ──
  transcriptEnabled:  { type: Boolean, default: true },
}, { timestamps: true });

const suggestionLogSchema = new mongoose.Schema({
  guildId:      { type: String, required: true },
  suggestionId: { type: String, required: true }, // _id de la Suggestion en string
  action:       { type: String, required: true },
  actorId:      { type: String, default: null },  // null = système/auto
  detail:       { type: String, default: '' },
  date:         { type: Date, default: Date.now },
});
suggestionLogSchema.index({ suggestionId: 1, date: 1 });
suggestionLogSchema.index({ guildId: 1, date: -1 });

module.exports = {
  CATEGORY_KEYS,
  Suggestion:       mongoose.model('Suggestion', suggestionSchema),
  SuggestionConfig: mongoose.model('SuggestionConfig', suggestionConfigSchema),
  SuggestionLog:    mongoose.model('SuggestionLog', suggestionLogSchema),
};
