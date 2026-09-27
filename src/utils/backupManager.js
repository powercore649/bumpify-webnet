const { ChannelType, PermissionsBitField } = require('discord.js');
const ServerBackup = require('../models/ServerBackup');
const { nanoid } = require('nanoid');

// ── Générer un ID unique pour la backup ──────────────────────────────────────
function generateBackupId() {
  return nanoid(12).toUpperCase();
}

// ── Sérialiser les permission overwrites ─────────────────────────────────────
function serializeOverwrites(channel) {
  return channel.permissionOverwrites.cache.map(o => ({
    id:    o.id,
    type:  o.type,
    allow: o.allow.bitfield.toString(),
    deny:  o.deny.bitfield.toString(),
  }));
}

// ── Sérialiser un salon ───────────────────────────────────────────────────────
function serializeChannel(channel) {
  const base = {
    id:       channel.id,
    name:     channel.name,
    type:     channel.type,
    position: channel.rawPosition ?? channel.position,
    parentId: channel.parentId ?? null,
    permissionOverwrites: serializeOverwrites(channel),
  };

  if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
    base.topic           = channel.topic ?? null;
    base.nsfw            = channel.nsfw ?? false;
    base.rateLimitPerUser = channel.rateLimitPerUser ?? 0;
  }
  if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
    base.bitrate   = channel.bitrate ?? null;
    base.userLimit = channel.userLimit ?? null;
  }

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// CRÉER UNE BACKUP
// ─────────────────────────────────────────────────────────────────────────────
async function createBackup(guild, userId, backupName) {
  // Forcer le fetch complet du serveur
  await guild.fetch();
  await guild.roles.fetch();
  await guild.channels.fetch();
  await guild.emojis.fetch();

  // ── Rôles (triés par position croissante, on exclut @everyone) ────────────
  const roles = guild.roles.cache
    .filter(r => !r.managed && r.name !== '@everyone')
    .sort((a, b) => a.position - b.position)
    .map(r => ({
      id:          r.id,
      name:        r.name,
      color:       r.color,
      hoist:       r.hoist,
      position:    r.position,
      permissions: r.permissions.bitfield.toString(),
      mentionable: r.mentionable,
      managed:     r.managed,
    }));

  // ── Catégories d'abord, puis salons ──────────────────────────────────────
  const categories = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map(serializeChannel);

  const textChannels = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map(serializeChannel);

  const voiceChannels = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map(serializeChannel);

  const forumChannels = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildForum)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map(serializeChannel);

  const channels = [...categories, ...textChannels, ...voiceChannels, ...forumChannels];

  // ── Emojis ────────────────────────────────────────────────────────────────
  const emojis = guild.emojis.cache
    .filter(e => !e.managed)
    .map(e => ({
      id:       e.id,
      name:     e.name,
      animated: e.animated ?? false,
      url:      e.imageURL({ size: 128 }),
    }));

  // ── Sauvegarder en base ───────────────────────────────────────────────────
  const backupId = generateBackupId();

  const backup = await ServerBackup.create({
    guildId:   guild.id,
    createdBy: userId,
    name:      backupName,
    backupId,
    guildName: guild.name,
    guildIcon: guild.iconURL({ extension: 'png', size: 256 }) ?? null,
    description: guild.description ?? null,
    verificationLevel: guild.verificationLevel,
    explicitContentFilter: guild.explicitContentFilter,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    afkTimeout: guild.afkTimeout ?? 300,
    preferredLocale: guild.preferredLocale ?? 'en-US',
    roles,
    channels,
    emojis,
    size: { roles: roles.length, channels: channels.length, emojis: emojis.length },
  });

  return backup;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESTAURER UNE BACKUP
// ─────────────────────────────────────────────────────────────────────────────
async function restoreBackup(guild, backup, options = {}) {
  const log    = [];
  const errors = [];

  const {
    restoreRoles    = true,
    restoreChannels = true,
    clearExisting   = true,
  } = options;

  // Map: ancien ID → nouvel ID (pour reconstruire parentId et overwrites)
  const roleIdMap    = new Map(); // oldId → newId
  const channelIdMap = new Map(); // oldId → newId

  // ── 1. Supprimer l'existant si demandé ────────────────────────────────────
  if (clearExisting) {
    // Supprimer les salons (sauf le système actuel si possible)
    for (const [, ch] of guild.channels.cache) {
      try { await ch.delete('Restauration backup Bumpify'); } catch {}
    }
    log.push('🗑️ Salons existants supprimés');

    // Supprimer les rôles (sauf @everyone et gérés)
    for (const [, role] of guild.roles.cache) {
      if (role.managed || role.name === '@everyone' || role.id === guild.id) continue;
      try { await role.delete('Restauration backup Bumpify'); } catch {}
    }
    log.push('🗑️ Rôles existants supprimés');
  }

  // ── 2. Recréer les rôles ──────────────────────────────────────────────────
  if (restoreRoles) {
    // Trier par position pour respecter la hiérarchie
    const sortedRoles = [...backup.roles].sort((a, b) => a.position - b.position);

    for (const roleData of sortedRoles) {
      try {
        const newRole = await guild.roles.create({
          name:        roleData.name,
          color:       roleData.color,
          hoist:       roleData.hoist,
          mentionable: roleData.mentionable,
          permissions: BigInt(roleData.permissions),
          reason:      'Restauration backup Bumpify',
        });
        roleIdMap.set(roleData.id, newRole.id);
        log.push(`✅ Rôle créé: @${roleData.name}`);
      } catch (err) {
        errors.push(`❌ Rôle ${roleData.name}: ${err.message}`);
      }
    }

    // Repositionner les rôles
    try {
      const positionMap = [];
      for (const [oldId, newId] of roleIdMap) {
        const roleData = backup.roles.find(r => r.id === oldId);
        if (roleData) positionMap.push({ role: newId, position: roleData.position });
      }
      if (positionMap.length > 0) {
        await guild.roles.setPositions(positionMap).catch(() => {});
      }
      log.push('📐 Positions des rôles appliquées');
    } catch (err) {
      errors.push(`⚠️ Positions rôles: ${err.message}`);
    }
  }

  // ── 3. Helper: traduire les overwrites ────────────────────────────────────
  function translateOverwrites(overwrites) {
    return overwrites.map(o => {
      // Chercher si c'est un rôle qu'on vient de créer
      const translatedId = o.type === 0
        ? (roleIdMap.get(o.id) ?? o.id)
        : o.id; // members: garder l'ID original

      return {
        id:    translatedId,
        type:  o.type,
        allow: BigInt(o.allow),
        deny:  BigInt(o.deny),
      };
    });
  }

  // ── 4. Recréer les catégories d'abord ────────────────────────────────────
  if (restoreChannels) {
    const categories = backup.channels.filter(c => c.type === ChannelType.GuildCategory);
    const sorted     = [...categories].sort((a, b) => a.position - b.position);

    for (const catData of sorted) {
      try {
        const newCat = await guild.channels.create({
          name:     catData.name,
          type:     ChannelType.GuildCategory,
          position: catData.position,
          permissionOverwrites: translateOverwrites(catData.permissionOverwrites),
          reason:   'Restauration backup Bumpify',
        });
        channelIdMap.set(catData.id, newCat.id);
        log.push(`📁 Catégorie créée: ${catData.name}`);
      } catch (err) {
        errors.push(`❌ Catégorie ${catData.name}: ${err.message}`);
      }
    }

    // ── 5. Recréer les salons texte / voix / forum ────────────────────────
    const otherChannels = backup.channels
      .filter(c => c.type !== ChannelType.GuildCategory)
      .sort((a, b) => a.position - b.position);

    for (const chData of otherChannels) {
      try {
        const createOptions = {
          name:     chData.name,
          type:     chData.type,
          position: chData.position,
          permissionOverwrites: translateOverwrites(chData.permissionOverwrites),
          reason:   'Restauration backup Bumpify',
        };

        // Parent (catégorie traduite)
        if (chData.parentId) {
          const newParentId = channelIdMap.get(chData.parentId);
          if (newParentId) createOptions.parent = newParentId;
        }

        // Propriétés spécifiques
        if (chData.type === ChannelType.GuildText || chData.type === ChannelType.GuildAnnouncement) {
          if (chData.topic)            createOptions.topic            = chData.topic;
          if (chData.nsfw)             createOptions.nsfw             = chData.nsfw;
          if (chData.rateLimitPerUser) createOptions.rateLimitPerUser = chData.rateLimitPerUser;
        }
        if (chData.type === ChannelType.GuildVoice || chData.type === ChannelType.GuildStageVoice) {
          if (chData.bitrate)   createOptions.bitrate   = Math.min(chData.bitrate, guild.maximumBitrate ?? 96000);
          if (chData.userLimit) createOptions.userLimit = chData.userLimit;
        }

        const newCh = await guild.channels.create(createOptions);
        channelIdMap.set(chData.id, newCh.id);
        log.push(`💬 Salon créé: #${chData.name}`);
      } catch (err) {
        errors.push(`❌ Salon ${chData.name}: ${err.message}`);
      }
    }
  }

  // ── 6. Paramètres généraux du serveur ────────────────────────────────────
  try {
    await guild.edit({
      verificationLevel:           backup.verificationLevel,
      explicitContentFilter:       backup.explicitContentFilter,
      defaultMessageNotifications: backup.defaultMessageNotifications,
      preferredLocale:             backup.preferredLocale,
      reason:                      'Restauration backup Bumpify',
    });
    log.push('⚙️ Paramètres du serveur restaurés');
  } catch (err) {
    errors.push(`⚠️ Paramètres serveur: ${err.message}`);
  }

  return { log, errors, roleIdMap, channelIdMap };
}

module.exports = { createBackup, restoreBackup, generateBackupId };
