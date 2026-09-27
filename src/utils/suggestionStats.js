'use strict';
// utils/suggestionStats.js — Agrégation des statistiques (vue "temps réel")
const { Suggestion } = require('../models/Suggestion');

async function computeStats(guildId) {
  const all = await Suggestion.find({ guildId }).lean();

  const total    = all.length;
  const pending  = all.filter(s => s.status === 'pending').length;
  const approved = all.filter(s => s.status === 'approved').length;
  const denied   = all.filter(s => s.status === 'denied').length;
  const resolved = approved + denied;
  const approvalRate = resolved > 0 ? Math.round((approved / resolved) * 100) : 0;

  const totalUpvotes   = all.reduce((s, x) => s + (x.upvotes || 0), 0);
  const totalDownvotes = all.reduce((s, x) => s + (x.downvotes || 0), 0);
  const totalVotes     = totalUpvotes + totalDownvotes;
  const avgVotes       = total > 0 ? (totalVotes / total).toFixed(1) : '0.0';

  const topVoted = [...all]
    .map(s => ({ ...s, net: (s.upvotes || 0) - (s.downvotes || 0) }))
    .sort((a, b) => b.net - a.net)
    .slice(0, 5);

  const authorCounts = {};
  for (const s of all) authorCounts[s.authorId] = (authorCounts[s.authorId] || 0) + 1;
  const mostActive = Object.entries(authorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([userId, count]) => ({ userId, count }));

  const categoryCounts = {};
  for (const s of all) categoryCounts[s.category || 'general'] = (categoryCounts[s.category || 'general'] || 0) + 1;

  // Suggestions des 7 derniers jours (pour un mini graphique en barres)
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const count = all.filter(s => new Date(s.createdAt) >= dayStart && new Date(s.createdAt) < dayEnd).length;
    last7Days.push({ date: dayStart, count });
  }

  return {
    total, pending, approved, denied, approvalRate,
    totalUpvotes, totalDownvotes, totalVotes, avgVotes,
    topVoted, mostActive, categoryCounts, last7Days,
  };
}

function renderBarChart(last7Days) {
  const max = Math.max(1, ...last7Days.map(d => d.count));
  const BAR_HEIGHT = 6;
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  return last7Days.map(d => {
    const filled = Math.max(d.count > 0 ? 1 : 0, Math.round((d.count / max) * BAR_HEIGHT));
    const bar = '█'.repeat(filled).padEnd(BAR_HEIGHT, '░');
    return `\`${days[new Date(d.date).getDay()]}\` ${bar} **${d.count}**`;
  }).join('\n');
}

module.exports = { computeStats, renderBarChart };
