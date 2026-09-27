// utils/welcomeCards.js — Moteur d'images de bienvenue Bumpify
// 4 styles uniques, tous générés en @napi-rs/canvas, sans dépendance externe :
//   • gradient — grille néon + dégradé violet/rose (style classique Bumpify)
//   • glass    — vitrail de glace bleu, reflets diagonaux
//   • banner   — bandeau diagonal + pastille avatar décalée
//   • minimal  — carte épurée, cadre fin, typographie centrée
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { safeLoadImage } = require('./safeLoadImage');
const { COLORS } = require('./embeds');

const W = 960;
const H = 320;

// ─── Utilitaires de dessin ────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth, startSize, weight = 'bold') {
  let size = startSize;
  ctx.font = `${weight} ${size}px Sans`;
  while (ctx.measureText(text).width > maxWidth && size > 14) {
    size -= 2;
    ctx.font = `${weight} ${size}px Sans`;
  }
  return size;
}

function drawAvatar(ctx, url, x, y, size, ringColors) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 + 6, 0, Math.PI * 2);
  if (ringColors) {
    const ring = ctx.createLinearGradient(x, y, x + size, y + size);
    ring.addColorStop(0, ringColors[0]);
    ring.addColorStop(1, ringColors[1]);
    ctx.fillStyle = ring;
  } else {
    ctx.fillStyle = '#FFFFFF';
  }
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = ringColors ? ringColors[0] : '#5865F2';
  ctx.fillRect(x, y, size, size);
  ctx.restore();

  return safeLoadImage(url).then((img) => {
    if (!img) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, x, y, size, size);
    ctx.restore();
  });
}

function drawFooter(ctx, showFooter, align = 'center') {
  if (!showFooter) return;
  ctx.textAlign = align;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = 'bold 13px Sans';
  ctx.fillText('Protégé & accueilli par Bumpify', W / 2, H - 12);
  ctx.textAlign = 'left';
}

function drawCustomText(ctx, custom, fallback) {
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 22px Sans';
  ctx.fillText((custom || fallback).toUpperCase(), W / 2, H - 48);
  ctx.textAlign = 'left';
}

// ─── Fond personnalisé (image uploadée par le serveur) ────────────────────────
async function drawCustomBackground(ctx, url) {
  const bg = await safeLoadImage(url);
  if (!bg) return false;
  ctx.drawImage(bg, 0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);
  return true;
}

// ─── Style 1 : gradient (grille néon) ─────────────────────────────────────────
async function drawGradient(ctx, member, guild, opts) {
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0d1117');
  bg.addColorStop(0.5, '#161b22');
  bg.addColorStop(1, '#21262d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(88,101,242,0.10)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const l = ctx.createLinearGradient(0, 0, 0, H);
  l.addColorStop(0, '#5865F2');
  l.addColorStop(1, '#EB459E');
  ctx.fillStyle = l;
  ctx.fillRect(0, 0, 6, H);
  ctx.fillRect(W - 6, 0, 6, H);

  await drawAvatar(ctx, member.user.displayAvatarURL({ extension: 'png', size: 256 }),
    W / 2 - 70, 26, 140, ['#5865F2', '#EB459E']);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(88,101,242,0.95)';
  ctx.font = 'bold 20px Sans';
  ctx.fillText((opts.headline || 'BIENVENUE').toUpperCase(), W / 2, 198);
  ctx.fillStyle = '#FFFFFF';
  fitText(ctx, member.user.username, W - 160, 40);
  ctx.fillText(member.user.username, W / 2, 240);
  ctx.fillStyle = '#B9BBBE';
  ctx.font = '17px Sans';
  ctx.fillText(`Membre #${guild.memberCount.toLocaleString('fr-FR')} de ${guild.name}`, W / 2, 270);
  ctx.textAlign = 'left';

  drawFooter(ctx, opts.showFooter);
}

// ─── Style 2 : glass (vitrail de glace) ───────────────────────────────────────
async function drawGlass(ctx, member, guild, opts) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b1e3a');
  bg.addColorStop(1, '#123a63');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Reflets diagonaux
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#FFFFFF';
  for (let i = -2; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 160, 0);
    ctx.lineTo(i * 160 + 80, 0);
    ctx.lineTo(i * 160 - 40, H);
    ctx.lineTo(i * 160 - 120, H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Halos lumineux
  const halo = ctx.createRadialGradient(W - 120, 40, 20, W - 120, 40, 260);
  halo.addColorStop(0, 'rgba(91,192,235,0.35)');
  halo.addColorStop(1, 'rgba(91,192,235,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);

  const halo2 = ctx.createRadialGradient(120, H - 30, 20, 120, H - 30, 240);
  halo2.addColorStop(0, 'rgba(88,101,242,0.30)');
  halo2.addColorStop(1, 'rgba(88,101,242,0)');
  ctx.fillStyle = halo2;
  ctx.fillRect(0, 0, W, H);

  // Carte de glace centrale
  ctx.save();
  roundRect(ctx, 250, 44, 460, 232, 24);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  await drawAvatar(ctx, member.user.displayAvatarURL({ extension: 'png', size: 256 }),
    W / 2 - 62, 62, 124, null);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = 'bold 18px Sans';
  ctx.fillText((opts.headline || 'BIENVENUE DANS L\'AUBERGE').toUpperCase(), W / 2, 216);
  ctx.fillStyle = '#FFFFFF';
  fitText(ctx, member.user.username, 400, 36);
  ctx.fillText(member.user.username, W / 2, 252);
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = '15px Sans';
  ctx.fillText(`Le membre n°${guild.memberCount.toLocaleString('fr-FR')} pousse la porte`, W / 2, 276);
  ctx.textAlign = 'left';

  drawFooter(ctx, opts.showFooter);
}

// ─── Style 3 : banner (bandeau diagonal + pastille) ───────────────────────────
async function drawBanner(ctx, member, guild, opts) {
  ctx.fillStyle = '#10131c';
  ctx.fillRect(0, 0, W, H);

  // Bandeau diagonal
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, 150); ctx.lineTo(0, 210);
  ctx.closePath();
  const band = ctx.createLinearGradient(0, 0, W, 150);
  band.addColorStop(0, '#5865F2');
  band.addColorStop(1, '#EB459E');
  ctx.fillStyle = band;
  ctx.fill();
  ctx.restore();

  // Petits triangles déco sous le bandeau
  ctx.fillStyle = 'rgba(235,69,158,0.35)';
  for (let x = 40; x < W; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, 208); ctx.lineTo(x + 24, 208); ctx.lineTo(x + 12, 228);
    ctx.closePath();
    ctx.fill();
  }

  // Pastille avatar décalée à gauche
  await drawAvatar(ctx, member.user.displayAvatarURL({ extension: 'png', size: 256 }),
    92, 118, 152, ['#5865F2', '#EB459E']);

  // Textes à droite
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 19px Sans';
  ctx.fillText((opts.headline || 'NOUVEAU MEMBRE').toUpperCase(), 280, 118);
  ctx.fillStyle = '#FFFFFF';
  fitText(ctx, member.user.username, W - 340, 42);
  ctx.fillText(member.user.username, 280, 164);
  ctx.fillStyle = '#B9BBBE';
  ctx.font = '16px Sans';
  ctx.fillText(`${guild.name} • Membre #${guild.memberCount.toLocaleString('fr-FR')}`, 280, 200);

  // Rangée de rôle/texte bas
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '14px Sans';
  ctx.fillText(`Rejoint le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`, 280, 252);

  drawFooter(ctx, opts.showFooter);
}

// ─── Style 4 : minimal (carte épurée) ─────────────────────────────────────────
async function drawMinimal(ctx, member, guild, opts) {
  ctx.fillStyle = '#f4f2ee';
  ctx.fillRect(0, 0, W, H);

  // Cadre fin
  ctx.strokeStyle = '#1d1d1f';
  ctx.lineWidth = 2;
  roundRect(ctx, 24, 24, W - 48, H - 48, 18);
  ctx.stroke();

  // Petit accent coloré en haut
  ctx.fillStyle = '#1d1d1f';
  ctx.fillRect(24, 24, 120, 6);
  ctx.fillStyle = '#5865F2';
  ctx.fillRect(24, 24, 40, 6);

  await drawAvatar(ctx, member.user.displayAvatarURL({ extension: 'png', size: 256 }),
    W / 2 - 58, 58, 116, ['#1d1d1f', '#5865F2']);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#1d1d1f';
  ctx.font = 'bold 24px Sans';
  ctx.fillText((opts.headline || 'Bienvenue').toUpperCase(), W / 2, 216);
  ctx.font = 'bold 34px Sans';
  fitText(ctx, member.user.username, W - 200, 34);
  ctx.fillText(member.user.username, W / 2, 254);
  ctx.fillStyle = '#6b6b70';
  ctx.font = '16px Sans';
  ctx.fillText(`${guild.name} — Membre n°${guild.memberCount.toLocaleString('fr-FR')}`, W / 2, 282);
  ctx.textAlign = 'left';

  if (opts.showFooter) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(29,29,31,0.5)';
    ctx.font = 'bold 12px Sans';
    ctx.fillText('BUMPIFY', W / 2, H - 34);
    ctx.textAlign = 'left';
  }
}

// ─── Point d'entrée unique ────────────────────────────────────────────────────
const STYLES = {
  gradient: drawGradient,
  glass: drawGlass,
  banner: drawBanner,
  minimal: drawMinimal,
};

/**
 * Génère l'image de bienvenue selon la configuration.
 * @param {GuildMember} member
 * @param {Guild} guild
 * @param {object} config Config Welcome/Farewell (imageStyle, backgroundUrl, imageText, showFooter)
 * @returns {Promise<Buffer>} PNG
 */
async function renderWelcomeImage(member, guild, config) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  let customBgApplied = false;
  if (config?.backgroundUrl) {
    customBgApplied = await drawCustomBackground(ctx, config.backgroundUrl);
  }

  const opts = {
    headline: config?.imageText || null,
    showFooter: config?.showFooter !== false,
  };

  if (customBgApplied) {
    // Fond personnalisé : rendu par-dessus en style gradient simplifié
    await drawAvatar(ctx, member.user.displayAvatarURL({ extension: 'png', size: 256 }),
      W / 2 - 70, 26, 140, ['#5865F2', '#EB459E']);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 20px Sans';
    ctx.fillText((opts.headline || 'BIENVENUE').toUpperCase(), W / 2, 198);
    ctx.fillStyle = '#FFFFFF';
    fitText(ctx, member.user.username, W - 160, 40);
    ctx.fillText(member.user.username, W / 2, 240);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '17px Sans';
    ctx.fillText(`Membre #${guild.memberCount.toLocaleString('fr-FR')} de ${guild.name}`, W / 2, 270);
    ctx.textAlign = 'left';
  } else {
    const style = STYLES[config?.imageStyle] || drawGradient;
    await style(ctx, member, guild, opts);
  }

  return canvas.toBuffer('image/png');
}

module.exports = { renderWelcomeImage, WELCOME_CARD_WIDTH: W, WELCOME_CARD_HEIGHT: H };
