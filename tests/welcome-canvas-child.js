// tests/welcome-canvas-child.js — Rendu des 4 styles dans un process isolé
// Appelé par welcome-smoke.js : si le canvas natif crash (ex : icudtl.dat
// absent sur certains postes Windows), le process parent reste fonctionnel.
const { renderWelcomeImage } = require('../src/utils/welcomeCards');

const member = {
  user: {
    id: '123456789012345678',
    username: 'Alice',
    displayAvatarURL: () => null,
  },
  id: '123456789012345678',
};
const guild = {
  name: 'Serveur Test',
  memberCount: 1234,
};

(async () => {
  for (const style of ['gradient', 'glass', 'banner', 'minimal']) {
    const buf = await renderWelcomeImage(member, guild, { imageStyle: style, showFooter: true });
    console.log(`CANVAS_OK ${style} ${buf.length}`);
  }
  console.log('CANVAS_ALL_DONE');
  process.exit(0);
})().catch((err) => {
  console.error('CANVAS_ERR', err.message);
  process.exit(2);
});
