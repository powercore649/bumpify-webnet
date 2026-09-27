'use strict';
// utils/newsFetcher.js — Récupération d'actualités via RSS (sans clé API)

const https = require('https');
const http  = require('http');

// ─── Sources RSS françaises ───────────────────────────────────────────────────
const SOURCES = {
  jeuxvideo: {
    name:     'Jeuxvideo.com',
    emoji:    '🎮',
    category: 'gaming',
    color:    0xE8000D,
    url:      'https://www.jeuxvideo.com/rss/rss.xml',
    icon:     'https://www.jeuxvideo.com/favicon.ico',
  },
  gamekult: {
    name:     'Gamekult',
    emoji:    '🕹️',
    category: 'gaming',
    color:    0x1A1A2E,
    url:      'https://www.gamekult.com/feed.rss',
    icon:     'https://www.gamekult.com/favicon.ico',
  },
  numerama: {
    name:     'Numerama',
    emoji:    '💻',
    category: 'tech',
    color:    0x0066CC,
    url:      'https://www.numerama.com/feed/',
    icon:     'https://www.numerama.com/favicon.ico',
  },
  bfmtech: {
    name:     'BFM Tech',
    emoji:    '📱',
    category: 'tech',
    color:    0x003399,
    url:      'https://www.bfmtv.com/rss/tech/',
    icon:     'https://www.bfmtv.com/favicon.ico',
  },
  lemonde: {
    name:     'Le Monde',
    emoji:    '🌍',
    category: 'general',
    color:    0x1A1A1A,
    url:      'https://www.lemonde.fr/rss/une.xml',
    icon:     'https://www.lemonde.fr/favicon.ico',
  },
  millenium: {
    name:     'Millenium',
    emoji:    '🏆',
    category: 'esport',
    color:    0xFFD700,
    url:      'https://www.millenium.org/news/flux.rss',
    icon:     'https://www.millenium.org/favicon.ico',
  },
};

// ─── Fetch HTTP/HTTPS robuste ─────────────────────────────────────────────────
function fetchText(url, timeoutMs = 10000, redirects = 3) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (compatible; Bumpify/4.0; +https://bumpify.bot)',
        'Accept':          'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      timeout: timeoutMs,
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return fetchText(res.headers.location, timeoutMs, redirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', c => { raw += c; if (raw.length > 500000) { req.destroy(); reject(new Error('Réponse trop grande')); } });
      res.on('end', () => resolve(raw));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout`)); });
  });
}

// ─── Parser RSS minimal (sans dépendances) ────────────────────────────────────
function parseRSS(xml) {
  const items = [];
  // Extraire tous les <item> ou <entry>
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1] || match[2];

    const get = (tag) => {
      // CDATA
      const cdataRx = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
      const cdataM  = block.match(cdataRx);
      if (cdataM) return cdataM[1].trim();
      // Normal
      const normalRx = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const normalM  = block.match(normalRx);
      if (normalM) return normalM[1].replace(/<[^>]+>/g, '').trim();
      return null;
    };

    const getAttr = (tag, attr) => {
      const rx = new RegExp(`<${tag}[^>]+${attr}="([^"]*)"`, 'i');
      const m  = block.match(rx);
      return m ? m[1] : null;
    };

    const title = get('title');
    if (!title) continue;

    // Lien
    let link = get('link') || getAttr('link', 'href') || '';
    // Nettoyer les liens qui contiennent du HTML
    link = link.replace(/<[^>]+>/g, '').trim();

    // Date
    const rawDate = get('pubDate') || get('published') || get('updated') || get('dc:date');
    const date    = rawDate ? new Date(rawDate) : new Date();

    // Description / résumé
    let desc = get('description') || get('summary') || get('content') || '';
    // Supprimer les balises HTML et limiter
    desc = desc.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (desc.length === 300) desc += '…';

    // Image — chercher dans media:content, enclosure, ou description
    let image = getAttr('media:content', 'url') || getAttr('enclosure', 'url') || null;
    if (!image) {
      const imgRx = /<img[^>]+src="([^"]+)"/i;
      const imgM  = (get('description') || '').match(imgRx);
      if (imgM) image = imgM[1];
    }
    // Filtre images valides
    if (image && !image.match(/^https?:\/\//)) image = null;

    // Catégorie
    const category = get('category');

    items.push({
      title:    decodeHTML(title),
      link:     link || null,
      date,
      desc:     decodeHTML(desc),
      image:    image || null,
      category: category || null,
    });
  }

  return items;
}

// ─── Decode entités HTML basiques ─────────────────────────────────────────────
function decodeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g,   '&')
    .replace(/&lt;/g,    '<')
    .replace(/&gt;/g,    '>')
    .replace(/&quot;/g,  '"')
    .replace(/&#39;/g,   "'")
    .replace(/&apos;/g,  "'")
    .replace(/&nbsp;/g,  ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .trim();
}

// ─── Hash d'un lien (pour l'anti-doublon) ─────────────────────────────────────
function hashLink(link) {
  let h = 0;
  for (const c of (link || '')) { h = (h << 5) - h + c.charCodeAt(0); h |= 0; }
  return Math.abs(h).toString(36);
}

// ─── Récupérer les articles d'une source ─────────────────────────────────────
async function fetchSource(sourceKey) {
  const src = SOURCES[sourceKey];
  if (!src) return [];

  try {
    const xml   = await fetchText(src.url);
    const items = parseRSS(xml);

    return items.slice(0, 10).map(item => ({
      id:       hashLink(item.link || item.title),
      sourceKey,
      source:   src.name,
      emoji:    src.emoji,
      category: src.category,
      color:    src.color,
      icon:     src.icon,
      title:    item.title,
      link:     item.link,
      desc:     item.desc,
      image:    item.image,
      date:     item.date,
    }));
  } catch (err) {
    console.error(`[News] ${sourceKey}: ${err.message}`);
    return [];
  }
}

// ─── Récupérer les articles de toutes les sources activées ───────────────────
async function fetchAllNews(enabledSources = {}) {
  const keys = Object.keys(SOURCES).filter(k => enabledSources[k] !== false);
  const results = await Promise.allSettled(keys.map(k => fetchSource(k)));

  const articles = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  // Trier par date décroissante
  articles.sort((a, b) => new Date(b.date) - new Date(a.date));

  return articles;
}

module.exports = {
  SOURCES,
  fetchSource,
  fetchAllNews,
  hashLink,
};
