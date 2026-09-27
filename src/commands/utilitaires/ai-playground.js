'use strict';
// commands/ai-playground.js — Panel de gestion du salon "AI Playground"
// Le salon n'est JAMAIS créé automatiquement : uniquement via le bouton de ce panel.

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType,
} = require('discord.js');

const AiPlaygroundConfig = require('../../models/AiPlaygroundConfig');
const { getStatusMap } = require('../../utils/aiService');
const { pickAvailableModel, parseModelChainInput } = require('../../utils/aiQuotaEngine');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');

const COLLECTOR_TIMEOUT_MS = 10 * 60 * 1000;
const CHANNEL_NAME = 'ai-playground';

async function getOrCreateConfig(guildId) {
  let cfg = await AiPlaygroundConfig.findOne({ guildId });
  if (!cfg) cfg = await AiPlaygroundConfig.create({ guildId });
  return cfg;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Vue "pas encore de salon"
// ═══════════════════════════════════════════════════════════════════════════
function renderNoChannelView() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🤖 AI Playground')
    .setDescription(
      'Aucun salon AI Playground n\'est configuré sur ce serveur.\n\n' +
      'Cliquez sur le bouton ci-dessous pour le créer. **Rien n\'est créé automatiquement** — ' +
      'le salon n\'apparaît que si vous cliquez.\n\n' +
      '📌 Le salon sera créé avec :\n' +
      '• Les permissions nécessaires (lecture/écriture pour les membres, gestion pour le bot)\n' +
      '• Un slowmode par défaut de 5 secondes (modifiable après création)\n' +
      '• Bascule automatique de modèle IA en cas de quota dépassé, avec verrouillage du salon si tous les modèles sont indisponibles'
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('aiplay_create').setLabel('➕ Créer le salon AI Playground').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Vue dashboard (salon existant)
// ═══════════════════════════════════════════════════════════════════════════
async function renderDashboard(cfg, guild) {
  const statusMap = await getStatusMap(cfg.modelChain);
  const pick = pickAvailableModel(cfg.modelChain, statusMap, new Date());

  const modelLines = cfg.modelChain.map((m) => {
    const s = statusMap[m];
    const cooling = s?.unavailableUntil && new Date(s.unavailableUntil) > new Date();
    if (cooling) return `🔴 \`${m}\` — indisponible jusqu'à <t:${Math.floor(new Date(s.unavailableUntil).getTime() / 1000)}:R>`;
    return `🟢 \`${m}\` — disponible`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setColor(cfg.locked ? COLORS.error : COLORS.success)
    .setTitle('🤖 AI Playground — Tableau de bord')
    .setDescription(
      `📝 Salon : <#${cfg.channelId}>\n` +
      `🚦 Statut : ${cfg.locked ? '🔒 **Verrouillé** (tous les modèles en quota dépassé)' : '🟢 **Ouvert**'}\n` +
      (cfg.locked && cfg.lockedReason ? `📋 Raison : ${cfg.lockedReason}\n` : '') +
      `🐌 Slowmode : ${cfg.slowmodeSeconds}s\n` +
      `🎯 Modèle actif si un message arrive maintenant : ${pick.model ? `\`${pick.model}\`` : '*aucun (tous indisponibles)*'}`
    )
    .addFields({ name: '📊 État des modèles (chaîne de bascule)', value: modelLines })
    .setFooter({ text: 'Bumpify • AI Playground' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('aiplay_slowmode').setLabel('🐌 Modifier le slowmode').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('aiplay_models').setLabel('🎯 Modifier les modèles').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('aiplay_refresh').setLabel('🔄 Actualiser').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    cfg.locked
      ? new ButtonBuilder().setCustomId('aiplay_unlock').setLabel('🔓 Déverrouiller manuellement').setStyle(ButtonStyle.Success)
      : new ButtonBuilder().setCustomId('aiplay_lock').setLabel('🔒 Verrouiller manuellement').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('aiplay_delete').setLabel('🗑️ Supprimer le salon').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2] };
}

async function createPlaygroundChannel(interaction, cfg) {
  const guild = interaction.guild;
  const me = guild.members.me;

  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return { error: 'Le bot a besoin de la permission **Gérer les salons** pour créer le salon automatiquement.' };
  }

  let channel;
  try {
    channel = await guild.channels.create({
      name: CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: '🤖 Discutez librement avec l\'IA du bot — salon généré par Bumpify',
      rateLimitPerUser: cfg.slowmodeSeconds,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks],
          deny: [PermissionFlagsBits.ManageMessages],
        },
        {
          id: me.id,
          allow: [
            PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });
  } catch (err) {
    return { error: `Discord a refusé la création du salon : ${err.message}` };
  }

  cfg.channelId = channel.id;
  await cfg.save();

  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle('🤖 Bienvenue dans l\'AI Playground !')
      .setDescription('Écrivez simplement un message ici pour discuter avec l\'IA. Le modèle bascule automatiquement en cas de forte demande.')
      .setFooter({ text: `Slowmode : ${cfg.slowmodeSeconds}s` })],
  }).catch(() => {});

  return { channel };
}

// ═══════════════════════════════════════════════════════════════════════════
module.exports = {
  data: new SlashCommandBuilder()
    .setName('ai-playground')
    .setDescription('🤖 Gérer le salon AI Playground')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('panel').setDescription('Ouvrir le panel de gestion')),

  async execute(interaction) {
    const guild = interaction.guild;
    let cfg = await getOrCreateConfig(guild.id);

    // Vérifie que le salon existe toujours réellement (pas supprimé manuellement entre-temps)
    if (cfg.channelId && !guild.channels.cache.has(cfg.channelId)) {
      cfg.channelId = null;
      await cfg.save();
    }

    const payload = cfg.channelId ? await renderDashboard(cfg, guild) : renderNoChannelView();
    const reply = await interaction.reply({ ...payload, ephemeral: true, fetchReply: true });
    const collector = reply.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: COLLECTOR_TIMEOUT_MS });

    collector.on('collect', async (i) => {
      const id = i.customId;
      cfg = await getOrCreateConfig(guild.id);

      if (id === 'aiplay_create') {
        const result = await createPlaygroundChannel(interaction, cfg);
        if (result.error) return i.reply({ embeds: [errorEmbed('Échec de la création', result.error)], ephemeral: true });
        cfg = await getOrCreateConfig(guild.id);
        return i.update(await renderDashboard(cfg, guild));
      }

      if (id === 'aiplay_refresh') {
        if (cfg.channelId && !guild.channels.cache.has(cfg.channelId)) { cfg.channelId = null; await cfg.save(); }
        return i.update(cfg.channelId ? await renderDashboard(cfg, guild) : renderNoChannelView());
      }

      if (!cfg.channelId) return i.update(renderNoChannelView());

      if (id === 'aiplay_slowmode') {
        const modal = new ModalBuilder().setCustomId('aiplay_modal_slowmode').setTitle('🐌 Slowmode du salon');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('seconds').setLabel('Secondes entre chaque message (0-21600)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(cfg.slowmodeSeconds)),
        ));
        return i.showModal(modal);
      }

      if (id === 'aiplay_models') {
        const modal = new ModalBuilder().setCustomId('aiplay_modal_models').setTitle('🎯 Chaîne de modèles IA');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('chain').setLabel('Modèles séparés par des virgules, par ordre').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(cfg.modelChain.join(', ')),
        ));
        return i.showModal(modal);
      }

      if (id === 'aiplay_lock' || id === 'aiplay_unlock') {
        cfg.locked = id === 'aiplay_lock';
        cfg.lockedReason = cfg.locked ? 'Verrouillé manuellement par un modérateur' : null;
        cfg.lockedAt = cfg.locked ? new Date() : null;
        await cfg.save();
        await applyChannelLockState(guild, cfg);
        return i.update(await renderDashboard(cfg, guild));
      }

      if (id === 'aiplay_delete') {
        const embed = errorEmbed('⚠️ Confirmer la suppression', 'Voulez-vous vraiment supprimer le salon AI Playground ? Cette action est irréversible.');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('aiplay_delete_confirm').setLabel('💥 Supprimer définitivement').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('aiplay_refresh').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
        );
        return i.update({ embeds: [embed], components: [row] });
      }

      if (id === 'aiplay_delete_confirm') {
        const channel = guild.channels.cache.get(cfg.channelId);
        if (channel) await channel.delete('Suppression demandée via /ai-playground panel').catch(() => {});
        cfg.channelId = null;
        cfg.locked = false;
        await cfg.save();
        return i.update(renderNoChannelView());
      }
    });

    collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
  },

  async handleModal(interaction) {
    const id = interaction.customId;
    const guild = interaction.guild;
    const cfg = await getOrCreateConfig(guild.id);

    if (id === 'aiplay_modal_slowmode') {
      const seconds = parseInt(interaction.fields.getTextInputValue('seconds'));
      if (isNaN(seconds) || seconds < 0 || seconds > 21600) {
        return interaction.reply({ embeds: [errorEmbed('Valeur invalide', 'Le slowmode doit être entre 0 et 21600 secondes (6h, maximum Discord).')], ephemeral: true });
      }
      cfg.slowmodeSeconds = seconds;
      await cfg.save();

      if (cfg.channelId) {
        const channel = guild.channels.cache.get(cfg.channelId);
        await channel?.setRateLimitPerUser(seconds).catch(() => {});
      }

      return interaction.update(await renderDashboard(cfg, guild)).catch(() => interaction.reply({ embeds: [successEmbed('Slowmode mis à jour')], ephemeral: true }));
    }

    if (id === 'aiplay_modal_models') {
      const chain = parseModelChainInput(interaction.fields.getTextInputValue('chain'));
      if (!chain.length) {
        return interaction.reply({ embeds: [errorEmbed('Chaîne invalide', 'Indiquez au moins un nom de modèle.')], ephemeral: true });
      }
      cfg.modelChain = chain;
      await cfg.save();
      return interaction.update(await renderDashboard(cfg, guild)).catch(() => interaction.reply({ embeds: [successEmbed('Modèles mis à jour')], ephemeral: true }));
    }
  },
};

/**
 * Applique (ou retire) le verrou Discord réel sur le salon : bloque @everyone en écriture.
 * Exportée pour être réutilisée par events/messageCreate.js lors d'un verrouillage automatique.
 */
async function applyChannelLockState(guild, cfg) {
  if (!cfg.channelId) return;
  const channel = guild.channels.cache.get(cfg.channelId);
  if (!channel) return;
  try {
    await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
      SendMessages: cfg.locked ? false : null,
    });
  } catch (err) {
    console.error('❌ [ai-playground] Impossible de modifier les permissions du salon:', err.message);
  }
}
module.exports.applyChannelLockState = applyChannelLockState;
module.exports.getOrCreateConfig = getOrCreateConfig;
