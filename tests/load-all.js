// Vérification hors-ligne : require() de chaque commande et événement.
// Usage : node tests/load-all.js
const fs = require('fs');
const path = require('path');

function getJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return getJsFiles(full);
    if (entry.name.endsWith('.js')) return [full];
    return [];
  });
}

const roots = [
  ['commandes', path.join(__dirname, '..', 'src', 'commands')],
  ['événements', path.join(__dirname, '..', 'src', 'events')],
  ['utils', path.join(__dirname, '..', 'src', 'utils')],
  ['models', path.join(__dirname, '..', 'src', 'models')],
  ['web', path.join(__dirname, '..', 'src', 'web')],
];

let ok = 0, ko = 0;
for (const [label, root] of roots) {
  const files = getJsFiles(root);
  for (const file of files) {
    try {
      require(file);
      ok++;
    } catch (err) {
      ko++;
      console.error(`❌ [${label}] ${path.relative(path.join(__dirname, '..'), file)}\n   → ${err.message.split('\n')[0]}`);
    }
  }
}

console.log(`\n📊 Résultat : ${ok} fichier(s) chargé(s), ${ko} en échec`);
process.exit(ko ? 1 : 0);
