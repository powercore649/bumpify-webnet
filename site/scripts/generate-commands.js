// scripts/generate-commands.js — Extrait les VRAIES commandes du bot
// (src/commands/**) en important chaque module et lisant son SlashCommandBuilder.
// Génère site/data/commands.json — aucune donnée inventée.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CMD_ROOT = path.join(ROOT, 'src', 'commands');
const OUT = path.join(__dirname, '..', 'data', 'commands.json');

// ── Mapping dossiers → catégories (identique à /help du bot) ─────────────────
const CATEGORIES = {
  'bump-reseau':  { label: 'Bump & Réseau',    emoji: '🚀', color: '#5865F2', desc: 'Faites connaître votre serveur à travers tout le réseau Bumpify.' },
  'moderation':   { label: 'Modération',       emoji: '🛡️', color: '#ED4245', desc: 'Sanctions, anti-raid, logs et protection du serveur.' },
  'configuration':{ label: 'Configuration',    emoji: '⚙️', color: '#99AAB5', desc: 'Tout ce qu\'il faut pour mettre Bumpify à votre image.' },
  'economie':     { label: 'Économie & Jeux',  emoji: '💰', color: '#FEE75C', desc: 'Coins, pêche, boutique et mini-jeux.' },
  'xp':           { label: 'Niveaux & XP',     emoji: '🏆', color: '#EB459E', desc: 'Récompensez l\'activité de vos membres.' },
  'communaute':   { label: 'Communauté',       emoji: '🎉', color: '#57F287', desc: 'Giveaways, sondages, suggestions, anniversaires…' },
  'utilitaires':  { label: 'Utilitaires',      emoji: '🔧', color: '#5BC0EB', desc: 'Informations pratiques et outils du quotidien.' },
  'fun':          { label: 'Fun',              emoji: '🎲', color: '#F47B67', desc: 'Un peu de légèreté entre deux bumps.' },
  'owner':        { label: 'Propriétaire',     emoji: '🔑', color: '#2C2F33', desc: 'Commandes réservées au(x) propriétaire(s) du bot.' },
};

// ── Extraction des métadonnées d'une commande depuis son module ──────────────
function serializeOption(o) {
  const opt = {
    name: o.name,
    description: o.description,
    required: Boolean(o.required),
  };
  if (o.choices?.length) opt.choices = o.choices.map(c => c.name);
  if (o.minValue != null) opt.min = o.minValue;
  if (o.maxValue != null) opt.max = o.maxValue;
  if (o.channelTypes?.length) opt.channelTypes = o.channelTypes.map(t => channelTypeName(t));
  return opt;
}

function channelTypeName(t) {
  const names = { 0: 'texte', 2: 'vocal', 4: 'catégorie', 5: 'annonces', 13: 'forum', 15: 'forum' };
  return names[t] || 'salon';
}

function extractCommand(mod, file, folder) {
  if (!mod?.data?.name) return null;
  const json = typeof mod.data.toJSON === 'function' ? mod.data.toJSON() : null;
  const cmd = {
    name: mod.data.name,
    description: mod.data.description || '',
    category: folder,
    file: path.relative(ROOT, file).replace(/\\/g, '/'),
    defaultMemberPermissions: json?.default_member_permissions || null,
    subcommands: [],
    options: [],
  };
  if (json?.options) {
    for (const o of json.options) {
      // Sous-commandes (type 1) / groupes (type 2)
      if ([1, 2].includes(o.type)) {
        if (o.options) {
          for (const sub of o.options) {
            if ([1, 2].includes(sub.type)) continue;
            cmd.subcommands.push({
              name: `${o.name} ${sub.name}`,
              description: sub.description,
              options: (sub.options || []).map(serializeOption),
            });
          }
        } else {
          cmd.subcommands.push({
            name: o.name,
            description: o.description,
            options: (o.options || []).map(serializeOption),
          });
        }
      } else {
        cmd.options.push(serializeOption(o));
      }
    }
  }
  return cmd;
}

// ── Scan récursif ─────────────────────────────────────────────────────────────
function getJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return getJsFiles(full);
    if (entry.name.endsWith('.js')) return [full];
    return [];
  });
}

// ── Fallback statique : si l'import échoue (ex: module natif canvas), on
// récupère au minimum name/description via regex sur le source. ──────────────
function extractStatic(file, folder) {
  const src = fs.readFileSync(file, 'utf8');
  const name = src.match(/\.setName\(\s*['"]([a-z0-9_-]+)['"]/i);
  const desc = src.match(/\.setDescription\(\s*['"](.+?)['"]/s);
  if (!name) return null;
  return {
    name: name[1],
    description: desc ? desc[1].replace(/\\'/g, "'") : '',
    category: folder,
    file: path.relative(ROOT, file).replace(/\\/g, '/'),
    defaultMemberPermissions: null,
    subcommands: [],
    options: [],
  };
}

// Garde : sur Vercel, seul site/ est déployé — pas de code bot à analyser.
// On garde alors le commands.json committé (dernière génération locale).
if (!fs.existsSync(CMD_ROOT)) {
  console.warn(`⚠️  Source du bot absente (${CMD_ROOT}) — commands.json committé conservé.`);
  process.exit(0);
}

const result = { generatedAt: new Date().toISOString(), total: 0, categories: [] };

for (const [folder, meta] of Object.entries(CATEGORIES)) {
  const dir = path.join(CMD_ROOT, folder);
  if (!fs.existsSync(dir)) continue;

  const commands = [];
  for (const file of getJsFiles(dir)) {
    try {
      const mod = require(file);
      const cmd = extractCommand(mod, file, folder);
      if (cmd) {
        commands.push(cmd);
      } else {
        const fb = extractStatic(file, folder);
        if (fb) commands.push(fb);
        else console.warn(`⚠️  Ignoré (pas de data.name): ${path.relative(ROOT, file)}`);
      }
    } catch (err) {
      const fallback = extractStatic(file, folder);
      if (fallback) commands.push(fallback);
      else console.warn(`⚠️  Ignoré: ${path.relative(ROOT, file)} → ${err.message.split('\n')[0]}`);
    }
  }

  commands.sort((a, b) => a.name.localeCompare(b.name));
  result.categories.push({ ...meta, key: folder, count: commands.length, commands });
  result.total += commands.length;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`✅ ${result.total} commande(s) extraites → ${path.relative(ROOT, OUT)}`);
for (const c of result.categories) console.log(`   ${c.emoji} ${c.label}: ${c.count}`);
process.exit(0); // des modules du bot démarrent des timers au require — sortie forcée
