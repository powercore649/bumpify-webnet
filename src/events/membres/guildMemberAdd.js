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

    // ── ANTI-RAID — si le membre vient d'être banni/kické par la protection, stop ici ──
    try {
      const AntiRaid = require('../../models/AntiRaid').AntiRaid;
      const cfg = await AntiRaid.findOne({ guildId: guild.id, enabled: true }).lean();
      if (cfg) {
        if ((cfg.bannedUserIds || []).includes(member.id)) return; // déjà géré par l'event antiraid (kick/ban appliqué)
        if (cfg.lockdownActive && cfg.response?.lockdown) {
          // Serveur verrouillé : on refuse l'arrivée des comptes trop récents
          const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
          if (ageDays < (cfg.minAccountAgeDays || 0)) {
            await member.kick('Anti-raid : serveur verrouillé, compte trop récent').catch(() => {});
            return;
          }
        }
      }
    } catch (_) {}

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

    // ── Détection d'invitation — UNE seule fois, partagée par Bienvenue+ et
    //    les annonces avancées (le second appel ne verrait aucun delta) ─────
    let inviteDetection = { code: null, inviterId: null, inviterTag: 'Inconnu', method: 'unknown' };
    try {
      inviteDetection = await resolveInviteForJoin(guild);
    } catch (err) { console.error('guildMemberAdd inviteCache:', err.message); }

    // ── Bienvenue+ (message, image canvas, MP, boutons, compteur, stats) ────
    try {
      const welcome = !onboardingActive ? await Welcome.findOne({ guildId: guild.id, enabled: true }) : null;
      if (welcome) {
        const {
          sendWelcome, sendWelcomeDM, updateMemberCounter, recordJoinStats,
        } = require('../../utils/welcomeManager');

        const ctx = {
          member, guild, client,
          inviterId: inviteDetection.inviterId || null,
          inviteCode: inviteDetection.code || null,
          inviteCount: null,
        };
        if (ctx.inviterId) {
          ctx.inviteCount = await InviteUse.countDocuments({
            guildId: guild.id,
            inviterId: ctx.inviterId,
            left: false,
            fake: false,
          });
        }

        await sendWelcome(member, welcome, ctx);
        await sendWelcomeDM(member, welcome, ctx);
        await updateMemberCounter(guild, welcome);
        await recordJoinStats(Welcome, guild);
      }
    } catch (err) { console.error('guildMemberAdd bienvenue:', err.message); }

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
        // Déjà résolue en tête d'event et partagée avec Bienvenue+ (le cache
        // est déjà à jour — re-résoudre donnerait 'unknown')
        const detection = inviteDetection;
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
    // ── (L'ancien « raid mode automatique » a été remplacé par le système
    //    anti-raid complet : src/events/membres/antiraid.js + /antiraid) ──

    console.log(`✅ ${member.user.tag} a rejoint ${guild.name}`);
  },
};
