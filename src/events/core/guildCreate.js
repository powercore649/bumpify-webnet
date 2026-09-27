const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Server = require('../../models/Server');
const { COLORS } = require('../../utils/embeds');
const blacklist = require('../../utils/blacklist');

module.exports = {
  name: 'guildCreate',
  async execute(guild, client) {
    console.log(`➕ Rejoint: ${guild.name} (${guild.memberCount} membres)`);

    // ── Blacklist globale — le bot quitte immédiatement tout serveur blacklisté ──
    if (blacklist.isBlacklisted(guild.id)) {
      console.warn(`⛔ ${guild.name} (${guild.id}) est blacklisté — départ automatique.`);
      await guild.leave().catch(err => console.error('guildCreate leave:', err.message));
      return;
    }

    await Server.findOneAndUpdate(
      { guildId: guild.id },
      { guildName: guild.name, guildIcon: guild.iconURL({ dynamic: true }), memberCount: guild.memberCount },
      { upsert: true }
    );

    // ── Invitations avancées : amorçage du cache dès l'arrivée sur le serveur ─
    try {
      const { primeGuildCache } = require('../../utils/inviteCache');
      await primeGuildCache(guild);
    } catch (err) {
      console.error(`[inviteCache] amorçage guildCreate échoué pour ${guild.id}:`, err.message);
    }

    // ── DM à l'owner du serveur ───────────────────────────────────────────
    try {
      const owner = await guild.fetchOwner();
      const dmEmbed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('🎉 Merci d\'avoir ajouté Bumpify !')
        .setDescription(
          `Bonjour **${owner.user.username}** !\n\n` +
          `Bumpify vient d'être ajouté sur **${guild.name}**.\n` +
          `Je suis un bot de **bumping inter-serveurs** — chaque bump diffuse votre serveur sur tout le réseau Bumpify !\n\n` +
          `**⚡ Pour commencer en 4 étapes :**\n` +
          `1️⃣ \`/config\` — Ajoutez une description et un lien d'invitation\n` +
          `2️⃣ \`/config\` → **Salon feed** — Recevez les bumps du réseau\n` +
          `3️⃣ \`/config\` → **Salon bump** — Définissez où utiliser \`/bump\`\n` +
          `4️⃣ \`/bump\` — Rejoignez le réseau ! (cooldown : **2h**)\n\n` +
          `**🔒 Sécurité recommandée :**\n` +
          `• \`/captcha\` — Vérification humaine à l'arrivée\n` +
          `• \`/automod\` — Anti-spam, anti-raid, anti-liens\n\n` +
          `**📖 Aide complète :** \`/help\`\n` +
          `**⚙️ Panel central :** \`/panel\``
        )
        .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: '🌍 Serveurs dans le réseau', value: `**${client.guilds.cache.size}**`, inline: true },
          { name: '⏱️ Cooldown bump',            value: '**2 heures**',                   inline: true },
          { name: '💰 Récompense par bump',       value: '**50 coins**',                   inline: true },
        )
        .setFooter({ text: 'Bumpify • Bumpez pour grandir !', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('📖 Documentation').setStyle(ButtonStyle.Link).setURL('https://discord.gg/bumpbot'),
        new ButtonBuilder().setLabel('💬 Support').setStyle(ButtonStyle.Link).setURL('https://discord.gg/bumpbot'),
      );

      await owner.send({ embeds: [dmEmbed], components: [row] });
    } catch (err) {
      console.warn(`⚠️ DM owner impossible pour ${guild.name}: ${err.message}`);
    }

    // ── Message de bienvenue dans le serveur ──────────────────────────────
    const channel = guild.systemChannel ||
      guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has('SendMessages'));
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle('👋 Merci d\'avoir invité Bumpify !')
      .setDescription([
        '**Bumpify** connecte votre serveur à un réseau inter-serveurs !',
        '',
        '**⚡ Pour commencer :**',
        '1. `/config` — Configurez la description et l\'invitation',
        '2. `/config` → Salon feed — Recevez les bumps du réseau',
        '3. `/bump` — Bumpez toutes les **2 heures** !',
        '',
        '**📖** Tapez `/help` pour l\'aide complète.',
        '**⚙️** Tapez `/panel` pour le panel central.',
      ].join('\n'))
      .setThumbnail(client.user.displayAvatarURL())
      .setFooter({ text: 'Bumpify • Bumpez pour grandir !' });

    channel.send({ embeds: [embed] }).catch(() => {});
  },
};
