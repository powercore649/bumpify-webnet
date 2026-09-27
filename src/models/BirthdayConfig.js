const mongoose = require('mongoose');

const birthdayConfigSchema = new mongoose.Schema({
  guildId:      { type: String,  required: true, unique: true },
  enabled:      { type: Boolean, default: false },
  channelId:    { type: String,  default: null },
  roleId:       { type: String,  default: null }, // rôle "🎂 Anniversaire" donné pour la journée (optionnel)
  pingRoleId:   { type: String,  default: null }, // rôle à mentionner dans l'annonce (optionnel)
  message:      { type: String,  default: "🎉 Joyeux anniversaire {user} ! Toute l'équipe de {server} te souhaite une excellente journée !" },
});

module.exports = mongoose.model('BirthdayConfig', birthdayConfigSchema);
