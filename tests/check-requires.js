// Vérification statique : chaque require('...') relatif de src/ doit résoudre
// vers un fichier existant (.js, .json) ou un dossier avec index.js.
// Attrape aussi les requires paresseux (dans les fonctions), invisibles au
// simple chargement. Usage : node tests/check-requires.js
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function getJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return getJsFiles(full);
    if (entry.name.endsWith('.js')) return [full];
    return [];
  });
}

const RE_REQUIRE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;

let missing = 0, checked = 0;
for (const file of getJsFiles(SRC)) {
  const content = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = RE_REQUIRE.exec(content)) !== null) {
    checked++;
    const target = path.resolve(path.dirname(file), m[1]);
    const candidates = [
      target,
      `${target}.js`,
      `${target}.json`,
      path.join(target, 'index.js'),
    ];
    if (!candidates.some(c => fs.existsSync(c) && fs.statSync(c).isFile())) {
      missing++;
      console.error(`❌ ${path.relative(path.join(__dirname, '..'), file)}\n   → require('${m[1]}') introuvable`);
    }
  }
}

console.log(`\n📊 ${checked} require(s) relatif(s) analysé(s), ${missing} cassé(s)`);
process.exit(missing ? 1 : 0);
