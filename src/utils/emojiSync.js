// utils/emojiSync.js — Synchronisation automatique des emojis custom de
// l'application Discord (rattachés au bot lui-même, pas à un serveur précis).
//
// Fonctionnement : toute image placée dans assets/emojis/ est envoyée sur le
// Developer Portal au démarrage du bot, sans étape manuelle. Le nom de
// l'emoji = nom du fichier (sans extension). Si un emoji du même nom existe
// déjà côté Discord, il n'est pas recréé (l'API ne permet de toute façon pas
// de changer l'image d'un emoji existant — supprime-le sur le Developer
// Portal si tu veux le remplacer, il sera recréé au prochain démarrage).
const fs = require('fs');
const path = require('path');

const EMOJIS_DIR = path.join(__dirname, '..', '..', 'assets', 'emojis');
const VALID_EXT = /\.(png|jpe?g|gif)$/i;

async function syncApplicationEmojis(client) {
  if (!fs.existsSync(EMOJIS_DIR)) {
    console.log('ℹ️  Aucun dossier assets/emojis/ trouvé — synchronisation des emojis ignorée.');
    return;
  }

  const files = fs.readdirSync(EMOJIS_DIR).filter((f) => VALID_EXT.test(f));
  if (files.length === 0) {
    console.log('ℹ️  assets/emojis/ est vide — rien à synchroniser.');
    return;
  }

  let existing;
  try {
    existing = await client.application.emojis.fetch();
  } catch (err) {
    console.error('❌ Impossible de récupérer les emojis existants de l\'application:', err.message);
    return;
  }

  let created = 0;
  for (const file of files) {
    const name = path
      .basename(file, path.extname(file))
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 32);

    if (existing.some((e) => e.name === name)) continue; // déjà présent, on ne recrée pas

    try {
      const emoji = await client.application.emojis.create({
        attachment: path.join(EMOJIS_DIR, file),
        name,
      });
      console.log(`✅ Emoji custom créé : ${name} (${emoji.id})`);
      created++;
    } catch (err) {
      console.error(`❌ Échec de création de l'emoji "${name}":`, err.message);
    }
  }

  if (created === 0) {
    console.log(`✅ Emojis d'application déjà synchronisés (${existing.size} au total).`);
  } else {
    console.log(`✅ ${created} nouvel(aux) emoji(s) synchronisé(s) avec le Developer Portal.`);
  }
}

/**
 * Renvoie le tag utilisable dans un message (`<:nom:id>` ou `<a:nom:id>` si
 * animé) pour un emoji custom de l'application. Renvoie une chaîne vide si
 * l'emoji n'existe pas encore (utile pour ne rien afficher plutôt que planter
 * si la synchronisation n'a pas encore eu lieu).
 *
 * Exemple : embed.setDescription(`${getAppEmoji(client, 'bumpify_rocket')} Bump effectué !`)
 */
function getAppEmoji(client, name) {
  const emoji = client.application?.emojis?.cache?.find((e) => e.name === name);
  if (!emoji) return '';
  return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

module.exports = { syncApplicationEmojis, getAppEmoji };
