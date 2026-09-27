'use strict';
// commands/ia.js — 🤖 Chat IA (Gemini) — panel de config avancé, chat direct, stats temps réel

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

const AiConfig     = require('../../models/AiConfig');
const AiDailyStats = require('../../models/AiDailyStats');
const gemini        = require('../../utils/geminiClient');
const { processMessage, resetConversation, todayKey } = require('../../utils/aiChat');
const { buildConfigPanelEmbed, buildStatsEmbed, buildChatReplyEmbed } = require('../../utils/aiEmbeds');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');

async function getOrCreateConfig(guildId) {
  let cfg = await AiConfig.findOne({ guildId });
  if (!cfg) cfg = await AiConfig.create({ guildId });
  return cfg;
}

async function getTodayStats(guildId) {
  return AiDailyStats.findOne({ guildId, date: todayKey() });
}

async function getRecentDays(guildId, days = 7) {
  const docs = await AiDailyStats.find({ guildId }).sort({ date: -1 }).limit(days);
  return docs.reverse();
}

// ════════════════════════════════════════════════════════════════════════════
//  COMPOSANTS DU PANEL DE CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════
function buildPanelComponents(cfg) {
  return [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('ai_add_channel')
        .setPlaceholder('➕ Ajouter un salon de chat IA...')
        .setChannelTypes(ChannelType.GuildText),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('ai_model')
        .setPlaceholder('🤖 Choisir le modèle Gemini...')
        .addOptions(gemini.AVAILABLE_MODELS.map((m) => ({ label: m.label.slice(0, 100), value: m.value, default: m.value === cfg.model }))),
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('ai_add_role')
        .setPlaceholder('🔐 Restreindre à un rôle (optionnel)...'),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ai_toggle').setLabel(cfg.enabled ? 'Désactiver' : 'Activer').setEmoji(cfg.enabled ? '⏸️' : '▶️').setStyle(cfg.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ai_edit_prompt').setLabel('Personnalité (prompt)').setEmoji('📝').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ai_edit_advanced').setLabel('Avancé').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ai_quota_mode_toggle').setLabel(cfg.quotaFallbackMode === 'switch_model' ? 'Quota: Auto-switch' : 'Quota: Verrouillage').setEmoji('🎯').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ai_clear_channels').setLabel('Vider les salons').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ai_stats').setLabel('Voir les stats').setEmoji('📊').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ai_refresh').setLabel('Actualiser').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('ai_playground')
        .setLabel(cfg.playgroundChannelId ? 'Supprimer le Playground' : 'Créer le salon Playground')
        .setEmoji(cfg.playgroundChannelId ? '🗑️' : '🛝')
        .setStyle(cfg.playgroundChannelId ? ButtonStyle.Danger : ButtonStyle.Success),
    ),
  ];
}

// ─── Crée le salon "AI Playground" avec permissions + slowmode adaptés ────
// Appelé UNIQUEMENT depuis le bouton du panel — jamais automatiquement.
async function createPlaygroundChannel(guild, botUser) {
  const everyoneId = guild.roles.everyone.id;
  const channel = await guild.channels.create({
    name: 'ai-playground',
    type: ChannelType.GuildText,
    topic: '🤖 Discutez librement avec l\'IA ici — géré par Bumpify. Slowmode actif pour éviter le spam et préserver le quota.',
    rateLimitPerUser: 5, // slowmode 5s — un appel Gemini par message, on évite le spam/l'épuisement du quota
    permissionOverwrites: [
      {
        id: everyoneId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AddReactions,
        ],
        deny: [
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MentionEveryone,
        ],
      },
      {
        id: botUser.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.AddReactions,
        ],
      },
    ],
  });
  return channel;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ia')
    .setDescription('🤖 Chat IA (Gemini) — parlez avec l\'IA ou configurez le système')
    .addSubcommand((s) => s
      .setName('chat')
      .setDescription('💬 Discuter avec l\'IA')
      .addStringOption((o) => o.setName('message').setDescription('Votre message').setRequired(true)))
    .addSubcommand((s) => s
      .setName('reset')
      .setDescription('🔄 Réinitialiser votre mémoire de conversation'))
    .addSubcommand((s) => s
      .setName('panel')
      .setDescription('⚙️ Panel de configuration avancé *(Admin)*'))
    .addSubcommand((s) => s
      .setName('stats')
      .setDescription('📊 Dashboard de statistiques en temps réel *(Admin)*')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── /ia chat ─────────────────────────────────────────────────────────
    if (sub === 'chat') {
      await interaction.deferReply();
      if (!gemini.isConfigured()) {
        return interaction.editReply({ embeds: [errorEmbed('Non configuré', 'Le système IA n\'est pas configuré (`GEMINI_API_KEY` manquant dans le `.env`).')] });
      }
      const message = interaction.options.getString('message');
      try {
        const result = await processMessage({ guild: interaction.guild, member: interaction.member, content: message });
        return interaction.editReply({ embeds: [buildChatReplyEmbed(message, result.text, result.model, result.responseMs)] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed('Erreur', err.message)] });
      }
    }

    // ── /ia reset ────────────────────────────────────────────────────────
    if (sub === 'reset') {
      await interaction.deferReply({ ephemeral: true });
      await resetConversation(interaction.guild.id, interaction.user.id);
      return interaction.editReply({ embeds: [successEmbed('Mémoire réinitialisée', 'L\'IA ne se souvient plus de votre conversation précédente.')] });
    }

    // ── /ia panel ────────────────────────────────────────────────────────
    if (sub === 'panel') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Réservé aux membres avec la permission *Gérer le serveur*.')], ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      let cfg = await getOrCreateConfig(interaction.guild.id);
      let today = await getTodayStats(interaction.guild.id);

      const reply = await interaction.editReply({
        embeds: [buildConfigPanelEmbed(interaction.guild, cfg, today)],
        components: buildPanelComponents(cfg),
      });

      const col = reply.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id,
        time: 15 * 60 * 1000,
      });

      col.on('collect', async (i) => {
        try {
          const id = i.customId;

          if (id === 'ai_refresh') {
            cfg = await getOrCreateConfig(interaction.guild.id);
            today = await getTodayStats(interaction.guild.id);
            return i.update({ embeds: [buildConfigPanelEmbed(interaction.guild, cfg, today)], components: buildPanelComponents(cfg) });
          }

          if (id === 'ai_toggle') {
            if (!cfg.enabled && !gemini.isConfigured()) {
              return i.reply({ embeds: [errorEmbed('Impossible', '`GEMINI_API_KEY` manquant dans le `.env` — le système ne peut pas être activé.')], ephemeral: true });
            }
            cfg.enabled = !cfg.enabled;
            await cfg.save();
            return i.update({ embeds: [buildConfigPanelEmbed(interaction.guild, cfg, today)], components: buildPanelComponents(cfg) });
          }

          if (id === 'ai_add_channel') {
            const channelId = i.values[0];
            if (!cfg.channelIds.includes(channelId)) cfg.channelIds.push(channelId);
            await cfg.save();
            return i.update({ embeds: [buildConfigPanelEmbed(interaction.guild, cfg, today)], components: buildPanelComponents(cfg) });
          }

          if (id === 'ai_clear_channels') {
            cfg.channelIds = [];
            await cfg.save();
            return i.update({ embeds: [buildConfigPanelEmbed(interaction.guild, cfg, today)], components: buildPanelComponents(cfg) });
          }

          if (id === 'ai_quota_mode_toggle') {
            cfg.quotaFallbackMode = cfg.quotaFallbackMode === 'switch_model' ? 'lock_channel' : 'switch_model';
            await cfg.save();
            return i.update({ embeds: [buildConfigPanelEmbed(interaction.guild, cfg, today)], components: buildPanelComponents(cfg) });
          }

          // ── Bouton Playground : crée OU supprime, jamais automatique ────
          if (id === 'ai_playground') {
            const botMember = interaction.guild.members.me;
            if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
              return i.reply({ embeds: [errorEmbed('Permission manquante', 'Le bot a besoin de la permission **Gérer les salons** pour créer/supprimer le Playground.')], ephemeral: true });
            }

            // Suppression si un salon Playground existe déjà
            if (cfg.playgroundChannelId) {
              const existing = interaction.guild.channels.cache.get(cfg.playgroundChannelId);
              await existing?.delete('Salon AI Playground retiré via /ia panel').catch(() => {});
              cfg.channelIds = cfg.channelIds.filter((cid) => cid !== cfg.playgroundChannelId);
              cfg.playgroundChannelId = null;
              await cfg.save();
              await i.update({ embeds: [buildConfigPanelEmbed(interaction.guild, cfg, today)], components: buildPanelComponents(cfg) });
              return i.followUp({ embeds: [successEmbed('Salon supprimé', 'Le salon AI Playground a été supprimé.')], ephemeral: true }).catch(() => {});
            }

            // Création
            await i.deferUpdate();
            try {
              const channel = await createPlaygroundChannel(interaction.guild, interaction.client.user);
              cfg.playgroundChannelId = channel.id;
              if (!cfg.channelIds.includes(channel.id)) cfg.channelIds.push(channel.id);
              cfg.enabled = true; // le but d'un playground est de pouvoir discuter immédiatement
              await cfg.save();
              await interaction.editReply({ embeds: [buildConfigPanelEmbed(interaction.guild, cfg, today)], components: buildPanelComponents(cfg) });
              return i.followUp({ embeds: [successEmbed('Salon créé !', `<#${channel.id}> a été créé avec les permissions nécessaires et un slowmode de 5s. Le chat IA y est déjà actif.`)], ephemeral: true }).catch(() => {});
            } catch (err) {
              console.error('[IA Panel] création playground:', err);
              return i.followUp({ embeds: [errorEmbed('Erreur', `Impossible de créer le salon : ${err.message}`)], ephemeral: true }).catch(() => {});
            }
          }

          if (id === 'ai_model') {
            cfg.model = i.values[0];
            await cfg.save();
            return i.update({ embeds: [buildConfigPanelEmbed(interaction.guild, cfg, today)], components: buildPanelComponents(cfg) });
          }

          if (id === 'ai_add_role') {
            const roleId = i.values[0];
            if (!cfg.allowedRoleIds.includes(roleId)) cfg.allowedRoleIds.push(roleId);
            await cfg.save();
            return i.update({ embeds: [buildConfigPanelEmbed(interaction.guild, cfg, today)], components: buildPanelComponents(cfg) });
          }

          if (id === 'ai_edit_prompt') {
            const modal = new ModalBuilder().setCustomId('ai_modal_prompt').setTitle('📝 Personnalité de l\'IA');
            modal.addComponents(new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('ai_prompt_value')
                .setLabel('Prompt système (comportement de l\'IA)')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(1000)
                .setValue(cfg.systemPrompt || ''),
            ));
            await i.showModal(modal);

            const modalSubmit = await i.awaitModalSubmit({
              filter: (m) => m.customId === 'ai_modal_prompt' && m.user.id === interaction.user.id,
              time: 180_000,
            }).catch(() => null);
            if (!modalSubmit) return;

            cfg.systemPrompt = modalSubmit.fields.getTextInputValue('ai_prompt_value').trim();
            await cfg.save();
            return modalSubmit.update({ embeds: [buildConfigPanelEmbed(interaction.guild, cfg, today)], components: buildPanelComponents(cfg) });
          }

          if (id === 'ai_edit_advanced') {
            const modal = new ModalBuilder().setCustomId('ai_modal_advanced').setTitle('⚙️ Réglages avancés');
            modal.addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('ai_temp').setLabel('Température (0.0 à 2.0)').setStyle(TextInputStyle.Short).setRequired(false).setValue(String(cfg.temperature)),
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('ai_history').setLabel('Échanges en mémoire (1 à 30)').setStyle(TextInputStyle.Short).setRequired(false).setValue(String(cfg.maxHistoryPairs)),
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('ai_limit').setLabel('Limite quotidienne / membre (0 = illimité)').setStyle(TextInputStyle.Short).setRequired(false).setValue(String(cfg.dailyLimitPerUser)),
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('ai_lock_duration').setLabel('Durée du verrou si quota atteint (minutes)').setStyle(TextInputStyle.Short).setRequired(false).setValue(String(cfg.lockDurationMinutes)),
              ),
            );
            await i.showModal(modal);

            const modalSubmit = await i.awaitModalSubmit({
              filter: (m) => m.customId === 'ai_modal_advanced' && m.user.id === interaction.user.id,
              time: 180_000,
            }).catch(() => null);
            if (!modalSubmit) return;

            const temp  = parseFloat(modalSubmit.fields.getTextInputValue('ai_temp'));
            const hist  = parseInt(modalSubmit.fields.getTextInputValue('ai_history'), 10);
            const limit = parseInt(modalSubmit.fields.getTextInputValue('ai_limit'), 10);
            const lockMin = parseInt(modalSubmit.fields.getTextInputValue('ai_lock_duration'), 10);

            if (Number.isFinite(temp) && temp >= 0 && temp <= 2) cfg.temperature = temp;
            if (Number.isFinite(hist) && hist >= 1 && hist <= 30) cfg.maxHistoryPairs = hist;
            if (Number.isFinite(limit) && limit >= 0) cfg.dailyLimitPerUser = limit;
            if (Number.isFinite(lockMin) && lockMin >= 1) cfg.lockDurationMinutes = lockMin;
            await cfg.save();

            return modalSubmit.update({ embeds: [buildConfigPanelEmbed(interaction.guild, cfg, today)], components: buildPanelComponents(cfg) });
          }

          if (id === 'ai_stats') {
            await i.deferUpdate();
            return openStatsDashboard(interaction, i, true);
          }
        } catch (err) {
          console.error('[IA Panel]', err);
          const payload = { embeds: [errorEmbed('Erreur', 'Une erreur est survenue. Réessayez.')], ephemeral: true };
          if (i.deferred || i.replied) await i.followUp(payload).catch(() => {});
          else await i.reply(payload).catch(() => {});
        }
      });

      col.on('end', () => { interaction.editReply({ components: [] }).catch(() => {}); });
      return;
    }

    // ── /ia stats ────────────────────────────────────────────────────────
    if (sub === 'stats') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Réservé aux membres avec la permission *Gérer le serveur*.')], ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      return openStatsDashboard(interaction, null, false);
    }
  },
};

// ─── Dashboard de stats auto-actualisé toutes les 10 secondes ────────────
async function openStatsDashboard(interaction, sourceInteraction, viaButton) {
  const guildId = interaction.guild.id;
  let cfg   = await getOrCreateConfig(guildId);
  let today = await getTodayStats(guildId);
  let recent = await getRecentDays(guildId);

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ai_stats_close').setLabel('Fermer le dashboard').setEmoji('✖️').setStyle(ButtonStyle.Danger),
  );

  const editFn = viaButton
    ? (payload) => interaction.editReply(payload)
    : (payload) => interaction.editReply(payload);

  await editFn({ embeds: [buildStatsEmbed(interaction.guild, cfg, today, recent)], components: [closeRow] });

  let stopped = false;
  const interval = setInterval(async () => {
    if (stopped) return;
    try {
      cfg    = await getOrCreateConfig(guildId);
      today  = await getTodayStats(guildId);
      recent = await getRecentDays(guildId);
      await editFn({ embeds: [buildStatsEmbed(interaction.guild, cfg, today, recent)], components: [closeRow] });
    } catch (_) {
      stopped = true;
      clearInterval(interval);
    }
  }, 10_000);

  // Le dashboard s'auto-actualise 10 minutes max, puis s'arrête proprement.
  const stopTimeout = setTimeout(() => { stopped = true; clearInterval(interval); }, 10 * 60 * 1000);

  const msg = await interaction.fetchReply();
  const col = msg.createMessageComponentCollector({
    filter: (i) => i.customId === 'ai_stats_close' && i.user.id === interaction.user.id,
    time: 10 * 60 * 1000,
  });
  col.on('collect', async (i) => {
    stopped = true;
    clearInterval(interval);
    clearTimeout(stopTimeout);
    await i.update({ components: [] });
  });
}
