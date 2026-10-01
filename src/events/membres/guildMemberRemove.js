const { EmbedBuilder } = require('discord.js');
const { Farewell } = require('../../models/Welcome');
const InviteConfig = require('../../models/InviteConfig');
const InviteUse = require('../../models/InviteUse');
const { primeGuildCache } = require('../../utils/inviteCache');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member, client) {
    const guild = member.guild;

    // ── Anti-raid : nettoyage quarantaine/buffer si le membre part ────────
    try {
      const { memberLeftAction } = require('../../utils/antiraidActions');
      await memberLeftAction(guild.id, member.id);
    } catch (_) {}

    // ── Onboarding : nettoyer le salon/session si le membre part en cours ──
    try {
      const { cancelOnboarding } = require('../../utils/onboardingManager');
      await cancelOnboarding(guild, member.id);
    } catch (err) { console.error('guildMemberRemove onboarding:', err); }

    // ── Au revoir+ (message, image canvas, variables, stats) ────────────────
    try {
      const farewell = await Farewell.findOne({ guildId: guild.id, enabled: true });
      if (farewell) {
        const { sendFarewell, recordLeaveStats } = require('../../utils/welcomeManager');
        await sendFarewell(member, farewell);
        const Welcome = require('../../models/Welcome').Welcome;
        await recordLeaveStats(Welcome, guild);
      }
    } catch (err) { console.error('guildMemberRemove au revoir:', err.message); }

    // ── Système d'invitations avancé : marquer comme reparti + annonce ─────
    try {
      const invCfg = await InviteConfig.findOne({ guildId: guild.id });
      const enabled = invCfg?.enabled !== false;

      if (enabled) {
        // On resynchronise le cache pour que le prochain join compare contre un état à jour
        primeGuildCache(guild).catch(() => {});

        const record = await InviteUse.findOne({ guildId: guild.id, userId: member.id, left: false })
          .sort({ joinedAt: -1 });

        if (record) {
          record.left = true;
          record.leftAt = new Date();
          await record.save();

          if (invCfg?.announceChannelId && invCfg.announceLeave !== false) {
            const ch = await guild.channels.fetch(invCfg.announceChannelId).catch(() => null);
            if (ch?.isTextBased()) {
              const templateRaw = invCfg.leaveMessage || '{user} a quitté le serveur (invité à l\'origine par **{inviter}** via `{code}`).';
              const text = templateRaw
                .replaceAll('{user}', member.user?.tag || `<@${member.id}>`)
                .replaceAll('{server}', guild.name)
                .replaceAll('{inviter}', record.inviterId ? `<@${record.inviterId}>` : (record.inviterTag || 'Inconnu'))
                .replaceAll('{inviterTag}', record.inviterTag || 'Inconnu')
                .replaceAll('{code}', record.code || 'inconnu');

              await ch.send({
                embeds: [new EmbedBuilder()
                  .setColor(0xED4245)
                  .setDescription(text)
                  .setThumbnail(member.user?.displayAvatarURL?.() || null)
                  .setTimestamp()
                ],
              }).catch(() => {});
            }
          }
        }
      }
    } catch (err) { console.error('guildMemberRemove invites-avancé:', err); }

    // ── ModLog ──────────────────────────────────────────────────────────────
    try {
      const { sendModLog, ModlogConfig } = require('../../commands/moderation/modlog');
      const mlCfg = await ModlogConfig.findOne({ guildId: guild.id, enabled: true });
      if (mlCfg?.events?.memberLeave !== false) {
        await sendModLog(client, guild.id, new EmbedBuilder()
          .setColor(0xFF6B6B)
          .setTitle('🚪 Membre parti')
          .setDescription(`**${member.user.tag}** a quitté le serveur.`)
          .addFields(
            { name: '👤 ID', value: `\`${member.id}\``, inline: true },
            { name: '🎭 Rôles', value: member.roles.cache.filter(r => r.name !== '@everyone').map(r => `<@&${r.id}>`).join(', ') || '*Aucun*', inline: false },
          )
          .setThumbnail(member.user.displayAvatarURL())
          .setTimestamp()
        );
      }
    } catch (_) {}

    // ── Logs configurables : départ de membre (Feature 3) ─────────────────
    try {
      const GuildLogs = require('../../models/GuildLogs');
      const logsCfg = await GuildLogs.findOne({ guildId: guild.id });
      if (logsCfg?.membres?.enabled && logsCfg.membres.channelId) {
        const ch = await guild.channels.fetch(logsCfg.membres.channelId).catch(() => null);
        if (ch?.isTextBased()) {
          await ch.send({
            embeds: [new EmbedBuilder()
              .setColor(0xFF6B6B)
              .setTitle('📤 Départ d\'un membre')
              .addFields(
                { name: '👤 Utilisateur', value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
              )
              .setThumbnail(member.user.displayAvatarURL())
              .setTimestamp()
            ],
          }).catch(() => {});
        }
      }
    } catch (_) {}

    console.log(`👋 ${member.user.tag} a quitté ${guild.name}`);
  },
};
