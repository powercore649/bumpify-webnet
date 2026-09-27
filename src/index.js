require('dotenv').config();

const { Client, GatewayIntentBits, Partials, Collection, REST, Routes } = require('discord.js');
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');
const cron     = require('node-cron');

// ── Validation des variables d'environnement ────────────────────────────────
const TOKEN        = process.env.TOKEN;
const MONGODB_URI  = process.env.MONGODB_URI;

if (!TOKEN)       { console.error('❌ TOKEN manquant dans .env'); process.exit(1); }
if (!MONGODB_URI) { console.error('❌ MONGODB_URI manquant dans .env'); process.exit(1); }
if (!process.env.OWNER_IDS) {
  console.warn('⚠️  OWNER_IDS non défini dans .env — /premium-admin sera inaccessible.');
}
if (!process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET) {
  console.warn('⚠️  REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET non définis dans .env — /reddit-annonce ne pourra pas se connecter à Reddit.');
}

// ── Client Discord ──────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,        // ← REQUIS pour /botwatch
    GatewayIntentBits.DirectMessages,       // ← REQUIS pour ModMail
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.GuildMessageReactions, // ← REQUIS pour le Starboard
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.Reaction,                       // ← REQUIS pour le Starboard (réactions sur messages non cachés)
  ],
});
client.commands = new Collection();

// ── Chargement récursif des fichiers .js d'un dossier (sous-dossiers inclus) ─
function getJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return getJsFiles(full);
    if (entry.name.endsWith('.js')) return [full];
    return [];
  });
}

// ── Chargement des commandes (src/commands/<categorie>/<commande>.js) ──────
const commandsPath = path.join(__dirname, 'commands');
const commandData  = [];

for (const file of getJsFiles(commandsPath)) {
  try {
    const cmd = require(file);
    if (cmd.data && cmd.execute) {
      client.commands.set(cmd.data.name, cmd);
      commandData.push(cmd.data.toJSON());
      console.log(`✅ Commande chargée: /${cmd.data.name} (${path.relative(commandsPath, path.dirname(file))})`);
    }
  } catch (err) {
    console.error(`❌ Erreur chargement commande ${file}:`, err.message);
  }
}

// ── Chargement des événements (src/events/<type>/<event>.js) ────────────────
const eventsPath = path.join(__dirname, 'events');
for (const file of getJsFiles(eventsPath)) {
  try {
    const event = require(file);
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }
    console.log(`✅ Événement chargé: ${event.name} (${path.relative(eventsPath, file)})`);
  } catch (err) {
    console.error(`❌ Erreur chargement event ${file}:`, err.message);
  }
}

// ── MongoDB ─────────────────────────────────────────────────────────────────
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => { console.error('❌ MongoDB:', err.message); process.exit(1); });

// ── Déploiement des slash commands après connexion ──────────────────────────
client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('🔄 Déploiement des slash commands (global)...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commandData });
    console.log(`✅ ${commandData.length} commande(s) déployée(s) (global — visible partout sous ~1h max)`);
  } catch (err) {
    console.error('❌ Erreur déploiement:', err.message);
  }

  // ── Déploiement instantané sur un serveur de test (DEV_GUILD_ID dans .env) ──
  if (process.env.DEV_GUILD_ID) {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.DEV_GUILD_ID), { body: commandData });
      console.log(`⚡ ${commandData.length} commande(s) déployée(s) instantanément sur le serveur de test (${process.env.DEV_GUILD_ID})`);
    } catch (err) {
      console.error('❌ Déploiement serveur de test:', err.message);
    }
  }
});

// ── Rappels automatiques (vérification toutes les 5 minutes) ────────────────
const { sendBumpReminders, resetDailyVotes } = require('./utils/bumpNetwork');
cron.schedule('*/5 * * * *', () => sendBumpReminders(client).catch(console.error));

// ── Reset votes quotidiens (minuit chaque jour) ──────────────────────────────
cron.schedule('0 0 * * *', () => resetDailyVotes().catch(console.error));

// ── Anniversaires (vérification quotidienne à 9h) ────────────────────────────
const { checkBirthdays } = require('./utils/birthdayScheduler');
cron.schedule('0 9 * * *', () => checkBirthdays(client).catch(console.error));

// ── Leaderboard auto-post configurable ───────────────────────────────────────
cron.schedule('* * * * *', async () => {
  try {
    const { postScheduledLeaderboards } = require('./commands/bump-reseau/leaderboard');
    await postScheduledLeaderboards(client);
  } catch (err) { console.error('❌ leaderboard auto-post:', err.message); }
});

// ── Gestion des erreurs non capturées ───────────────────────────────────────
process.on('unhandledRejection', err => {
  // Ignore/Log proprement les micro-coupures réseau vers Discord / Cloudflare
  if (err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT' || err?.name === 'AggregateError') {
    console.warn(`⚠️ Perturbation réseau temporaire (${err.code || err.name}). Nouvelle tentative automatique...`);
    return;
  }
  console.error('❌ UnhandledRejection:', err);
});

process.on('uncaughtException', err => console.error('❌ UncaughtException:', err));

// ── Serveur web (transcripts publics des suggestions) ────────────────────────
client.once('ready', () => {
  const { startWebServer } = require('./web/server');
  startWebServer(client);
});

// ── Connexion sécurisée avec retry auto ──────────────────────────────────────
async function loginWithRetry() {
  try {
    await client.login(TOKEN);
  } catch (err) {
    console.error(`❌ Échec de connexion initiale à Discord (${err.code || err.message}). Nouvelle tentative dans 5s...`);
    setTimeout(loginWithRetry, 5000);
  }
}

loginWithRetry();