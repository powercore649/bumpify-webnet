const mongoose = require('mongoose');

const permissionOverwriteSchema = new mongoose.Schema({
  id:    { type: String, required: true },
  type:  { type: Number, required: true }, // 0 = role, 1 = member
  allow: { type: String, required: true }, // BigInt as string
  deny:  { type: String, required: true },
}, { _id: false });

const channelSchema = new mongoose.Schema({
  id:              { type: String, required: true },
  name:            { type: String, required: true },
  type:            { type: Number, required: true },
  position:        { type: Number, default: 0 },
  parentId:        { type: String, default: null },
  topic:           { type: String, default: null },
  nsfw:            { type: Boolean, default: false },
  rateLimitPerUser:{ type: Number, default: 0 },
  bitrate:         { type: Number, default: null },
  userLimit:       { type: Number, default: null },
  permissionOverwrites: { type: [permissionOverwriteSchema], default: [] },
}, { _id: false });

const roleSchema = new mongoose.Schema({
  id:          { type: String, required: true },
  name:        { type: String, required: true },
  color:       { type: Number, default: 0 },
  hoist:       { type: Boolean, default: false },
  position:    { type: Number, default: 0 },
  permissions: { type: String, required: true }, // BigInt as string
  mentionable: { type: Boolean, default: false },
  managed:     { type: Boolean, default: false },
}, { _id: false });

const emojiSchema = new mongoose.Schema({
  id:       { type: String, required: true },
  name:     { type: String, required: true },
  animated: { type: Boolean, default: false },
  url:      { type: String, required: true },
}, { _id: false });

const serverBackupSchema = new mongoose.Schema({
  // Identifiants
  guildId:     { type: String, required: true },
  createdBy:   { type: String, required: true },
  name:        { type: String, required: true }, // Nom de la backup
  backupId:    { type: String, required: true, unique: true },

  // Infos serveur
  guildName:   { type: String, required: true },
  guildIcon:   { type: String, default: null },
  description: { type: String, default: null },
  verificationLevel: { type: Number, default: 0 },
  explicitContentFilter: { type: Number, default: 0 },
  defaultMessageNotifications: { type: Number, default: 0 },
  afkTimeout:  { type: Number, default: 300 },
  preferredLocale: { type: String, default: 'en-US' },

  // Contenu
  roles:    { type: [roleSchema],    default: [] },
  channels: { type: [channelSchema], default: [] },
  emojis:   { type: [emojiSchema],   default: [] },

  // Métadonnées
  createdAt:   { type: Date, default: Date.now },
  size: {
    roles:    { type: Number, default: 0 },
    channels: { type: Number, default: 0 },
    emojis:   { type: Number, default: 0 },
  },
});

serverBackupSchema.index({ guildId: 1, createdAt: -1 });

module.exports = mongoose.model('ServerBackup', serverBackupSchema);
