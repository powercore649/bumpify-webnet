// models/License.js — Clé de licence Bumpify.
// Une clé est générée par l'owner du bot (/license-admin générer) puis activée
// par un serveur (/license activer clé:XXXX). Un serveur = une seule licence :
// l'activation remplace toute licence précédemment liée. La licence débloque
// les systèmes phares du bot (bump, inter-serveur, etc. — voir utils/licenseGate).
const mongoose = require('mongoose');

const licenseSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    // Format : BUMP-XXXX-XXXX-XXXX-XXXX
    match: /^BUMP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
  },
  guildId:      { type: String, default: null }, // null = jamais activée
  guildName:    { type: String, default: null }, // mémorisé à l'activation
  activatedBy:  { type: String, default: null }, // ID du membre qui a activé
  activatedAt:  { type: Date,   default: null },
  createdBy:    { type: String, required: true }, // ID de l'owner générateur
  createdAt:    { type: Date,   default: Date.now },
  expiresAt:    { type: Date,   default: null }, // null = illimitée
  note:         { type: String, default: '', maxLength: 200 }, // note libre (ex: "client #42")
  revoked:      { type: Boolean, default: false },
  revokedAt:    { type: Date,   default: null },
  revokedBy:    { type: String, default: null },
  revokedReason:{ type: String, default: '' },
});

// Un serveur ne peut avoir qu'une seule licence active à la fois.
licenseSchema.index(
  { guildId: 1 },
  { unique: true, partialFilterExpression: { guildId: { $type: 'string' } } },
);

module.exports = mongoose.model('License', licenseSchema);
