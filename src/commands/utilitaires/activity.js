const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { COLORS } = require('../../utils/embeds');
const os = require('os');

// Canvas compatible Node 20
const { createCanvas } = require('@napi-rs/canvas');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activity')
    .setDescription('📊 Affiche les statistiques Discord en temps réel avec graphique'),

  async execute(interaction) {

    await interaction.deferReply();

    const client = interaction.client;

    // ─── Stats en temps réel ───────────────────────────────
    const wsPing = client.ws.ping;

    const uptimeMs = client.uptime;
    const uptimeHours = Math.floor(uptimeMs / 1000 / 60 / 60);
    const uptimeMinutes = Math.floor((uptimeMs / 1000 / 60) % 60);

    const guildCount = client.guilds.cache.size;
    const memberCount = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);

    const ramUsed = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
    const cpuLoad = os.loadavg()[0].toFixed(2);

    const nodeVersion = process.version;
    const djsVersion = require('discord.js').version;

    // ─── Canvas moderne ─────────────────────────────────────
    const width = 1000;
    const height = 400;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Fond dégradé moderne bleu → violet
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1e2a78');
    gradient.addColorStop(1, '#6a1b9a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Carte glassmorphism
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(40, 40, width - 80, height - 80, 25);
    ctx.fill();
    ctx.stroke();

    // Titre
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px Sans';
    ctx.fillText('Bumpify — Stats en temps réel', 60, 110);

    // ─── Graphique courbe calibré ───────────────────────────
    const graphX = 60;
    const graphY = 150;
    const graphWidth = width - 120;
    const graphHeight = 180;

    // Exemple de données (ping fluctuation)
    const points = [
      wsPing - 15,
      wsPing - 5,
      wsPing,
      wsPing + 10,
      wsPing - 8,
      wsPing + 3,
      wsPing + 12,
      wsPing - 4,
    ];

    const maxVal = Math.max(...points);
    const minVal = Math.min(...points);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();

    points.forEach((value, i) => {
      const x = graphX + (i / (points.length - 1)) * graphWidth;
      const y = graphY + graphHeight - ((value - minVal) / (maxVal - minVal)) * graphHeight;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();

    // ─── Stats textuelles ───────────────────────────────────
    ctx.fillStyle = '#ffffff';
    ctx.font = '26px Sans';

    ctx.fillText(`Ping: ${wsPing}ms`, 60, 360);
    ctx.fillText(`Uptime: ${uptimeHours}h ${uptimeMinutes}m`, 260, 360);
    ctx.fillText(`Serveurs: ${guildCount}`, 480, 360);
    ctx.fillText(`Membres: ${memberCount}`, 700, 360);

    // Export image
    const buffer = canvas.toBuffer('image/png');
    const attachment = new AttachmentBuilder(buffer, { name: 'stats.png' });

    // ─── Embed ──────────────────────────────────────────────
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setAuthor({ name: '📊 Statistiques en temps réel', iconURL: client.user.displayAvatarURL() })
      .setTitle('🔧 Informations système & Discord')
      .setImage('attachment://stats.png')
      .addFields(
        { name: 'Ping WebSocket', value: `${wsPing}ms`, inline: true },
        { name: 'Uptime', value: `${uptimeHours}h ${uptimeMinutes}m`, inline: true },
        { name: 'Serveurs', value: `${guildCount}`, inline: true },
        { name: 'Membres total', value: `${memberCount}`, inline: true },
        { name: 'RAM utilisée', value: `${ramUsed} MB`, inline: true },
        { name: 'Charge CPU', value: `${cpuLoad}`, inline: true },
        { name: 'Node.js', value: `${nodeVersion}`, inline: true },
        { name: 'Discord.js', value: `${djsVersion}`, inline: true },
      )
      .setFooter({ text: `Bumpify • Stats en temps réel` })
      .setTimestamp();

    interaction.editReply({ embeds: [embed], files: [attachment] });
  },
};
