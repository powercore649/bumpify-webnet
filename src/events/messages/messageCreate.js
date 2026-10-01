// events/messageCreate.js — AutoMod + XP + inter-serveur + ping bot
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const InterServer = require('../../models/InterServer');
const { relayMessage } = require('../../utils/interServerRelay');
const { COLORS } = require('../../utils/embeds');
const blacklist = require('../../utils/blacklist');

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {

    // ── Blacklist globale — ignore tout message de serveur blacklisté ─────
    if (message.guild && blacklist.isBlacklisted(message.guildId)) return;

    // ── Anti-raid : honeypots — écrire dans un salon-piège = bot confirmé ──
    if (message.guild && !message.author.bot) {
      try {
        const Honeypot = require('../../models/AntiRaid').Honeypot;
        const hp = await Honeypot.findOne({ guildId: message.guild.id, channelId: message.channel.id });
        if (hp) {
          const { triggerHoneypot } = require('../../utils/antiraidActions');
          await triggerHoneypot(client, message.guild, hp, message.author.id);
          await message.delete().catch(() => {});
          return;
        }
      } catch (err) { console.error('[anti-raid] honeypot:', err.message); }
    }


    // ── ModMail — Messages privés (DM) ────────────────────────────────────
    if (!message.guild && !message.author.bot) {
      try {
        if (message.partial) await message.fetch().catch(() => {});

        const { ModMailConfig } = require('../../models/ModMail');
        const { openThread, relayToThread } = require('../../commands/moderation/modmail');
        const { ModMailThread } = require('../../models/ModMail');

        const existingThread = await ModMailThread.findOne({
          userId: message.author.id,
          status: 'open',
        });

        if (existingThread) {
          const config = await ModMailConfig.findOne({ guildId: existingThread.guildId, enabled: true });
          if (config) {
            const guild = client.guilds.cache.get(existingThread.guildId);
            if (guild) {
              await relayToThread(client, message, existingThread, config, guild);
              return;
            }
          }
        }

        const configs = await ModMailConfig.find({ enabled: true });
        let handled = false;

        for (const cfg of configs) {
          const guild = client.guilds.cache.get(cfg.guildId);
          if (!guild) continue;

          let isMember = guild.members.cache.has(message.author.id);
          if (!isMember) {
            const fetched = await guild.members.fetch(message.author.id).catch(() => null);
            isMember = !!fetched;
          }
          if (!isMember) continue;

          await openThread(client, message, cfg.guildId);
          handled = true;
          break;
        }

        if (!handled) {
          await message.author.send({
            embeds: [new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle('<a:943832_alertastaff2000:1525351980065751101> ModMail indisponible')
              .setDescription("Vous n'êtes membre d'aucun serveur utilisant Bumpify ModMail, ou le système est désactivé.")],
          }).catch(() => {});
        }
      } catch (err) {
        console.error('ModMail DM:', err.message);
      }
      return;
    }

    if (message.author.bot || !message.guild) return;

    // ── Préfixe hybride (b!ping → /ping) — avant tout le reste ─────────────
    // Ne s'active que si le serveur a activé un préfixe via /prefix. Si le
    // message est une commande préfixée (même inconnue), on s'arrête là :
    // le préfixe court-circuite XP, AutoMod, counting, relais, etc.
    try {
      const { handlePrefixMessage, getGuildConfig } = require('../../utils/prefixCommands');
      const cfg = await getGuildConfig(message.guildId);
      if (cfg && message.content?.startsWith(cfg.prefix)) {
        const handled = await handlePrefixMessage(message, client);
        if (handled) return;
      }
    } catch (err) {
      console.error('❌ Préfixe:', err.message);
    }

    // ── Counting Game (comptage collaboratif) ──────────────────────────────
    try {
      const { handleCountingMessage } = require('../../utils/countingGame');
      const handled = await handleCountingMessage(message);
      if (handled) return; // ne pas traiter ce message plus loin (AutoMod, XP, etc.)
    } catch (err) {
      console.error('❌ Counting Game:', err.message);
    }

    // ── Honeypot (salon piège anti-bot / anti-token-grabber) ───────────────
    try {
      const Honeypot = require('../../models/Honeypot');
      const hpCfg = await Honeypot.findOne({ guildId: message.guild.id, enabled: true });
      if (hpCfg && hpCfg.channelIds.includes(message.channel.id)) {
        const { handleTrigger } = require('../../commands/moderation/honeypot');
        await handleTrigger(message, hpCfg);
        return; // ne pas traiter ce message plus loin (AutoMod, XP, etc.)
      }
    } catch (err) {
      console.error('❌ Honeypot — erreur complète ci-dessous :');
      console.error(err);
    }

    // ── AI Playground (salon de chat avec l'IA, bascule de modèle / verrou auto) ──
    try {
      const AiPlaygroundConfig = require('../../models/AiPlaygroundConfig');
      const aiCfg = await AiPlaygroundConfig.findOne({ guildId: message.guild.id, channelId: message.channel.id });
      if (aiCfg) {
        const { handleAiPlaygroundMessage } = require('../../utils/aiPlaygroundHandler');
        await handleAiPlaygroundMessage(message, aiCfg, client);
        return; // salon dédié : ne pas traiter plus loin (AutoMod, XP, etc.)
      }
    } catch (err) {
      console.error('❌ AI Playground — erreur complète ci-dessous :');
      console.error(err);
    }

    // ── Demande de MP (salon "boîte de demandes" -> embed + fil) ──────────────
    try {
      const MpRequestConfig = require('../../models/MpRequestConfig');
      const mpCfg = await MpRequestConfig.findOne({ guildId: message.guild.id, enabled: true, channelId: message.channel.id });
      if (mpCfg) {
        const { handleMpRequestMessage } = require('../../utils/mpRequestHandler');
        await handleMpRequestMessage(message, mpCfg);
        return; // salon dédié : ne pas traiter plus loin (AutoMod, XP, etc.)
      }
    } catch (err) {
      console.error('❌ Demande de MP — erreur complète ci-dessous :');
      console.error(err);
    }

    // ── Ping du bot (VERSION MODERNISÉE + NO PING USER) ───────────────────
    if (
      message.mentions.has(client.user) &&
      message.content.trim().replace(/\s/g, '') === `<@${client.user.id}>`
    ) {
      const networkCount = await InterServer.countDocuments({ active: true }).catch(() => 0);
      const networkEntry = await InterServer.findOne({ guildId: message.guild.id, active: true }).catch(() => null);

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setAuthor({
          name: `✨ ${client.user.username}`,
          iconURL: client.user.displayAvatarURL()
        })
        .setTitle('<a:neon_wave:1525351980065751101> **Hey, tu m’as ping ?**')
        .setDescription([
          'Je suis **Bumpify**, un bot conçu pour connecter les communautés Discord à travers un réseau inter‑serveurs ultra‑rapide.',
          '',
          '<a:neon_arrow:1525351940777709779> **Besoin d’aide ?** Utilise `/help` pour voir toutes mes fonctionnalités.',
          '',
          '⚡ *Toujours prêt à faire grandir ton serveur.*'
        ].join('\n'))
        .addFields(
          {
            name: '🚀 Démarrage rapide',
            value: [
              '`/config` → Configurer le serveur',
              '`/bump` → Rejoindre le réseau',
              '`/panel` → Panel central'
            ].join('\n'),
            inline: true
          },
          {
            name: '🛡️ Sécurité',
            value: [
              '`/captcha` → Vérification humaine',
              '`/automod` → Anti‑spam / anti‑raid / anti‑liens'
            ].join('\n'),
            inline: true
          },
          {
            name: '📊 Statistiques globales',
            value: [
              `🌍 Serveurs connectés : **${client.guilds.cache.size}**`,
              `📡 Liaisons actives : **${networkCount}**`,
              networkEntry
                ? `🟢 Réseau actuel : \`${networkEntry.networkName}\``
                : '🔴 Ce serveur n’est pas encore dans un réseau'
            ].join('\n'),
            inline: false
          }
        )
        .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
       .setImage('https://media.discordapp.net/attachments/1519886439964475463/1527847149889523772/ee4f41acd8a78e41af9f85c7110e7885.webp?ex=6a5c260a&is=6a5ad48a&hm=3388dc2a78657de5ef89e1e4d6d063519ceb676caa9c6596cc989c2ea2490ba6&=&format=webp&width=768&height=270')
        .setFooter({
          text: `Bumpify • Latence : ${client.ws.ping}ms`,
          iconURL: client.user.displayAvatarURL()
        })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('⚙️ Panel config')
          .setStyle(ButtonStyle.Primary)
          .setCustomId('ping_open_panel'),

        new ButtonBuilder()
          .setLabel('🌐 Inter‑Serveur')
          .setStyle(ButtonStyle.Secondary)
          .setCustomId('ping_open_interserveur'),

        new ButtonBuilder()
          .setLabel('📖 Aide')
          .setStyle(ButtonStyle.Secondary)
          .setCustomId('ping_open_help'),

        new ButtonBuilder()
          .setLabel('🔗 Inviter Bumpify')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`)
      );

      await message.reply({
        embeds: [embed],
        components: [row],
        allowedMentions: { repliedUser: false } // ← empêche le ping du membre
      }).catch(() => {});
      return;
    }

    // ── AutoMod ───────────────────────────────────────────────────────────
    try {
      const AutoMod = require('../../models/AutoMod');
      const cfg = await AutoMod.findOne({ guildId: message.guild.id }).lean();
      if (cfg && (cfg.spamEnabled || cfg.linksEnabled || cfg.capsEnabled)) {
        const { handleMessage: autoModHandle } = require('../../commands/moderation/automod');
        await autoModHandle(message);
      }
    } catch (_) {}

    // ── XP ────────────────────────────────────────────────────────────────
    try {
      const { handleMessage: xpHandle } = require('../../commands/xp/xp');
      await xpHandle(message);
    } catch (err) {
      console.error('❌ XP:', err.message);
    }

    // ── Relai inter-serveur ───────────────────────────────────────────────
    try {
      const config = await InterServer.findOne({ channelId: message.channel.id, guildId: message.guild.id, active: true });
      if (config) await relayMessage(message, config);
    } catch (err) {
      console.error('❌ messageCreate relai:', err.message);
    }

    // ── Auto-Thread avancé (Feature 1) ─────────────────────────────────────
    try {
      const AutoThread = require('../../models/AutoThread');
      const atCfg = await AutoThread.findOne({ guildId: message.guild.id, enabled: true }).lean();
      if (atCfg && message.channel && typeof message.startThread === 'function' && !message.hasThread) {
        const inInclude = atCfg.includeChannels.length === 0 || atCfg.includeChannels.includes(message.channel.id);
        const inExclude = atCfg.excludeChannels.includes(message.channel.id);

        if (inInclude && !inExclude) {
          let allowed = true;
          if (atCfg.restrictRoleId) {
            allowed = !!(message.member && message.member.roles.cache.has(atCfg.restrictRoleId));
          }

          if (allowed) {
            let shouldCreate = true;

            if (atCfg.onlyFirstMessagePerUser) {
              if (!module.exports._firstMsgMap) module.exports._firstMsgMap = new Map();
              const map = module.exports._firstMsgMap;
              const dayKey = new Date().toISOString().slice(0, 10);
              const key = `${message.channel.id}:${message.author.id}:${dayKey}`;
              if (map.has(key)) {
                shouldCreate = false;
              } else {
                map.set(key, true);
              }
            }

            if (shouldCreate) {
              const threadName = (atCfg.threadNameTemplate || 'Discussion de {username}')
                .replace('{username}', message.author.username)
                .slice(0, 100);

              await message.startThread({
                name: threadName,
                autoArchiveDuration: atCfg.autoArchiveDuration,
                rateLimitPerUser: atCfg.slowmodeSeconds || 0,
              }).catch(() => {});
            }
          }
        }
      }
    } catch (_) {}

    // ── Auto-modération avancée (Feature 2) ─────────────────────────────────
    try {
      const AutoModAdvanced = require('../../models/AutoModAdvanced');
      const advCfg = await AutoModAdvanced.findOne({ guildId: message.guild.id }).lean();
      if (advCfg && message.member && !message.author.bot) {
        const { handleAdvancedAutoMod } = require('../../utils/automodAdvanced');
        await handleAdvancedAutoMod(message, advCfg).catch(() => {});
      }
    } catch (_) {}

  },
};