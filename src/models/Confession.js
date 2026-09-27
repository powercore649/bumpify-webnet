const mongoose = require('mongoose');

const confessionSchema = new mongoose.Schema({
  guildId:     { type: String, required: true },
  channelId:   { type: String, required: true },  // salon de publication
  authorId:    { type: String, required: true },   // hashé pour anonymat
  number:      { type: Number, required: true },   // #1, #2, #3...
  content:     { type: String, required: true },
  messageId:   { type: String, default: null },    // message publié
  approved:    { type: Boolean, default: true },   // modération
  createdAt:   { type: Date, default: Date.now },
});
confessionSchema.index({ guildId: 1, number: 1 });

const confessionConfigSchema = new mongoose.Schema({
  guildId:        { type: String, required: true, unique: true },
  channelId:      { type: String, default: null },   // salon de publication
  logChannelId:   { type: String, default: null },   // salon de log (modéro)
  moderation:     { type: Boolean, default: false }, // approbation manuelle
  allowImages:    { type: Boolean, default: false },
  cooldownMin:    { type: Number, default: 5 },      // minutes entre confessions
  enabled:        { type: Boolean, default: false },
});

module.exports = {
  Confession:       mongoose.model('Confession', confessionSchema),
  ConfessionConfig: mongoose.model('ConfessionConfig', confessionConfigSchema),
};
