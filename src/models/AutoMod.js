const mongoose = require('mongoose');
const autoModSchema = new mongoose.Schema({
  guildId:          { type: String,  required: true, unique: true },
  spamEnabled:      { type: Boolean, default: false },
  spamThreshold:    { type: Number,  default: 5 },
  spamWindow:       { type: Number,  default: 5000 },
  spamAction:       { type: String,  enum: ['delete','mute','kick','ban'], default: 'delete' },
  spamMuteDuration: { type: Number,  default: 10 },
  raidEnabled:      { type: Boolean, default: false },
  raidThreshold:    { type: Number,  default: 10 },
  raidWindow:       { type: Number,  default: 10000 },
  raidAction:       { type: String,  enum: ['kick','ban','lockdown'], default: 'kick' },
  linksEnabled:     { type: Boolean, default: false },
  linksWhitelist:   { type: [String], default: [] },
  linksAction:      { type: String,  enum: ['delete','warn','mute'], default: 'delete' },
  capsEnabled:      { type: Boolean, default: false },
  capsThreshold:    { type: Number,  default: 70 },
  capsMinLength:    { type: Number,  default: 10 },
  logChannelId:     { type: String,  default: null },
  exemptRoles:      { type: [String], default: [] },
  exemptChannels:   { type: [String], default: [] },

  // ── Raid mode automatique configurable (additif) ──────────────────────────
  raidAutoTrigger:    { type: Boolean, default: false }, // déclenche /raidmode automatiquement si seuil atteint
  raidMinAccountAge:  { type: Number,  default: 0 },      // âge minimum du compte en jours (0 = désactivé) — comptes plus jeunes = action
  raidAutoAction:     { type: String,  enum: ['lock', 'kick_new', 'verify'], default: 'lock' }, // lock = verrouille invites, kick_new = kick comptes trop jeunes, verify = exige vérification
  raidAutoDisableMin: { type: Number,  default: 0 },      // auto-désactivation après N minutes (0 = désactivé)
  raidModeActive:     { type: Boolean, default: false },  // état courant du raid mode auto (séparé du toggle manuel /raidmode)
  raidModeActivatedAt:{ type: Date,    default: null },
});
module.exports = mongoose.model('AutoMod', autoModSchema);
