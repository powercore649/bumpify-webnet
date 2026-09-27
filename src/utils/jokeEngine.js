'use strict';
// utils/jokeEngine.js — Logique pure pour /joke v2 (sélection, anti-répétition, notation)

/**
 * Choisit une blague au hasard dans une liste, filtrée par catégorie si fournie,
 * en évitant si possible les IDs récemment vus.
 * @param {Array} jokes
 * @param {Object} [opts]
 * @param {string} [opts.category] - filtre par catégorie ('all' ou undefined = toutes)
 * @param {Set<string>} [opts.exclude] - IDs à éviter si possible
 */
function pickRandomJoke(jokes, { category, exclude } = {}) {
  let pool = jokes;
  if (category && category !== 'all') {
    pool = jokes.filter(j => j.category === category);
  }
  if (!pool.length) return null;

  const excludeSet = exclude || new Set();
  const fresh = pool.filter(j => !excludeSet.has(j.id));
  const finalPool = fresh.length > 0 ? fresh : pool; // si tout a été vu, on relâche la contrainte

  return finalPool[Math.floor(Math.random() * finalPool.length)];
}

/**
 * Vote up/down sur une blague — permet de changer d'avis, empêche le doublon exact.
 * Mute `rating.up` / `rating.down` / `rating.voters`.
 * @returns {{ changed: boolean, switched: boolean }}
 */
function applyRating(rating, userId, type) {
  rating.voters = rating.voters || [];
  rating.voteChoice = rating.voteChoice || {};
  const previous = rating.voteChoice[userId] || null;

  if (previous === type) return { changed: false, switched: false };

  if (previous === 'up') rating.up = Math.max(0, rating.up - 1);
  if (previous === 'down') rating.down = Math.max(0, rating.down - 1);

  if (type === 'up') rating.up = (rating.up || 0) + 1;
  else rating.down = (rating.down || 0) + 1;

  rating.voteChoice[userId] = type;
  if (!rating.voters.includes(userId)) rating.voters.push(userId);

  return { changed: true, switched: previous !== null };
}

module.exports = { pickRandomJoke, applyRating };
