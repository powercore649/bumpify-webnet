const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const User   = require('../../models/User');
const Server = require('../../models/Server');
const ProfileCustom = require('../../models/ProfileCustom');
const { COLORS, errorEmbed } = require('../../utils/embeds');

// ─── Utilitaires canvas ──────────────────────────────────────────────────────

/**
 * Dessine un rectangle arrondi
 */
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

/**
 * Télécharge une image depuis une URL et retourne un ImageData
 */
const { safeLoadImage: loadAvatar } = require('../../utils/safeLoadImage');

/**
 * Génère la stats card en PNG et retourne un Buffer
 */
async function generateProfileCard(user, userStats, serverStats, rank, totalBumpers, custom = null) {
  const W = 800, H = 280;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // ── Couleurs personnalisées (Feature E) — fallback exact sur les valeurs par défaut ──
  const accentBase = (custom?.accentColor) || '#8B1A1A';

  // ── Fond : bannière personnalisée si fournie et chargeable, sinon couleur perso, sinon dégradé par défaut ──
  let bgDrawn = false;
  if (custom?.bannerUrl) {
    const bannerImg = await loadAvatar(custom.bannerUrl);
    if (bannerImg) {
      ctx.save();
      roundRect(ctx, 0, 0, W, H, 20);
      ctx.clip();
      ctx.drawImage(bannerImg, 0, 0, W, H);
      ctx.restore();
      bgDrawn = true;
    }
  }
  if (!bgDrawn && custom?.bgColor) {
    ctx.fillStyle = custom.bgColor;
    roundRect(ctx, 0, 0, W, H, 20);
    ctx.fill();
    bgDrawn = true;
  }
  if (!bgDrawn) {
    // Fond dégradé par défaut (comportement d'origine, inchangé)
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0,   '#1a1b2e');
    bg.addColorStop(0.5, '#16213e');
    bg.addColorStop(1,   '#0f3460');
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, W, H, 20);
    ctx.fill();
  }

  // ── Bande accent gauche ────────────────────────────────────────────────────
  const accent = ctx.createLinearGradient(0, 0, 0, H);
  accent.addColorStop(0, accentBase);
  accent.addColorStop(1, '#57F287');
  ctx.fillStyle = accent;
  roundRect(ctx, 0, 0, 6, H, 3);
  ctx.fill();

  // ── Avatar ─────────────────────────────────────────────────────────────────
  const avatarSize = 100;
  const avatarX    = 40;
  const avatarY    = H / 2 - avatarSize / 2;

  // Cercle de fond avatar
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 4, 0, Math.PI * 2);
  const ring = ctx.createLinearGradient(avatarX, avatarY, avatarX + avatarSize, avatarY + avatarSize);
  ring.addColorStop(0, accentBase);
  ring.addColorStop(1, '#57F287');
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.restore();

  // Avatar clippé en cercle
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.clip();

  const avatarImg = await loadAvatar(user.displayAvatarURL({ extension: 'png', size: 128 }));
  if (avatarImg) {
    ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
  } else {
    ctx.fillStyle = '#8B1A1A';
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
  }
  ctx.restore();

  // ── Infos utilisateur ──────────────────────────────────────────────────────
  const textX = avatarX + avatarSize + 30;

  // Nom d'utilisateur
  ctx.fillStyle = '#FFFFFF';
  ctx.font      = 'bold 28px Sans';
  ctx.fillText(user.username, textX, avatarY + 32);

  // Tag / discriminateur
  ctx.fillStyle = '#B9BBBE';
  ctx.font      = '16px Sans';
  ctx.fillText(`@${user.username}`, textX, avatarY + 55);

  // ── Barre de progression (rank) ────────────────────────────────────────────
  const barX  = textX;
  const barY  = avatarY + 72;
  const barW  = 340;
  const barH  = 16;
  const progress = totalBumpers > 1 ? Math.max(0.05, 1 - (rank - 1) / (totalBumpers - 1)) : 1;

  // Fond barre
  ctx.fillStyle = '#2C2F33';
  roundRect(ctx, barX, barY, barW, barH, 8);
  ctx.fill();

  // Remplissage barre
  if (progress > 0) {
    const barGrad = ctx.createLinearGradient(barX, barY, barX + barW * progress, barY);
    barGrad.addColorStop(0, '#8B1A1A');
    barGrad.addColorStop(1, '#57F287');
    ctx.fillStyle = barGrad;
    roundRect(ctx, barX, barY, barW * progress, barH, 8);
    ctx.fill();
  }

  ctx.fillStyle = '#B9BBBE';
  ctx.font      = '12px Sans';
  ctx.fillText(`Rang #${rank} sur ${totalBumpers} bumpers`, barX, barY + barH + 16);

  // ── Stats boxes ────────────────────────────────────────────────────────────
  const boxes = [
    { label: '🚀 Bumps total',    value: String(userStats?.bumps ?? 0) },
    { label: '🏆 Classement',     value: `#${rank}` },
    { label: '📊 Bumps serveur',  value: String(serverStats?.bumpCount ?? 0) },
  ];

  const boxW   = 160;
  const boxH   = 70;
  const boxGap = 18;
  const boxStartX = textX;
  const boxStartY = avatarY + 118;

  boxes.forEach((box, idx) => {
    const bx = boxStartX + idx * (boxW + boxGap);
    const by = boxStartY;

    // Fond box
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, bx, by, boxW, boxH, 10);
    ctx.fill();

    // Bordure subtile
    ctx.strokeStyle = 'rgba(88,101,242,0.4)';
    ctx.lineWidth   = 1;
    roundRect(ctx, bx, by, boxW, boxH, 10);
    ctx.stroke();

    // Valeur
    ctx.fillStyle = '#FFFFFF';
    ctx.font      = 'bold 24px Sans';
    ctx.textAlign = 'center';
    ctx.fillText(box.value, bx + boxW / 2, by + 32);

    // Label
    ctx.fillStyle = '#B9BBBE';
    ctx.font      = '12px Sans';
    ctx.fillText(box.label, bx + boxW / 2, by + 52);

    ctx.textAlign = 'left';
  });

  // ── Dernier bump ────────────────────────────────────────────────────────────
  if (userStats?.lastBump) {
    const date = new Date(userStats.lastBump).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
    ctx.fillStyle = '#72767D';
    ctx.font      = '13px Sans';
    ctx.fillText(`Dernier bump: ${date}`, textX, H - 22);
  }

  // ── Badges (Feature E) — affichés seulement si showBadges !== false et badges présents ──
  if (custom?.showBadges !== false && custom?._badgeEmojis?.length) {
    ctx.font = '20px Sans';
    ctx.textAlign = 'left';
    const badgeText = custom._badgeEmojis.slice(0, 8).join(' ');
    ctx.fillText(badgeText, textX, H - 22);
  }

  // ── Logo Bumpify (coin bas-droit) ──────────────────────────────────────────
  ctx.fillStyle = accentBase;
  ctx.font      = 'bold 13px Sans';
  ctx.textAlign = 'right';
  ctx.fillText('Bumpify', W - 24, H - 22);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

// ─── Commande ────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('🎖️ Voir la carte de profil bump d\'un utilisateur')
    .addUserOption(o =>
      o.setName('utilisateur')
        .setDescription('Utilisateur à voir (vous par défaut)')
        .setRequired(false)
    ),

  async execute(interaction, client) {
    await interaction.deferReply();

    const target = interaction.options.getUser('utilisateur') || interaction.user;
    const guild  = interaction.guild;

    // Récupérer les stats utilisateur
    const userStats = await User.findOne({ userId: target.id, guildId: guild.id });

    // Récupérer les stats serveur
    const serverStats = await Server.findOne({ guildId: guild.id });

    // Calculer le rang
    let rank = 1;
    let totalBumpers = 1;
    if (userStats && userStats.bumps > 0) {
      rank = await User.countDocuments({ guildId: guild.id, bumps: { $gt: userStats.bumps } }) + 1;
      totalBumpers = await User.countDocuments({ guildId: guild.id, bumps: { $gt: 0 } });
    }

    // Construire l'embed de secours (si canvas échoue)
    const fallbackEmbed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle(`🎖️ Profil Bump — ${target.username}`)
      .setThumbnail(target.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: '🚀 Bumps effectués', value: `**${userStats?.bumps ?? 0}**`,  inline: true },
        { name: '🏆 Classement',      value: `**#${rank}**`,                   inline: true },
        { name: '📊 Bumps serveur',   value: `**${serverStats?.bumpCount ?? 0}**`, inline: true },
      )
      .setFooter({ text: 'Bumpify • Profil Bump' })
      .setTimestamp();

    if (userStats?.lastBump) {
      fallbackEmbed.addFields({
        name:  '🕐 Dernier bump',
        value: `<t:${Math.floor(new Date(userStats.lastBump).getTime() / 1000)}:R>`,
        inline: true,
      });
    }

    if (!userStats || userStats.bumps === 0) {
      fallbackEmbed.setDescription(
        target.id === interaction.user.id
          ? '❌ Vous n\'avez pas encore bumpé ce serveur. Utilisez `/bump` pour commencer!'
          : `❌ **${target.username}** n'a pas encore bumpé ce serveur.`
      );
      return interaction.editReply({ embeds: [fallbackEmbed] });
    }

    // Générer la stats card canvas
    try {
      const member = await guild.members.fetch(target.id).catch(() => null) || target;

      // ── Personnalisation du profil (Feature E) — récupération sans impact si absente ──
      let custom = null;
      try {
        custom = await ProfileCustom.findOne({ userId: target.id, guildId: guild.id });
        if (custom?.showBadges !== false) {
          const { Badge, UserBadge } = require('../../models/Badge');
          const owned = await UserBadge.find({ userId: target.id, guildId: guild.id });
          if (owned.length) {
            const badgeIds = owned.map(o => o.badgeId);
            const badges = await Badge.find({ guildId: guild.id, badgeId: { $in: badgeIds } });
            if (custom) custom._badgeEmojis = badges.map(b => b.emoji);
            else custom = { _badgeEmojis: badges.map(b => b.emoji) };
          }
        }
      } catch (_) {}

      const cardBuffer = await generateProfileCard(target, userStats, serverStats, rank, totalBumpers, custom);
      const attachment = new AttachmentBuilder(cardBuffer, { name: 'profile-bump.png' });

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setImage('attachment://profile-bump.png')
        .setFooter({ text: 'Bumpify • Stats Card', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (err) {
      console.error('❌ Profile canvas error:', err.message);
      // Fallback propre si canvas indisponible
      return interaction.editReply({ embeds: [fallbackEmbed] });
    }
  },
};
