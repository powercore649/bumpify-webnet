const mongoose = require('mongoose');

const captchaConfigSchema = new mongoose.Schema({
  guildId:         { type: String, required: true, unique: true },
  enabled:         { type: Boolean, default: false },
  channelId:       { type: String, default: null },
  logChannelId:    { type: String, default: null },   // salon de logs configurable
  roleBefore:      { type: String, default: null }, // rôle avant captcha (non-vérifié)
  roleAfter:       { type: String, default: null }, // rôle après captcha (vérifié)
  bypassRoleId:    { type: String, default: null },   // rôle qui saute le captcha entièrement
  security:        { type: String, enum: ['letters', 'numbers', 'mixed', 'math'], default: 'mixed' },
  codeLength:      { type: Number, default: 6 },
  attempts:        { type: Number, default: 3 },    // tentatives avant kick
  kickOnFail:      { type: Boolean, default: true },
  timeout:         { type: Number, default: 10 },   // minutes avant timeout
  imageMode:       { type: Boolean, default: true },  // true = image distordue (recommandé), false = texte brut (repli si canvas indispo)
  caseSensitive:   { type: Boolean, default: false },  // exiger la casse exacte
  maxRegenerations:{ type: Number, default: 2 },       // nombre de fois où un membre peut demander une nouvelle image
  minAccountAgeDays:{ type: Number, default: 0 },      // 0 = désactivé — âge minimum du compte Discord pour accéder au captcha
  dmOnKick:        { type: Boolean, default: false },  // notifier le membre en DM avant expulsion (best-effort)
});

const captchaPendingSchema = new mongoose.Schema({
  userId:     { type: String, required: true },
  guildId:    { type: String, required: true },
  code:       { type: String, required: true },
  attempts:   { type: Number, default: 0 },
  regenerations: { type: Number, default: 0 },
  expiresAt:  { type: Date,   required: true },
  messageId:  { type: String, default: null },
  channelId:  { type: String, default: null },
}, { timestamps: true });

captchaPendingSchema.index({ userId: 1, guildId: 1 }, { unique: true });
captchaPendingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const captchaLogSchema = new mongoose.Schema({
  guildId:  { type: String, required: true },
  userId:   { type: String, required: true },
  action:   { type: String, required: true }, // sent, success, fail, regenerated, timeout, kicked, bypassed, blocked_age
  detail:   { type: String, default: '' },
  date:     { type: Date, default: Date.now },
});
captchaLogSchema.index({ guildId: 1, date: -1 });

module.exports = {
  CaptchaConfig:  mongoose.model('CaptchaConfig',  captchaConfigSchema),
  CaptchaPending: mongoose.model('CaptchaPending', captchaPendingSchema),
  CaptchaLog:     mongoose.model('CaptchaLog', captchaLogSchema),
};
