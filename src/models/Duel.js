const mongoose = require('mongoose');
const duelSchema = new mongoose.Schema({
  guildId:    { type: String, required: true },
  player1Id:  { type: String, required: true },
  player2Id:  { type: String, required: true },
  hp1:        { type: Number, default: 100 },
  hp2:        { type: Number, default: 100 },
  turn:       { type: String, default: null }, // userId du joueur dont c'est le tour
  status:     { type: String, enum: ['pending','active','finished'], default: 'pending' },
  winnerId:   { type: String, default: null },
  wager:      { type: Number, default: 0 }, // mise en coins
  createdAt:  { type: Date, default: Date.now },
});
module.exports = mongoose.model('Duel', duelSchema);
