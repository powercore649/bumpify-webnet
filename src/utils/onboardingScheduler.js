'use strict';
// utils/onboardingScheduler.js — Applique la limite de temps du portail d'accès
const OnboardingSession = require('../models/OnboardingSession');
const OnboardingConfig = require('../models/OnboardingConfig');

let schedulerStarted = false;
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

async function runCheck(client) {
  const sessions = await OnboardingSession.find({ completed: false }).catch(() => []);
  if (!sessions.length) return;

  const configCache = new Map();

  for (const session of sessions) {
    try {
      let cfg = configCache.get(session.guildId);
      if (cfg === undefined) {
        cfg = await OnboardingConfig.findOne({ guildId: session.guildId, enabled: true });
        configCache.set(session.guildId, cfg);
      }
      if (!cfg || cfg.timeoutMinutes <= 0 || cfg.timeoutAction !== 'kick') continue;

      const elapsedMs = Date.now() - new Date(session.createdAt).getTime();
      if (elapsedMs < cfg.timeoutMinutes * 60 * 1000) continue;

      const guild = await client.guilds.fetch(session.guildId).catch(() => null);
      if (!guild) continue;

      const member = await guild.members.fetch(session.userId).catch(() => null);
      const channel = guild.channels.cache.get(session.channelId);

      if (member?.kickable) {
        await member.kick('Portail d\'accès non complété dans le délai imparti').catch(() => {});
      }
      if (channel) {
        await channel.delete('Délai d\'onboarding expiré').catch(() => {});
      }

      cfg.totalTimedOut += 1;
      await cfg.save().catch(() => {});

      await OnboardingSession.deleteOne({ _id: session._id }).catch(() => {});

      console.log(`⏱️ [Onboarding] Expulsion auto (délai dépassé) — ${session.userId} sur ${session.guildId}`);
    } catch (err) {
      console.error('[Onboarding] Scheduler:', err.message);
    }
  }
}

function startOnboardingScheduler(client) {
  if (schedulerStarted) return;
  schedulerStarted = true;

  setTimeout(() => runCheck(client).catch(err => console.error('[Onboarding] Scheduler:', err.message)), 20 * 1000);
  setInterval(() => runCheck(client).catch(err => console.error('[Onboarding] Scheduler:', err.message)), CHECK_INTERVAL_MS);

  console.log('🚪 [Onboarding] Planificateur de délai démarré (vérification toutes les 2 minutes).');
}

module.exports = { startOnboardingScheduler };
