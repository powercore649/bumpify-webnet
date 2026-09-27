const mongoose = require('mongoose');

const ticketConfigSchema = new mongoose.Schema({
  guildId:      { type: String, required: true, unique: true },
  categoryId:   { type: String, default: null },
  logChannelId: { type: String, default: null },
  supportRoleId:{ type: String, default: null },
  enabled:      { type: Boolean, default: false },
  panelMessageId: { type: String, default: null },
  panelChannelId: { type: String, default: null },
});

const ticketSchema = new mongoose.Schema({
  guildId:   { type: String, required: true },
  channelId: { type: String, required: true },
  authorId:  { type: String, required: true },
  number:    { type: Number, required: true },
  subject:   { type: String, default: 'Support' },
  status:    { type: String, enum: ['open','closed'], default: 'open' },
  createdAt: { type: Date, default: Date.now },
  closedAt:  { type: Date, default: null },
  closedBy:  { type: String, default: null },
});
ticketSchema.index({ guildId: 1, number: 1 });
ticketSchema.index({ channelId: 1 }, { unique: true });

module.exports = {
  TicketConfig: mongoose.model('TicketConfig', ticketConfigSchema),
  Ticket:       mongoose.model('Ticket', ticketSchema),
};
