const mongoose = require('mongoose');

const inviteConfigSchema = new mongoose.Schema({
  guildId:        { type: String, required: true, unique: true },
  enabled:        { type: Boolean, default: true },

  // Salon où annoncer les arrivées/départs avec la source d'invitation
  announceChannelId: { type: String, default: null },
  announceJoin:      { type: Boolean, default: true },
  announceLeave:     { type: Boolean, default: true },

  // Messages personnalisables. Placeholders :
  // {user} {server} {inviter} {inviterTag} {code} {count} {totalInvites}
  joinMessage:  { type: String, default: '{user} a rejoint en utilisant l\'invitation de **{inviter}** (\`{code}\`) — {inviter} totalise maintenant **{totalInvites}** invitation(s).' },
  joinMessageUnknown: { type: String, default: '{user} a rejoint le serveur, mais l\'invitation utilisée n\'a pas pu être déterminée (lien vanity, invitation supprimée, ou ajout via bot).' },
  leaveMessage: { type: String, default: '{user} a quitté le serveur (invité à l\'origine par **{inviter}** via \`{code}\`).' },

  // Rôles bonus débloqués automatiquement à partir de N invitations valides (net = joins - leaves - fake)
  rewardRoles: [{
    roleId: { type: String, required: true },
    threshold: { type: Number, required: true },
  }],

  // Anti-fake-invite : âge minimum du compte (en jours) pour qu'une invitation soit comptée comme "valide"
  minAccountAgeDays: { type: Number, default: 0 },

  // Codes d'invitation exclus du tracking (ex: invitation d'un partenaire qu'on ne veut pas comptabiliser)
  ignoredCodes: [{ type: String }],

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

inviteConfigSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('InviteConfig', inviteConfigSchema);
