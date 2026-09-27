'use strict';
// web/server.js — Petit serveur HTTP intégré (aucune dépendance externe : module 'http' natif)
// Sert la page de transcript avancé accessible via le bouton "📄 Transcript" des suggestions.
//
// Route :  GET /transcript/:suggestionId  → page HTML (historique complet + votes + logs)
// Route :  GET /health                    → 200 OK (pour monitoring)
//
// Démarrage : appelée depuis src/index.js après le login du client Discord.
// URL publique à renseigner dans .env → PUBLIC_URL (ex: https://bumpify.example.com)

const http = require('http');
const { Suggestion, SuggestionConfig } = require('../models/Suggestion');
const { getHistory, LOG_META } = require('../utils/suggestionLogger');

const PORT = parseInt(process.env.WEB_PORT || '3000', 10);

// ─── Échappement HTML basique (évite toute injection depuis le contenu utilisateur) ──
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(d) {
  return new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

// ─── Résolution best-effort des noms via le cache du client Discord (pas d'appel API bloquant) ──
function resolveUser(client, userId) {
  if (!userId) return { name: 'Système', avatar: null };
  const user = client?.users?.cache?.get(userId);
  if (user) return { name: user.tag || user.username, avatar: user.displayAvatarURL?.({ size: 64 }) || null };
  return { name: `Utilisateur ${userId}`, avatar: null };
}

const STATUS_META = {
  pending:  { label: 'En attente',  color: '#feE75C', bg: 'rgba(254,231,92,0.12)' },
  approved: { label: 'Approuvée',   color: '#57F287', bg: 'rgba(87,242,135,0.12)' },
  denied:   { label: 'Refusée',     color: '#ED4245', bg: 'rgba(237,66,69,0.12)' },
};

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>
  :root {
    --bg: #0e0f13; --panel: #16181d; --panel-2: #1c1f26; --border: #262a33;
    --text: #e8e9ec; --muted: #8b8f9a; --accent: #5865F2;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, #1a1d2e 0%, var(--bg) 60%);
    color: var(--text); min-height: 100vh; padding: 40px 16px;
  }
  .wrap { max-width: 760px; margin: 0 auto; }
  .brand { display:flex; align-items:center; gap:10px; margin-bottom: 24px; color: var(--muted); font-size: 14px; }
  .brand b { color: var(--text); }
  .card {
    background: linear-gradient(180deg, var(--panel-2), var(--panel));
    border: 1px solid var(--border); border-radius: 16px; padding: 28px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.35);
  }
  .badge {
    display:inline-flex; align-items:center; gap:6px; padding: 4px 12px; border-radius: 999px;
    font-size: 13px; font-weight: 600;
  }
  h1 { font-size: 22px; margin: 14px 0 6px; line-height:1.3; }
  .meta { color: var(--muted); font-size: 13px; margin-bottom: 18px; }
  .content { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px; white-space: pre-wrap; line-height:1.55; margin-bottom: 20px; }
  .votebar { height: 10px; border-radius: 999px; background: #2a2e38; overflow:hidden; display:flex; margin: 8px 0 4px; }
  .votebar > div:first-child { background: linear-gradient(90deg,#57F287,#3ba55d); }
  .votebar > div:last-child  { background: linear-gradient(90deg,#ED4245,#b83a3c); }
  .vote-row { display:flex; justify-content: space-between; font-size: 13px; color: var(--muted); margin-bottom: 22px; }
  .section-title { font-size: 14px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 26px 0 12px; }
  .timeline { position: relative; padding-left: 22px; }
  .timeline::before { content:''; position:absolute; left:6px; top:4px; bottom:4px; width:2px; background: var(--border); }
  .event { position: relative; padding: 10px 0 10px 14px; }
  .event::before { content:''; position:absolute; left:-22px; top:16px; width:10px; height:10px; border-radius:50%; background: var(--accent); border: 2px solid var(--bg); }
  .event .label { font-weight: 600; font-size: 14px; }
  .event .sub { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
  .empty { color: var(--muted); font-style: italic; padding: 20px 0; text-align:center; }
  .footer { text-align:center; color: var(--muted); font-size: 12px; margin-top: 28px; }
  a { color: #7d8cff; }
  code { background: #22252d; padding: 1px 6px; border-radius: 6px; font-size: 12.5px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">📡 <b>Bumpify</b> — Transcript de suggestion</div>
    ${body}
    <div class="footer">Généré automatiquement · Bumpify Suggestions</div>
  </div>
</body>
</html>`;
}

function errorPage(res, status, title, message) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page(title, `
    <div class="card">
      <span class="badge" style="background:rgba(237,66,69,0.12); color:#ED4245;">Erreur ${status}</span>
      <h1>${esc(title)}</h1>
      <p class="meta">${esc(message)}</p>
    </div>
  `));
}

async function renderTranscript(client, suggestionId) {
  const suggestion = await Suggestion.findById(suggestionId).lean().catch(() => null);
  if (!suggestion) return { status: 404, title: 'Suggestion introuvable', message: 'Cette suggestion n\'existe pas ou a été supprimée.' };

  const config = await SuggestionConfig.findOne({ guildId: suggestion.guildId }).lean().catch(() => null);
  if (config && config.transcriptEnabled === false) {
    return { status: 403, title: 'Transcript désactivé', message: 'Le transcript public a été désactivé par les administrateurs de ce serveur.' };
  }

  const history = await getHistory(suggestionId);
  const author  = resolveUser(client, suggestion.anonymous ? null : suggestion.authorId);
  const status  = STATUS_META[suggestion.status] || STATUS_META.pending;

  const totalVotes = (suggestion.upvotes || 0) + (suggestion.downvotes || 0);
  const upPct = totalVotes > 0 ? Math.round((suggestion.upvotes / totalVotes) * 100) : 0;

  const timelineHtml = history.length
    ? history.map((h) => {
        const meta = LOG_META[h.action] || { label: h.action };
        const who  = resolveUser(client, h.actorId);
        return `<div class="event">
          <div class="label">${esc(meta.label)}</div>
          <div class="sub">${esc(fmtDate(h.date))} · ${esc(h.actorId ? who.name : 'Action automatique')}${h.detail ? ` · ${esc(h.detail)}` : ''}</div>
        </div>`;
      }).join('')
    : '<div class="empty">Aucun évènement enregistré pour le moment.</div>';

  const body = `
    <div class="card">
      <span class="badge" style="background:${status.bg}; color:${status.color};">● ${esc(status.label)}</span>
      <h1>💡 Suggestion #${suggestion.number}</h1>
      <div class="meta">
        Proposée par <b>${suggestion.anonymous ? 'Anonyme 🕵️' : esc(author.name)}</b>
        le ${esc(fmtDate(suggestion.createdAt))}
        ${suggestion.category ? ` · Catégorie <code>${esc(suggestion.category)}</code>` : ''}
      </div>
      <div class="content">${esc(suggestion.content)}</div>

      <div class="votebar">
        <div style="width:${upPct}%"></div>
        <div style="width:${100 - upPct}%"></div>
      </div>
      <div class="vote-row">
        <span>👍 ${suggestion.upvotes || 0} approbations</span>
        <span>${totalVotes} vote(s) au total</span>
        <span>👎 ${suggestion.downvotes || 0} refus</span>
      </div>

      ${suggestion.reason ? `<div class="section-title">Raison de la décision</div><div class="content">${esc(suggestion.reason)}</div>` : ''}

      <div class="section-title">Historique complet (${history.length})</div>
      <div class="timeline">${timelineHtml}</div>
    </div>
  `;

  return { status: 200, html: page(`Suggestion #${suggestion.number} — Transcript`, body) };
}

function startWebServer(client) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (req.method !== 'GET') return errorPage(res, 405, 'Méthode non autorisée', 'Seules les requêtes GET sont supportées.');

      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('OK');
      }

      const match = url.pathname.match(/^\/transcript\/([a-fA-F0-9]{24})\/?$/);
      if (match) {
        const result = await renderTranscript(client, match[1]);
        if (result.status !== 200) return errorPage(res, result.status, result.title, result.message);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(result.html);
      }

      return errorPage(res, 404, 'Page introuvable', 'Cette URL ne correspond à aucune ressource.');
    } catch (err) {
      console.error('❌ [web] Erreur serveur transcript:', err);
      return errorPage(res, 500, 'Erreur interne', 'Une erreur inattendue est survenue. Réessayez plus tard.');
    }
  });

  server.listen(PORT, () => {
    console.log(`✅ Serveur transcript en écoute sur le port ${PORT} (PUBLIC_URL=${process.env.PUBLIC_URL || `http://localhost:${PORT}`})`);
  });

  server.on('error', (err) => {
    console.error('❌ [web] Impossible de démarrer le serveur transcript:', err.message);
  });

  return server;
}

function transcriptUrl(suggestionId) {
  const base = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  return `${base}/transcript/${suggestionId}`;
}

module.exports = { startWebServer, transcriptUrl };
