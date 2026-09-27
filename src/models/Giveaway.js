const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  userId:   { type: String, required: true },
  joinedAt: { type: Date, default: Date.now },
  entries:  { type: Number, default: 1 }, // poids dans le tirage (1 + bonus de rôle)
}, { _id: false });

const bonusRoleSchema = new mongoose.Schema({
  roleId:  { type: String, required: true },
  entries: { type: Number, required: true }, // entrées supplémentaires accordées par ce rôle
}, { _id: false });

const giveawaySchema = new mongoose.Schema({
  guildId:        { type: String, required: true },
  channelId:      { type: String, required: true },
  messageId:      { type: String, default: null },
  hostId:         { type: String, required: true },
  prize:          { type: String, required: true },
  winners:        { type: Number, default: 1 },
  participants:   { type: [participantSchema], default: [] },
  requiredRoleId: { type: String, default: null }, // rôle obligatoire pour participer
  bonusRoles:     { type: [bonusRoleSchema], default: [] }, // entrées bonus par rôle
  endAt:          { type: Date, required: true },
  ended:          { type: Boolean, default: false },
  winnerIds:      { type: [String], default: [] },
});
giveawaySchema.index({ ended: 1, endAt: 1 });

module.exports = mongoose.models.Giveaway || mongoose.model('Giveaway', giveawaySchema);
