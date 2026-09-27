'use strict';
// utils/aiChat.js — Logique centrale du chat IA, partagée entre le mode salon
// (messageCreate) et la commande /ia chat.

const AiConfig       = require('../models/AiConfig');
const AiConversation = require('../models/AiConversation');
const AiDailyStats   = require('../models/AiDailyStats');
const gemini          = require('./geminiClient');

const cooldowns = new Map(); // userId -> timestamp du dernier message (anti-spam, en mémoire)
const COOLDOWN_MS = 3000;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function isOnCooldown(userId) {
  const last = cooldowns.get(userId);
  if (last && Date.now() - last < COOLDOWN_MS) return true;
  cooldowns.set(userId, Date.now());
  return false;
}

// ─── Vérifie si un membre est autorisé à parler à l'IA sur ce serveur ─────
function checkAccess(cfg, member) {
  if (cfg.blockedUserIds.includes(member.id)) return { allowed: false, reason: 'blocked' };
  if (cfg.allowedRoleIds.length > 0) {
    const hasRole = member.roles.cache.some((r) => cfg.allowedRoleIds.includes(r.id));
    if (!hasRole) return { allowed: false, reason: 'role' };
  }
  return { allowed: true };
}

// ─── Récupère (ou crée) la conversation d'un utilisateur ──────────────────
async function getConversation(guildId, userId) {
  let convo = await AiConversation.findOne({ guildId, userId });
  if (!convo) convo = await AiConversation.create({ guildId, userId, messages: [] });
  return convo;
}

// ─── Traite un message utilisateur : appelle Gemini, met à jour mémoire + stats ──
// Retourne { text, model, responseMs } en cas de succès, ou lève une erreur lisible.
async function processMessage({ guild, member, content }) {
  if (!gemini.isConfigured()) {
    throw new Error('Le système IA n\'est pas configuré (GEMINI_API_KEY manquant dans le .env).');
  }

  const cfg = await AiConfig.findOne({ guildId: guild.id });
  if (!cfg || !cfg.enabled) throw new Error('Le chat IA n\'est pas activé sur ce serveur.');

  // ── Verrou quota : auto-déverrouillage si le délai est passé ────────────
  if (cfg.locked && cfg.lockedUntil && cfg.lockedUntil.getTime() <= Date.now()) {
    cfg.locked = false;
    cfg.lockedUntil = null;
    await cfg.save();
  }
  if (cfg.locked) {
    const ts = Math.floor(cfg.lockedUntil.getTime() / 1000);
    throw new Error(`🔒 Le chat IA est temporairement verrouillé (quota Gemini atteint). Réessaie <t:${ts}:R>.`);
  }

  const access = checkAccess(cfg, member);
  if (!access.allowed) throw new Error(access.reason === 'blocked' ? 'Tu n\'es pas autorisé à utiliser le chat IA.' : 'Tu n\'as pas le rôle requis pour utiliser le chat IA.');

  if (isOnCooldown(member.id)) throw new Error('Trop rapide ! Attends quelques secondes entre deux messages.');

  const convo = await getConversation(guild.id, member.id);

  // Limite quotidienne : on compte les messages 'user' de la conversation postés aujourd'hui
  if (cfg.dailyLimitPerUser > 0) {
    const todayStr = todayKey();
    const usedToday = convo.messages.filter((m) => m.role === 'user' && m.ts.toISOString().slice(0, 10) === todayStr).length;
    if (usedToday >= cfg.dailyLimitPerUser) {
      throw new Error(`Limite quotidienne atteinte (${cfg.dailyLimitPerUser} messages/jour). Réessaie demain !`);
    }
  }

  // Historique borné (les N derniers échanges pour limiter le coût en tokens)
  const maxMessages = Math.max(1, cfg.maxHistoryPairs) * 2;
  const history = convo.messages.slice(-maxMessages).map((m) => ({ role: m.role, text: m.text }));

  const genArgs = { systemPrompt: cfg.systemPrompt, history, userMessage: content, temperature: cfg.temperature };

  let result;
  let usedModel = cfg.model;
  try {
    result = await gemini.generateReply({ ...genArgs, model: cfg.model });
  } catch (err) {
    if (!err.isQuotaError) {
      await bumpStats(guild.id, member.id, { error: true });
      cfg.totalErrors += 1;
      await cfg.save();
      throw err;
    }

    // ── Quota dépassé sur le modèle principal ──────────────────────────
    cfg.quotaHits += 1;

    if (cfg.quotaFallbackMode === 'switch_model') {
      const fallbackModel = gemini.getFallbackModel(cfg.model);
      try {
        result = await gemini.generateReply({ ...genArgs, model: fallbackModel });
        usedModel = fallbackModel;
        await cfg.save(); // persiste quotaHits même en cas de succès du repli
      } catch (err2) {
        await bumpStats(guild.id, member.id, { error: true });
        cfg.totalErrors += 1;
        if (err2.isQuotaError) {
          // Le modèle de secours est LUI AUSSI en quota → on verrouille pour de vrai
          cfg.locked = true;
          cfg.lockedUntil = new Date(Date.now() + cfg.lockDurationMinutes * 60000);
          await cfg.save();
          throw new Error(`🔒 Quota atteint sur tous les modèles disponibles. Chat verrouillé, réessaie <t:${Math.floor(cfg.lockedUntil.getTime() / 1000)}:R>.`);
        }
        await cfg.save();
        throw err2;
      }
    } else {
      // Mode 'lock_channel' : on verrouille directement sans tenter de repli
      cfg.locked = true;
      cfg.lockedUntil = new Date(Date.now() + cfg.lockDurationMinutes * 60000);
      await bumpStats(guild.id, member.id, { error: true });
      await cfg.save();
      throw new Error(`🔒 Quota Gemini atteint. Chat verrouillé, réessaie <t:${Math.floor(cfg.lockedUntil.getTime() / 1000)}:R>.`);
    }
  }

  // Sauvegarde de l'historique (borné pour éviter une croissance infinie du document)
  convo.messages.push({ role: 'user', text: content, ts: new Date() });
  convo.messages.push({ role: 'model', text: result.text, ts: new Date() });
  const hardCap = maxMessages + 20; // marge avant troncature définitive
  if (convo.messages.length > hardCap) convo.messages = convo.messages.slice(-hardCap);
  convo.updatedAt = new Date();
  await convo.save();

  // Mise à jour des compteurs globaux + moyenne glissante du temps de réponse
  cfg.totalMessages += 1;
  cfg.totalTokensIn  += result.tokensIn;
  cfg.totalTokensOut += result.tokensOut;
  cfg.avgResponseMs   = cfg.avgResponseMs === 0
    ? result.responseMs
    : Math.round(cfg.avgResponseMs * 0.9 + result.responseMs * 0.1); // moyenne glissante
  cfg.lastUsedAt = new Date();
  await cfg.save();

  await bumpStats(guild.id, member.id, { tokensIn: result.tokensIn, tokensOut: result.tokensOut });

  return { text: result.text, model: usedModel, responseMs: result.responseMs };
}

// ─── Met à jour le document de stats journalières (créé à la volée) ───────
async function bumpStats(guildId, userId, { tokensIn = 0, tokensOut = 0, error = false } = {}) {
  const date = todayKey();
  const update = {
    $inc: {
      messageCount: error ? 0 : 1,
      tokensIn,
      tokensOut,
      errorCount: error ? 1 : 0,
    },
  };
  if (!error) update.$addToSet = { uniqueUsers: userId };
  await AiDailyStats.findOneAndUpdate({ guildId, date }, update, { upsert: true }).catch(() => {});
}

// ─── Réinitialise la mémoire de conversation d'un utilisateur ────────────
async function resetConversation(guildId, userId) {
  await AiConversation.findOneAndUpdate({ guildId, userId }, { messages: [], updatedAt: new Date() }, { upsert: true });
}

module.exports = {
  todayKey,
  getConversation,
  processMessage,
  resetConversation,
  bumpStats,
};
