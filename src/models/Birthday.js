const mongoose = require('mongoose');

const birthdaySchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId:  { type: String, required: true },
  day:     { type: Number, required: true, min: 1, max: 31 },
  month:   { type: Number, required: true, min: 1, max: 12 }, // 1 = janvier
  year:    { type: Number, default: null }, // optionnel, pour l'âge — jamais affiché publiquement sans consentement
  lastAnnouncedYear: { type: Number, default: null }, // évite une double annonce le même jour
});

birthdaySchema.index({ guildId: 1, userId: 1 }, { unique: true });
birthdaySchema.index({ guildId: 1, month: 1, day: 1 }); // pour la recherche rapide des anniversaires du jour

module.exports = mongoose.model('Birthday', birthdaySchema);
