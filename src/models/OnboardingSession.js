const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  questionId: { type: String, required: true },
  answer:     { type: String, default: '' },
}, { _id: false });

const onboardingSessionSchema = new mongoose.Schema({
  guildId:            { type: String, required: true },
  userId:             { type: String, required: true },
  channelId:          { type: String, required: true },
  currentQuestionIdx: { type: Number, default: 0 },
  answers:            { type: [answerSchema], default: [] },
  completed:          { type: Boolean, default: false },
  createdAt:          { type: Date, default: Date.now },
});

onboardingSessionSchema.index({ guildId: 1, userId: 1 }, { unique: true });
onboardingSessionSchema.index({ channelId: 1 });

module.exports = mongoose.models.OnboardingSession || mongoose.model('OnboardingSession', onboardingSessionSchema);
