'use strict';
// utils/suggestionEngine.js — Logique métier pure (aucune dépendance Discord/DB)
// Séparée pour être testable unitairement à 100%.

/**
 * @param {{cooldownMinutes:number}} config
 * @param {Date|null} lastSuggestionAt - date de la dernière suggestion de l'utilisateur (ou null)
 * @param {Date} [now]
 */
function checkCooldown(config, lastSuggestionAt, now = new Date()) {
  const minutes = config?.cooldownMinutes || 0;
  if (minutes <= 0 || !lastSuggestionAt) return { ok: true };

  const elapsedMs = now.getTime() - new Date(lastSuggestionAt).getTime();
  const remainingMs = minutes * 60_000 - elapsedMs;
  if (remainingMs <= 0) return { ok: true };

  return { ok: false, remainingMinutes: Math.ceil(remainingMs / 60_000) };
}

/**
 * @param {{requiredRoleId:string|null}} config
 * @param {string[]} memberRoleIds
 */
function checkRequiredRole(config, memberRoleIds = []) {
  if (!config?.requiredRoleId) return true;
  return memberRoleIds.includes(config.requiredRoleId);
}

/**
 * Applique (ou modifie) le vote d'un utilisateur sur une suggestion.
 * Autorise le changement d'avis (up → down ou down → up) mais pas le double-vote identique.
 * Mute directement l'objet `suggestion` passé (upvotes/downvotes/voters/voteChoice).
 *
 * @param {Object} suggestion - doit avoir upvotes, downvotes, voters(array), voteChoice(object)
 * @param {string} userId
 * @param {'up'|'down'} type
 * @returns {{ changed: boolean, switched: boolean, reason?: string }}
 */
function applyVote(suggestion, userId, type) {
  if (suggestion.status !== 'pending') {
    return { changed: false, switched: false, reason: 'closed' };
  }

  suggestion.voteChoice = suggestion.voteChoice || {};
  const previous = suggestion.voteChoice[userId] || null;

  if (previous === type) {
    return { changed: false, switched: false, reason: 'same_vote' };
  }

  if (previous === 'up') suggestion.upvotes = Math.max(0, suggestion.upvotes - 1);
  if (previous === 'down') suggestion.downvotes = Math.max(0, suggestion.downvotes - 1);

  if (type === 'up') suggestion.upvotes = (suggestion.upvotes || 0) + 1;
  else suggestion.downvotes = (suggestion.downvotes || 0) + 1;

  suggestion.voteChoice[userId] = type;
  if (!suggestion.voters.includes(userId)) suggestion.voters.push(userId);

  return { changed: true, switched: previous !== null, reason: previous ? 'switched' : 'new' };
}

/**
 * Détermine si une suggestion doit être auto-résolue selon les seuils configurés.
 * @param {{autoApproveAt:number, autoDenyAt:number}} config
 * @param {{upvotes:number, downvotes:number}} suggestion
 * @returns {'approved'|'denied'|null}
 */
function checkAutoResolve(config, suggestion) {
  const net = (suggestion.upvotes || 0) - (suggestion.downvotes || 0);
  if (config?.autoApproveAt > 0 && net >= config.autoApproveAt) return 'approved';
  if (config?.autoDenyAt > 0 && net <= -config.autoDenyAt) return 'denied';
  return null;
}

module.exports = { checkCooldown, checkRequiredRole, applyVote, checkAutoResolve };
