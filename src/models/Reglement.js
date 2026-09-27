const mongoose = require('mongoose');
const reglementSchema = new mongoose.Schema({
  guildId:    { type: String, required: true, unique: true },
  rules:      { type: [String], default: [] },
  messageId:  { type: String, default: null },
  channelId:  { type: String, default: null },
  acceptRoleId:{ type: String, default: null }, // rôle donné quand on accepte
});
module.exports = mongoose.model('Reglement', reglementSchema);
