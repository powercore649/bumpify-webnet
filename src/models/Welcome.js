const mongoose = require('mongoose');

const welcomeSchema = new mongoose.Schema({
  guildId:      { type: String, required: true, unique: true },
  enabled:      { type: Boolean, default: false },
  channelId:    { type: String, default: null },
  message:      { type: String, default: 'Bienvenue {user} sur {server}!' },
  backgroundUrl: { type: String, default: null },
});

const farewellSchema = new mongoose.Schema({
  guildId:      { type: String, required: true, unique: true },
  enabled:      { type: Boolean, default: false },
  channelId:    { type: String, default: null },
  message:      { type: String, default: '{user} a quitté le serveur.' },
});

module.exports = {
  Welcome: mongoose.model('Welcome', welcomeSchema),
  Farewell: mongoose.model('Farewell', farewellSchema),
};
