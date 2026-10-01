const mongoose = require('mongoose');

const levelRoleSchema = new mongoose.Schema({
  level:  { type: Number, required: true },
  roleId: { type: String, required: true },
}, { _id: false });

const xpConfigSchema = new mongoose.Schema({
  guildId:             { type: String, required: true, unique: true },
  enabled:             { type: Boolean, default: true },
  cooldownSeconds:     { type: Number, default: 60 },
  minXp:               { type: Number, default: 15 },
  maxXp:               { type: Number, default: 25 },
  channelMultipliers:  { type: Map, of: Number, default: () => ({}) },
  roleMultipliers:     { type: Map, of: Number, default: () => ({}) },
  excludedChannels:    { type: [String], default: [] },
  levelRoles:          { type: [levelRoleSchema], default: [] },
  levelUpMessageTemplate: { type: String, default: null }, // {user} {level} — null = comportement par défaut existant
  announceLevelUp:     { type: Boolean, default: true },
  levelUpChannelId:    { type: String, default: null }, // null = salon où le message a été envoyé
  useCardOnLevelUp:    { type: Boolean, default: true },
  cardColor:           { type: String, default: '#8B1A1A' },
  silentChannels:      { type: [String], default: [] }, // XP gagné normalement, mais aucune annonce de level-up si déclenché ici
});

module.exports = mongoose.models.XPConfig || mongoose.model('XPConfig', xpConfigSchema);
