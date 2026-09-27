'use strict';
// utils/aiService.js — Appelle Gemini via @google/genai, avec bascule automatique de
// modèle en cas de quota dépassé, et suivi persistant de l'état de chaque modèle
// (partagé par tout le bot, car une seule clé API = un seul quota).

const AiModelStatus = require('../models/AiModelStatus');
const { isQuotaError, computeCooldownUntil, pickAvailableModel } = require('./aiQuotaEngine');

let genAIClient = null;
function getClient() {
  if (genAIClient) return genAIClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY manquant dans .env');
  const { GoogleGenAI } = require('@google/genai');
  genAIClient = new GoogleGenAI({ apiKey });
  return genAIClient;
}

async function getStatusMap(modelChain) {
  const rows = await AiModelStatus.find({ modelName: { $in: modelChain } }).lean();
  const map = {};
  for (const r of rows) map[r.modelName] = r;
  return map;
}

async function markModelCooldown(modelName, errMessage) {
  const until = computeCooldownUntil();
  await AiModelStatus.findOneAndUpdate(
    { modelName },
    { unavailableUntil: until, lastError: String(errMessage).slice(0, 300), lastCheckedAt: new Date() },
    { upsert: true },
  );
  return until;
}

async function markModelHealthy(modelName) {
  await AiModelStatus.findOneAndUpdate(
    { modelName },
    { unavailableUntil: null, lastCheckedAt: new Date() },
    { upsert: true },
  );
}

/**
 * Envoie un prompt à l'IA en essayant chaque modèle de la chaîne dans l'ordre,
 * en sautant automatiquement ceux actuellement en cooldown de quota.
 *
 * @param {string} prompt
 * @param {string[]} modelChain
 * @returns {Promise<{ ok: true, text: string, modelUsed: string } | { ok: false, allExhausted: true, soonestAvailable?: string, soonestAt?: Date } | { ok: false, allExhausted: false, error: string }>}
 */
async function askAI(prompt, modelChain) {
  const statusMap = await getStatusMap(modelChain);
  const now = new Date();

  // Ordre d'essai : on part du modèle "préféré" disponible, puis on tente les suivants
  // de la chaîne en cas d'échec en cours de route (ex: quota atteint pile à cet instant).
  const { model: startModel, allExhausted, soonestAvailable, soonestAt } = pickAvailableModel(modelChain, statusMap, now);
  if (allExhausted) {
    return { ok: false, allExhausted: true, soonestAvailable, soonestAt };
  }

  const startIndex = modelChain.indexOf(startModel);
  const tryOrder = [...modelChain.slice(startIndex), ...modelChain.slice(0, startIndex)];

  let lastError = null;
  for (const model of tryOrder) {
    // Un modèle déjà marqué en cooldown (autre que le premier choisi) est sauté sans appel réseau
    const status = statusMap[model];
    if (status?.unavailableUntil && new Date(status.unavailableUntil) > now && model !== startModel) continue;

    try {
      const client = getClient();
      const response = await client.models.generateContent({ model, contents: prompt });
      const text = response?.text ?? response?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      if (!text) throw new Error('Réponse vide reçue du modèle.');

      await markModelHealthy(model);
      return { ok: true, text, modelUsed: model };
    } catch (err) {
      lastError = err;
      if (isQuotaError(err)) {
        await markModelCooldown(model, err.message);
        continue; // essaie le modèle suivant de la chaîne
      }
      // Erreur non liée au quota (clé invalide, réseau, contenu bloqué...) : on remonte direct
      return { ok: false, allExhausted: false, error: err.message || 'Erreur inconnue.' };
    }
  }

  // Tous les modèles de tryOrder ont fini en quota dépassé pendant cette tentative
  const finalMap = await getStatusMap(modelChain);
  const finalPick = pickAvailableModel(modelChain, finalMap, new Date());
  return { ok: false, allExhausted: true, soonestAvailable: finalPick.soonestAvailable, soonestAt: finalPick.soonestAt, error: lastError?.message };
}

module.exports = { askAI, markModelCooldown, markModelHealthy, getStatusMap };
