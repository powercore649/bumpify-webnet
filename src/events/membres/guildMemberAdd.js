const { EmbedBuilder } = require('discord.js');
const { Welcome } = require('../../models/Welcome');
const Invite = require('../../models/Invite');
const { CaptchaConfig } = require('../../models/Captcha');
const InviteConfig = require('../../models/InviteConfig');
const InviteUse = require('../../models/InviteUse');
const OnboardingConfig = require('../../models/OnboardingConfig');
const { resolveInviteForJoin } = require('../../utils/inviteCache');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    const guild = member.guild;

    // ── Onboarding / portail d'accès (priorité absolue si activé) ─────────
    let onboardingActive = false;
    try {
      const obCfg = await OnboardingConfig.findOne({ guildId: guild.id, enabled: true });
      if (obCfg) {
        const { startOnboarding } = require('../../utils/onboardingManager');
        await startOnboarding(member, obCfg);
        onboardingActive = true; // le message de bienvenue classique attendra la fin du portail
      }
    } catch (err) { console.error('guildMemberAdd onboarding:', err); }

    // ── CAPTCHA (priorité absolue si activé) ──────────────────────────────
    try {
      const captchaCfg = await CaptchaConfig.findOne({ guildId: guild.id, enabled: true });
      if (captchaCfg?.channelId) {
        const { sendCaptcha } = require('../../commands/configuration/captcha');
        await sendCaptcha(member, captchaCfg, client);
        // Si captcha activé, on ne fait pas le reste (ou on peut faire welcome quand même)
      }
    } catch (err) { console.error('guildMemberAdd captcha:', err); }

    // ── Bienvenue ──────────────────────────────────────────────────────────
    try {
      const welcome = !onboardingActive ? await Welcome.findOne({ guildId: guild.id, enabled: true }) : null;
      if (welcome?.channelId) {
        const channel = await guild.channels.fetch(welcome.channelId).catch(() => null);
        if (channel?.isTextBased()) {
          const msg = (welcome.message || 'Bienvenue {user} sur **{server}** !')
            .replace('{user}', member.user.tag)
            .replace('{server}', guild.name);

          // Tentative d'image canvas (avec fallback embed simple si échec/timeout)
          let imageAttachment = null;
          try {
            const { AttachmentBuilder } = require('discord.js');
            const { generateWelcomeImage } = require('../../commands/configuration/welcome-image');
            const buf = await Promise.race([
              generateWelcomeImage(member, guild),
              new Promise((_, rej) => setTimeout(() => rej(new Error('welcome-image-timeout')), 6000)),
            ]);
            imageAttachment = new AttachmentBuilder(buf, { name: 'welcome.png' });
          } catch (imgErr) {
            console.warn('[guildMemberAdd] image bienvenue indisponible:', imgErr.message);
          }

          const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('👋 Bienvenue!')
            .setDescription(msg)
            .setTimestamp();

          if (imageAttachment) {
            embed.setImage('attachment://welcome.png');
            await channel.send({ embeds: [embed], files: [imageAttachment] }).catch(() => {});
          } else {
            embed.setThumbnail(member.user.displayAvatarURL());
            await channel.send({ embeds: [embed] }).catch(() => {});
          }
        }
      }
    } catch (_) {}

    // ── Auto-Rôle join (du nouveau système autorole.js) ───────────────────
    try {
      const AutoRole = require('../../models/AutoRole');
      const roles = await AutoRole.find({ guildId: guild.id, type: 'join', enabled: true });
      for (const ar of roles) {
        member.roles.add(ar.roleId).catch(() => {});
      }
    } catch (_) {}

    // ── Tracking invitations ───────────────────────────────────────────────
    try {
      const invites = await guild.invites.fetch();
      for (const [code, inv] of invites) {
        const dbInv = await Invite.findOne({ code, guildId: guild.id });
        if (!dbInv) {
          const inviter = inv.inviter || { tag: 'Inconnu' };
          await Invite.create({
            code, guildId: guild.id,
            createdBy: inviter.id || 'unknown',
            createdByTag: inviter.tag,
            uses: inv.uses || 0,
          });
        } else if (inv.uses > dbInv.uses) {
          dbInv.uses = inv.uses;
          await dbInv.save();
        }
      }
    } catch (_) {}

    // ── Système d'invitations avancé (qui a invité qui) ────────────────────
    try {
      const invCfg = await InviteConfig.findOne({ guildId: guild.id });
      const enabled = invCfg?.enabled !== false; // activé par défaut si pas de config

      if (enabled) {
        const detection = await resolveInviteForJoin(guild);
        const ignored = invCfg?.ignoredCodes || [];
        const isIgnored = detection.code && ignored.includes(detection.code);

        // Anti-fake : compte trop jeune
        const minAgeDays = invCfg?.minAccountAgeDays || 0;
        const accountAgeDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
        const isFake = minAgeDays > 0 && accountAgeDays < minAgeDays;

        if (!isIgnored) {
          await InviteUse.create({
            guildId: guild.id,
            userId: member.id,
            userTag: member.user.tag,
            inviterId: detection.inviterId,
            inviterTag: detection.inviterTag,
            code: detection.code,
            method: detection.method,
            fake: isFake,
            left: false,
          });

          // Total d'invitations actives (net = valides et non-fake) de l'inviteur, pour affichage + rôles bonus
          let totalInvites = 0;
          if (detection.inviterId) {
            totalInvites = await InviteUse.countDocuments({
              guildId: guild.id,
              inviterId: detection.inviterId,
              left: false,
              fake: false,
            });

            // Attribution automatique des rôles de récompense
            try {
              const rewardRoles = invCfg?.rewardRoles || [];
              if (rewardRoles.length) {
                const inviterMember = await guild.members.fetch(detection.inviterId).catch(() => null);
                if (inviterMember) {
                  const eligible = rewardRoles.filter(r => totalInvites >= r.threshold);
                  for (const r of eligible) {
                    if (!inviterMember.roles.cache.has(r.roleId)) {
                      await inviterMember.roles.add(r.roleId).catch(() => {});
                    }
                  }
                }
              }
            } catch (_) {}
          }

          // Annonce dans le salon configuré
          if (invCfg?.announceChannelId && invCfg.announceJoin !== false) {
            const ch = await guild.channels.fetch(invCfg.announceChannelId).catch(() => null);
            if (ch?.isTextBased()) {
              const templateRaw = detection.code
                ? (invCfg.joinMessage || '{user} a rejoint en utilisant l\'invitation de **{inviter}** (`{code}`) — {inviter} totalise maintenant **{totalInvites}** invitation(s).')
                : (invCfg.joinMessageUnknown || '{user} a rejoint le serveur, mais l\'invitation utilisée n\'a pas pu être déterminée.');

              const text = templateRaw
                .replaceAll('{user}', `<@${member.id}>`)
                .replaceAll('{server}', guild.name)
                .replaceAll('{inviter}', detection.inviterId ? `<@${detection.inviterId}>` : detection.inviterTag)
                .replaceAll('{inviterTag}', detection.inviterTag)
                .replaceAll('{code}', detection.code || 'inconnu')
                .replaceAll('{totalInvites}', String(totalInvites));

              await ch.send({
                embeds: [new EmbedBuilder()
                  .setColor(isFake ? 0xFEE75C : 0x57F287)
                  .setDescription(text + (isFake ? '\n⚠️ *Compte récent — non comptabilisé dans le total (anti-fake).*' : ''))
                  .setThumbnail(member.user.displayAvatarURL())
                  .setTimestamp()
                ],
              }).catch(() => {});
            }
          }
        }
      }
    } catch (err) { console.error('guildMemberAdd invites-avancé:', err); }

    // ── ModLog ─────────────────────────────────────────────────────────────
    try {
      const { sendModLog, ModlogConfig } = require('../../commands/moderation/modlog');
      const mlCfg = await ModlogConfig.findOne({ guildId: guild.id, enabled: true });
      if (mlCfg?.events?.memberJoin !== false) {
        await sendModLog(client, guild.id, new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('👋 Membre rejoint')
          .setDescription(`<@${member.id}> a rejoint le serveur.`)
          .addFields(
            { name: '👤 Utilisateur', value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
            { name: '📅 Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
          )
          .setThumbnail(member.user.displayAvatarURL())
          .setTimestamp()
        );
      }
    } catch (_) {}

    // ── Logs configurables : arrivée de membre (Feature 3) ────────────────
    try {
      const GuildLogs = require('../../models/GuildLogs');
      const logsCfg = await GuildLogs.findOne({ guildId: guild.id });
      if (logsCfg?.membres?.enabled && logsCfg.membres.channelId) {
        const ch = await guild.channels.fetch(logsCfg.membres.channelId).catch(() => null);
        if (ch?.isTextBased()) {
          await ch.send({
            embeds: [new EmbedBuilder()
              .setColor(0x57F287)
              .setTitle('📥 Arrivée d\'un membre')
              .addFields(
                { name: '👤 Utilisateur', value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
                { name: '📅 Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
              )
              .setThumbnail(member.user.displayAvatarURL())
              .setTimestamp()
            ],
          }).catch(() => {});
        }
      }
    } catch (_) {}
    // ── Raid mode automatique configurable (Feature C) ──────────────────────
    try {
      const AutoMod = require('../../models/AutoMod');
      const { triggerRaidMode } = require('../../commands/moderation/raidmode');
      const cfg = await AutoMod.findOne({ guildId: guild.id });

      if (cfg?.raidAutoTrigger) {
        const now = Date.now();
        // Réutilise la même fenêtre/seuil que l'anti-raid classique (cfg.raidThreshold / cfg.raidWindow)
        if (!global.__raidAutoCache) global.__raidAutoCache = new Map();
        const cache = global.__raidAutoCache;
        const data = cache.get(guild.id) || { count: 0, firstJoin: now };

        if (now - data.firstJoin > cfg.raidWindow) {
          data.count = 1; data.firstJoin = now;
        } else {
          data.count += 1;
        }
        cache.set(guild.id, data);

        // Vérification d'âge de compte si configuré (action kick_new)
        const accountAgeDays = (now - member.user.createdTimestamp) / 86_400_000;
        const accountTooYoung = cfg.raidMinAccountAge > 0 && accountAgeDays < cfg.raidMinAccountAge;

        if (data.count >= cfg.raidThreshold && !cfg.raidModeActive) {
          data.count = 0;
          cache.set(guild.id, data);

          cfg.raidModeActive = true;
          cfg.raidModeActivatedAt = new Date();
          await cfg.save();

          if (cfg.raidAutoAction === 'lock') {
            await triggerRaidMode(guild, true);
          } else if (cfg.raidAutoAction === 'kick_new') {
            // Kick les comptes trop récents qui rejoignent pendant le raid
            if (accountTooYoung) await member.kick('Anti-raid automatique : compte trop récent').catch(() => {});
          } else if (cfg.raidAutoAction === 'verify') {
            // Active le captcha existant si un salon est configuré
            try {
              const { CaptchaConfig } = require('../../models/Captcha');
              await CaptchaConfig.findOneAndUpdate({ guildId: guild.id }, { enabled: true }, { upsert: true });
            } catch (_) {}
          }

          // Log
          try {
            const { sendModLog, ModlogConfig } = require('../../commands/moderation/modlog');
            const mlCfg = await ModlogConfig.findOne({ guildId: guild.id, enabled: true });
            if (mlCfg) {
              await sendModLog(client, guild.id, new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle('🚨 Mode raid automatique déclenché')
                .setDescription(`Seuil de **${cfg.raidThreshold} joins / ${cfg.raidWindow / 1000}s** atteint.\nAction appliquée : **${cfg.raidAutoAction}**`)
                .setTimestamp());
            }
          } catch (_) {}

          // Auto-désactivation après N minutes si configuré
          if (cfg.raidAutoDisableMin > 0) {
            setTimeout(async () => {
              try {
                const fresh = await AutoMod.findOne({ guildId: guild.id });
                if (!fresh?.raidModeActive) return;
                fresh.raidModeActive = false;
                fresh.raidModeActivatedAt = null;
                await fresh.save();
                if (fresh.raidAutoAction === 'lock') await triggerRaidMode(guild, false);
              } catch (_) {}
            }, cfg.raidAutoDisableMin * 60 * 1000);
          }
        } else if (cfg.raidModeActive && cfg.raidAutoAction === 'kick_new' && accountTooYoung) {
          // Pendant un raid actif déclenché en mode kick_new, continuer à kicker les nouveaux comptes récents
          await member.kick('Anti-raid automatique : compte trop récent').catch(() => {});
        }
      }
    } catch (err) { console.error('guildMemberAdd raid auto:', err); }

    console.log(`✅ ${member.user.tag} a rejoint ${guild.name}`);
  },
};
