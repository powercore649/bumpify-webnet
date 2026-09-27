const { resetWeeklyBumps, resetMonthlyBumps, resetDailyVotes } = require('../../utils/bumpNetwork');
const { syncApplicationEmojis } = require('../../utils/emojiSync');
const { applyBotStatus } = require('../../utils/botStatus');

const MAX_TIMEOUT_MS = 2_147_483_647;

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`✅ ${client.user.tag} en ligne sur ${client.guilds.cache.size} serveur(s)`);

    // ── Blacklist globale — charge le cache puis expulse les serveurs déjà rejoints ──
    try {
      const blacklist = require('../../utils/blacklist');
      await blacklist.initCache();
      for (const guild of client.guilds.cache.values()) {
        if (blacklist.isBlacklisted(guild.id)) {
          console.warn(`⛔ ${guild.name} (${guild.id}) blacklisté — départ automatique.`);
          await guild.leave().catch(() => {});
        }
      }
    } catch (err) {
      console.error('blacklist init:', err.message);
    }

    // ── Emojis custom de l'application — synchro auto avec le Developer Portal ─
    syncApplicationEmojis(client).catch((err) => console.error('emojiSync:', err.message));

    // ── Statut du bot — config persistée, modifiable via /status ─────────
    await applyBotStatus(client);

    // ── Rappels de bump — gérés uniquement via cron dans index.js (5 min) ──
    // (auparavant dupliqué ici avec un second setInterval, ce qui causait des
    // rappels envoyés en double à quelques minutes d'écart — supprimé.)

    // ── Unban automatique (tempban) — toutes les minutes ─────────────────
    setInterval(async () => {
      try {
        const TempBan = require('../../models/TempBan');
        const bans = await TempBan.find({ done: false, unbanAt: { $lte: new Date() } });
        for (const ban of bans) {
          const guild = client.guilds.cache.get(ban.guildId);
          if (!guild) { ban.done = true; await ban.save(); continue; }
          await guild.members.unban(ban.userId, 'TempBan expiré').catch(() => {});
          ban.done = true;
          await ban.save();
          console.log(`✅ Unban auto : ${ban.userId} sur ${ban.guildId}`);
        }
      } catch (err) {
        console.error('unban auto:', err.message);
      }
    }, 60_000);

    // ── Reprendre les rappels utilisateur en attente (survie redémarrage) ─
    setTimeout(async () => {
      try {
        const Reminder = require('../../models/Reminder');
        const pending  = await Reminder.find({ done: false, remindAt: { $gt: new Date() } });
        for (const rem of pending) {
          const delay = new Date(rem.remindAt).getTime() - Date.now();
          if (delay <= 0) { rem.done = true; await rem.save(); continue; }
          if (delay > MAX_TIMEOUT_MS) continue;
          setTimeout(async () => {
            try {
              const user = await client.users.fetch(rem.userId);
              await user.send({ content: `⏰ **Rappel :** ${rem.message}` });
            } catch {
              const ch = client.channels.cache.get(rem.channelId);
              if (ch) ch.send({ content: `<@${rem.userId}> ⏰ Rappel : **${rem.message}**` }).catch(() => {});
            }
            await Reminder.findByIdAndUpdate(rem._id, { done: true });
          }, delay);
        }
        if (pending.length) console.log(`✅ ${pending.length} rappel(s) repris`);
      } catch (err) {
        console.error('reminders reprise:', err.message);
      }
    }, 5_000);

    // ── Territoires : décroissance power — toutes les 30 min ─────────────
    try {
      const { ensureMapInitialized, decayPower } = require('../../utils/territoryEngine');
      await ensureMapInitialized().catch(console.error);
      setInterval(() => decayPower().catch(console.error), 30 * 60 * 1000);
    } catch (err) {
      console.error('territoryEngine init:', err.message);
    }

    // ── Nettoyage inter-serveur webhooks inactifs — toutes les heures ────
    setInterval(async () => {
      try {
        const InterServer = require('../../models/InterServer');
        await InterServer.updateMany(
          { active: false, webhookId: { $ne: null } },
          { $set: { webhookId: null, webhookToken: null } }
        );
      } catch (err) {
        console.error('cleanup webhooks:', err.message);
      }
    }, 60 * 60 * 1000);

    // ── Resets planifiés sans overflow 32-bit ─────────────────────────────
    scheduleCron(client);

    // ── FreeGames — Scheduler autonome (post quotidien + catch-up) ────────
    setTimeout(() => {
      try {
        const { startFreeGamesScheduler } = require('../../utils/freeGamesScheduler');
        startFreeGamesScheduler(client);
      } catch (err) {
        console.error('freeGamesScheduler:', err.message);
      }
    }, 10_000); // Attendre 10s que MongoDB soit prêt

    // ── Reddit — Planificateur autonome (annonces automatiques) ───────────
    setTimeout(() => {
      try {
        const { startRedditScheduler } = require('../../utils/redditScheduler');
        startRedditScheduler(client);
      } catch (err) {
        console.error('redditScheduler:', err.message);
      }
    }, 12_000);

    // ── StreamAlerts — Planificateur Twitch (2 min) & YouTube (5 min) ─────
    setTimeout(() => {
      try {
        const { startStreamAlertScheduler } = require('../../utils/streamAlertScheduler');
        startStreamAlertScheduler(client);
      } catch (err) {
        console.error('streamAlertScheduler:', err.message);
      }
    }, 16_000);

    // ── Onboarding — Planificateur du délai limite ─────────────────────────
    setTimeout(() => {
      try {
        const { startOnboardingScheduler } = require('../../utils/onboardingScheduler');
        startOnboardingScheduler(client);
      } catch (err) {
        console.error('onboardingScheduler:', err.message);
      }
    }, 14_000);

    // ── News — vérification toutes les 15 minutes ────────────────────────
    setTimeout(() => {
      const runNews = async () => {
        try {
          const { autoPostNews } = require('../../commands/communaute/news');
          await autoPostNews(client);
        } catch(err) { console.error('[News] scheduler:', err.message); }
      };
      runNews();
      setInterval(runNews, 15 * 60 * 1000);
    }, 20_000);

    // ── Nettoyage des configs pointant vers salons/rôles supprimés ───────
    setTimeout(() => {
      try {
        const { cleanupStaleData } = require('../../utils/startupCleanup');
        cleanupStaleData(client)
          .then((s) => {
            if (s.channelsCleared || s.rolesCleared || s.docsDeleted) {
              console.log(`🧹 Nettoyage démarrage : ${s.channelsCleared} salon(s), ${s.rolesCleared} rôle(s), ${s.docsDeleted} doc(s) obsolète(s)`);
            }
          })
          .catch((err) => console.error('startupCleanup:', err.message));
      } catch (err) {
        console.error('startupCleanup:', err.message);
      }
    }, 30_000);

    // ── Préfixe hybride — amorçage du cache des configs activées ────────
    try {
      const { initCache } = require('../../utils/prefixCommands');
      await initCache(client);
    } catch (err) {
      console.error('prefixCommands init:', err.message);
    }

    // ── Invitations avancées : amorçage du cache pour chaque serveur ─────
    try {
      const { primeGuildCache } = require('../../utils/inviteCache');
      for (const guild of client.guilds.cache.values()) {
        primeGuildCache(guild).catch(err =>
          console.error(`[inviteCache] amorçage échoué pour ${guild.id}:`, err.message));
      }
      console.log(`✅ Cache d'invitations amorcé pour ${client.guilds.cache.size} serveur(s)`);
    } catch (err) {
      console.error('inviteCache amorçage:', err.message);
    }

    console.log('✅ Tâches planifiées démarrées');
  },
};

// ─── Cron maison — vérifie toutes les minutes, jamais d'overflow 32-bit ──────
function scheduleCron(client) {
  let lastWeeklyReset   = null; // "YYYY-Www"
  let lastMonthlyReset  = null; // "YYYY-MM"
  let lastDailyReset    = null; // "YYYY-MM-DD"

  setInterval(async () => {
    const now  = new Date();
    const h    = now.getUTCHours();
    const m    = now.getUTCMinutes();
    const day  = now.getUTCDay();
    const dom  = now.getUTCDate();

    const weekKey  = `${now.getUTCFullYear()}-W${isoWeek(now)}`;
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const dayKey   = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(dom).padStart(2, '0')}`;

    // ── Reset votes quotidiens — 00:00 UTC ───────────────────────────────
    if (h === 0 && m === 0 && lastDailyReset !== dayKey) {
      lastDailyReset = dayKey;
      console.log('🔄 Reset votes quotidiens...');
      await resetDailyVotes().catch(err => console.error('resetDailyVotes:', err.message));
    }

    // ── Reset bumps hebdomadaires — lundi 00:00 UTC ───────────────────────
    if (day === 1 && h === 0 && m === 0 && lastWeeklyReset !== weekKey) {
      lastWeeklyReset = weekKey;
      console.log('🔄 Reset bumps hebdomadaires...');
      await resetWeeklyBumps().catch(err => console.error('resetWeeklyBumps:', err.message));
    }

    // ── Reset bumps mensuels — 1er du mois 00:00 UTC ─────────────────────
    if (dom === 1 && h === 0 && m === 0 && lastMonthlyReset !== monthKey) {
      lastMonthlyReset = monthKey;
      console.log('🔄 Reset bumps mensuels...');
      await resetMonthlyBumps().catch(err => console.error('resetMonthlyBumps:', err.message));
    }

  }, 60_000); // vérification toutes les 60s — jamais d'overflow 32-bit
}

// ─── Numéro de semaine ISO 8601 ───────────────────────────────────────────────
function isoWeek(date) {
  const d   = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
