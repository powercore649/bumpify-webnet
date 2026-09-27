const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  id:       { type: String, required: true }, // identifiant court stable (ex: "q_1699999999")
  type:     { type: String, enum: ['text', 'choice'], default: 'text' },
  prompt:   { type: String, required: true },
  choices:  { type: [String], default: [] },   // utilisé seulement si type = "choice"
  required: { type: Boolean, default: true },  // si false, l'utilisateur peut passer (bouton "Passer")
}, { _id: false });

const onboardingConfigSchema = new mongoose.Schema({
  guildId:              { type: String, required: true, unique: true },
  enabled:              { type: Boolean, default: false },

  categoryId:           { type: String, default: null }, // catégorie où créer les salons d'accueil
  unverifiedRoleId:      { type: String, default: null }, // rôle appliqué à l'arrivée (accès restreint)
  accessRoleId:          { type: String, default: null }, // rôle donné à la fin (optionnel — sinon on retire juste le rôle non-vérifié)

  welcomeMessage:        { type: String, default: 'Bienvenue {user} ! Réponds aux quelques questions ci-dessous pour accéder au serveur.' },
  completionMessage:     { type: String, default: '✅ Merci {user}, tu as maintenant accès au serveur !' },

  deleteChannelOnComplete: { type: Boolean, default: true },
  timeoutMinutes:        { type: Number, default: 0, min: 0, max: 10080 }, // 0 = pas de limite de temps
  timeoutAction:         { type: String, enum: ['kick', 'none'], default: 'kick' },

  questions:             { type: [questionSchema], default: [] },

  totalCompleted:        { type: Number, default: 0 },
  totalTimedOut:         { type: Number, default: 0 },
});

module.exports = mongoose.models.OnboardingConfig || mongoose.model('OnboardingConfig', onboardingConfigSchema);
