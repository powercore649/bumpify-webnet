'use strict';
// utils/redditScheduler.js — Planificateur autonome des annonces Reddit
const RedditWatch = require('../models/RedditWatch');
const { checkAndPost } = require('./redditWatcher');

let schedulerStarted = false;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — raisonnable pour l'API publique de Reddit

async function runCheck(client) {
  const watches = await RedditWatch.find({ enabled: true }).catch(() => []);
  for (const cfg of watches) {
    try {
      const posted = await checkAndPost(client, cfg);
      if (posted > 0) {
        console.log(`✅ [Reddit] ${posted} nouveau(x) post(s) → r/${cfg.subreddit} (${cfg.guildId})`);
      }
    } catch (err) {
      console.error(`[Reddit] Erreur suivi r/${cfg.subreddit}:`, err.message);
    }
    // Petite pause entre chaque subreddit pour rester correct vis-à-vis de l'API Reddit
    await new Promise(r => setTimeout(r, 1500));
  }
}

function startRedditScheduler(client) {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Premier passage différé pour laisser le bot finir de démarrer
  setTimeout(() => runCheck(client).catch(err => console.error('[Reddit] Scheduler:', err.message)), 30 * 1000);

  setInterval(() => {
    runCheck(client).catch(err => console.error('[Reddit] Scheduler:', err.message));
  }, CHECK_INTERVAL_MS);

  console.log('🟠 [Reddit] Planificateur démarré (vérification toutes les 5 minutes).');
}

module.exports = { startRedditScheduler };
