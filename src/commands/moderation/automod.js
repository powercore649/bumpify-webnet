// commands/moderation/automod.js — Anti-spam / anti-liens / anti-majuscules.
// Le handler handleMessage() est appelé par l'event messageCreate ; la config
// vient du modèle AutoMod, éditée via /securite et /raidautoconfig.
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const AutoMod = require('../../models/AutoMod');
const { sendModLog } = require('./modlog');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

// ── Cache de spam en mémoire : clé `${guildId}:${userId}` → timestamps ───────
const spamCache = new Map();

// Périodiquement, on purge les clés devenues inutiles (fuites mémoire)
setInterval(() => {
  const now = Date.now();
  for (const [key, stamps] of spamCache) {
    // 60 s sans message → la clé ne sert plus (fenêtres max ~10 s)
    if (now - stamps[stamps.length - 1] > 60_000) spamCache.delete(key);
  }
}, 5 * 60_000).unref?.();

// ── Petites aides ─────────────────────────────────────────────────────────────
function isExempt(message, cfg) {
  if (!message.member) return true;
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  if (cfg.exemptRoles?.some(r => message.member.roles.cache.has(r))) return true;
  if (cfg.exemptChannels?.includes(message.channel.id)) return true;
  return false;
}

async function applyAction(message, action, muteDurationMin) {
  const member = message.member;
  if (!member) return;
  const me = message.guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
  if (member.roles.highest.position >= me.roles.highest.position) return;

  try {
    if (action === 'delete' || action === 'warn') {
      await message.delete().catch(() => {});
    }
    if (action === 'mute' || action === 'warn') {
      const ms = Math.max(1, Math.min(muteDurationMin || 10, 40320)) * 60_000;
      await member.timeout(ms, 'AutoMod — infraction');
    }
  } catch (_) { /* best effort */ }
}

async function logInfraction(client, guildId, title, fields) {
  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle(`🛡️ AutoMod — ${title}`)
    .addFields(fields)
    .setTimestamp();
  await sendModLog(client, guildId, embed);
}

// ── Anti-spam : N messages en X ms → action ───────────────────────────────────
async function handleSpam(message, cfg) {
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const stamps = (spamCache.get(key) || []).filter(t => now - t < cfg.spamWindow);
  stamps.push(now);
  spamCache.set(key, stamps);

  if (stamps.length >= cfg.spamThreshold) {
    spamCache.set(key, []); // reset pour ne pas re-déclencher à chaque message
    await applyAction(message, cfg.spamAction, cfg.spamMuteDuration);
    await logInfraction(message.client, message.guild.id, 'Spam détecté', [
      { name: '👤 Membre', value: `<@${message.author.id}> (\`${message.author.id}\`)`, inline: true },
      { name: '💬 Salon', value: `<#${message.channelId}>`, inline: true },
      { name: '⚡ Action', value: cfg.spamAction, inline: true },
    ]);
    return true;
  }
  return false;
}

// ── Anti-liens : supprime les URL hors whitelist ─────────────────────────────
function containsForbiddenLink(message, cfg) {
  const urlRegex = /(https?:\/\/|www\.)[^\s<]+/gi;
  const found = message.content.match(urlRegex);
  if (!found) return false;
  const whitelist = (cfg.linksWhitelist || []).map(d => d.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  return found.some(url => {
    try {
      const host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase();
      return !whitelist.some(d => host === d || host.endsWith(`.${d}`));
    } catch {
      return true; // URL malformée → considérée interdite
    }
  });
}

async function handleLinks(message, cfg) {
  if (!containsForbiddenLink(message, cfg)) return false;
  await applyAction(message, cfg.linksAction === 'mute' ? 'mute' : 'delete', 10);
  await logInfraction(message.client, message.guild.id, 'Lien non autorisé', [
    { name: '👤 Membre', value: `<@${message.author.id}> (\`${message.author.id}\`)`, inline: true },
    { name: '💬 Salon', value: `<#${message.channelId}>`, inline: true },
    { name: '🔗 Message', value: (message.content || '').slice(0, 1024) || '*pièce jointe*', inline: false },
  ]);
  return true;
}

// ── Anti-majuscules : % de caps sur un message assez long ────────────────────
async function handleCaps(message, cfg) {
  const content = (message.content || '').replace(/\s/g, '');
  if (content.length < (cfg.capsMinLength || 10)) return false;
  const letters = content.replace(/[0-9\p{P}\p{S}]/gu, '');
  if (!letters.length) return false;
  const capsRatio = (letters.match(/[A-ZÀ-ÖØ-Þ]/gu) || []).length / letters.length;
  if (capsRatio * 100 < (cfg.capsThreshold || 70)) return false;

  await message.delete().catch(() => {});
  await logInfraction(message.client, message.guild.id, 'Trop de majuscules', [
    { name: '👤 Membre', value: `<@${message.author.id}> (\`${message.author.id}\`)`, inline: true },
    { name: '💬 Salon', value: `<#${message.channelId}>`, inline: true },
    { name: '📈 Ratio', value: `${Math.round(capsRatio * 100)}%`, inline: true },
  ]);
  return true;
}

// ── Point d'entrée appelé par messageCreate ───────────────────────────────────
async function handleMessage(message) {
  if (!message.guild || message.author?.bot) return false;

  const cfg = await AutoMod.findOne({ guildId: message.guild.id }).lean();
  if (!cfg) return false;
  if (isExempt(message, cfg)) return false;
  if (message.channel.type === ChannelType.GuildForum) return false;

  if (cfg.spamEnabled  && await handleSpam(message, cfg))  return true;
  if (cfg.linksEnabled && await handleLinks(message, cfg)) return true;
  if (cfg.capsEnabled  && await handleCaps(message, cfg))  return true;
  return false;
}

// ── Commande /automod (panel minimal — /securite reste le panneau principal) ──
module.exports = {
  handleMessage,

  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('🛡️ Auto-modération : anti-spam, anti-liens, anti-majuscules')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('voir').setDescription('Voir la configuration AutoMod actuelle'))
    .addSubcommand(s => s
      .setName('exempter')
      .setDescription('Exempter (ou réintégrer) un rôle ou un salon de la modération auto')
      .addRoleOption(o => o.setName('role').setDescription('Rôle à exempter'))
      .addChannelOption(o => o.setName('salon').setDescription('Salon à exempter').addChannelTypes(ChannelType.GuildText))),

  async execute(interaction) {
    let cfg = await AutoMod.findOne({ guildId: interaction.guildId });
    if (!cfg) cfg = await AutoMod.create({ guildId: interaction.guildId });

    if (interaction.options.getSubcommand() === 'voir') {
      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🛡️ AutoMod — configuration')
        .addFields(
          { name: '🌀 Anti-spam', value: cfg.spamEnabled ? `🟢 ${cfg.spamThreshold} msgs / ${cfg.spamWindow / 1000}s → ${cfg.spamAction}` : '🔴 Désactivé', inline: false },
          { name: '🔗 Anti-liens', value: cfg.linksEnabled ? `🟢 Activé — whitelist : ${cfg.linksWhitelist.length ? cfg.linksWhitelist.map(d => `\`${d}\``).join(', ') : '*aucune*'}` : '🔴 Désactivé', inline: false },
          { name: '🔠 Anti-majuscules', value: cfg.capsEnabled ? `🟢 Activé — ${cfg.capsThreshold}% min. sur ${cfg.capsMinLength} caractères` : '🔴 Désactivé', inline: false },
          { name: '🚫 Exemptions', value: `${cfg.exemptRoles.length} rôle(s), ${cfg.exemptChannels.length} salon(s)`, inline: false },
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // exempter (bascule : ajoute si absent, retire si présent)
    const roleOpt    = interaction.options.getRole('role');
    const channelOpt = interaction.options.getChannel('salon');

    if (!roleOpt && !channelOpt) {
      return interaction.reply({ embeds: [errorEmbed('Cible manquante', 'Précise un `role` ou un `salon` à exempter.')], ephemeral: true });
    }

    const isRole = Boolean(roleOpt);
    const cible  = roleOpt || channelOpt;
    const list   = isRole ? cfg.exemptRoles : cfg.exemptChannels;
    const idx    = list.indexOf(cible.id);

    if (idx === -1) {
      list.push(cible.id);
      await cfg.save();
      return interaction.reply({ embeds: [successEmbed('Exemption ajoutée', `**${cible}** est maintenant exempté de l'AutoMod.`)], ephemeral: true });
    }

    list.splice(idx, 1);
    await cfg.save();
    return interaction.reply({ embeds: [successEmbed('Exemption retirée', `**${cible}** n'est plus exempté de l'AutoMod.`)], ephemeral: true });
  },
};
