// commands/welcome-image.js — Image de bienvenue canvas configurable
const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const { safeLoadImage } = require('../../utils/safeLoadImage');
const { COLORS, successEmbed } = require('../../utils/embeds');

function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}

async function generateWelcomeImage(member, guild) {
  const W=900, H=300, canvas=createCanvas(W,H), ctx=canvas.getContext('2d');

  const bg=ctx.createLinearGradient(0,0,W,H);
  bg.addColorStop(0,'#0d1117'); bg.addColorStop(0.5,'#161b22'); bg.addColorStop(1,'#21262d');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // Grille décorative
  ctx.strokeStyle='rgba(88,101,242,0.08)'; ctx.lineWidth=1;
  for(let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=0;y<H;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}

  // Bandes latérales
  const l=ctx.createLinearGradient(0,0,0,H);
  l.addColorStop(0,'#5865F2'); l.addColorStop(1,'#EB459E');
  ctx.fillStyle=l; ctx.fillRect(0,0,6,H); ctx.fillRect(W-6,0,6,H);

  // Avatar
  const aSize=130, aX=W/2-aSize/2, aY=22;
  ctx.save(); ctx.beginPath(); ctx.arc(aX+aSize/2,aY+aSize/2,aSize/2+5,0,Math.PI*2);
  const ring=ctx.createLinearGradient(aX,aY,aX+aSize,aY+aSize);
  ring.addColorStop(0,'#5865F2'); ring.addColorStop(1,'#EB459E');
  ctx.fillStyle=ring; ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(aX+aSize/2,aY+aSize/2,aSize/2,0,Math.PI*2); ctx.clip();
  const img = await safeLoadImage(member.user.displayAvatarURL({extension:'png',size:256}));
  if (img) { ctx.drawImage(img,aX,aY,aSize,aSize); }
  else { ctx.fillStyle='#5865F2'; ctx.fillRect(aX,aY,aSize,aSize); }
  ctx.restore();

  // Textes
  ctx.textAlign='center';
  ctx.fillStyle='rgba(88,101,242,0.9)'; ctx.font='bold 18px Sans';
  ctx.fillText('BIENVENUE', W/2, 180);
  ctx.fillStyle='#fff'; ctx.font='bold 36px Sans';
  ctx.fillText(member.user.username, W/2, 220);
  ctx.fillStyle='#B9BBBE'; ctx.font='16px Sans';
  ctx.fillText(`Membre #${guild.memberCount} de ${guild.name}`, W/2, 248);

  // Ligne déco bas
  const line=ctx.createLinearGradient(100,0,W-100,0);
  line.addColorStop(0,'transparent'); line.addColorStop(0.5,'#5865F2'); line.addColorStop(1,'transparent');
  ctx.strokeStyle=line; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(100,268); ctx.lineTo(W-100,268); ctx.stroke();

  ctx.fillStyle='#5865F2'; ctx.font='bold 13px Sans';
  ctx.fillText('Bumpify', W/2, H-14);
  ctx.textAlign='left';
  return canvas.toBuffer('image/png');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome-image')
    .setDescription('🖼️ Prévisualiser l\'image de bienvenue canvas')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('utilisateur').setDescription('Utilisateur à simuler (vous par défaut)')),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getMember('utilisateur') || interaction.member;
    try {
      const buf = await generateWelcomeImage(target, interaction.guild);
      return interaction.editReply({
        content: '✅ Aperçu de l\'image de bienvenue :',
        files: [new AttachmentBuilder(buf, { name: 'welcome.png' })],
      });
    } catch(err) {
      console.error('welcome-image canvas:', err);
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.error).setTitle('❌ Erreur canvas').setDescription(err.message)] });
    }
  },

  generateWelcomeImage,
};
