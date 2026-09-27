'use strict';
// commands/suggestion.js — Système de suggestions avancé
// - Panel de configuration complet (/suggestion panel)
// - Statistiques en temps réel avec mode direct (/suggestion stats)
// - Logs configurables (relayés dans un salon si activé dans le panel)
// - Transcript web avancé (bouton "📄 Transcript" → page HTML)
// - Anti-abus (cooldown, rôle requis), catégories, votes modifiables,
//   auto-approbation/refus par seuil de votes, suggestions anonymes,
//   fil de discussion automatique, notification DM, épinglage.

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

const { Suggestion, SuggestionConfig, CATEGORY_KEYS } = require('../../models/Suggestion');
const { logAction, getHistory, formatLogLine } = require('../../utils/suggestionLogger');
const { computeStats, renderBarChart } = require('../../utils/suggestionStats');
const { checkCooldown, checkRequiredRole, applyVote, checkAutoResolve } = require('../../utils/suggestionEngine');
const { COLORS, successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { transcriptUrl } = require('../../web/server');

const CATEGORY_LABELS = {
  general: '💬 Général',
  bot:     '🤖 Bot',
  serveur: '🖥️ Serveur',
  design:  '🎨 Design',
  regles:  '📜 Règlement',
};

const STATUS_COLORS = { pending: COLORS.warning, approved: COLORS.success, denied: COLORS.error };
const STATUS_LABELS = { pending: '⏳ En attente', approved: '✅ Approuvée', denied: '❌ Refusée' };

const COLLECTOR_TIMEOUT_MS = 10 * 60 * 1000;
const LIVE_STATS_DURATION_MS = 90 * 1000;
const LIVE_STATS_INTERVAL_MS = 5 * 1000;

function isMod(interaction) {
  return interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
}

async function getOrCreateConfig(guildId) {
  let config = await SuggestionConfig.findOne({ guildId });
  if (!config) config = await SuggestionConfig.create({ guildId });
  return config;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Embed / composants — carte de suggestion publique
// ═══════════════════════════════════════════════════════════════════════════
function buildSuggestionEmbed(suggestion, author, config) {
  const total = suggestion.upvotes + suggestion.downvotes;
  const pct   = total > 0 ? Math.round((suggestion.upvotes / total) * 100) : 0;
  const bar   = total > 0 ? '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10)) : '░░░░░░░░░░';

  const embed = new EmbedBuilder()
    .setColor(STATUS_COLORS[suggestion.status])
    .setTitle(`${suggestion.pinned ? '📌 ' : ''}💡 Suggestion #${suggestion.number}`)
    .setDescription(suggestion.content)
    .addFields(
      { name: '📊 Votes',  value: `👍 ${suggestion.upvotes}  👎 ${suggestion.downvotes}\n\`${bar}\` ${pct}%`, inline: true },
      { name: '📌 Statut', value: STATUS_LABELS[suggestion.status], inline: true },
      { name: '🏷️ Catégorie', value: CATEGORY_LABELS[suggestion.category] || suggestion.category, inline: true },
    )
    .setTimestamp(suggestion.createdAt);

  if (suggestion.anonymous) {
    embed.setFooter({ text: 'Proposée anonymement 🕵️' });
  } else {
    embed.setFooter({ text: `Proposé par ${author?.username ?? 'Inconnu'}`, iconURL: author?.displayAvatarURL() });
  }

  if (suggestion.reason) {
    embed.addFields({ name: suggestion.autoResolved ? '🤖 Résolution automatique' : '📝 Raison', value: suggestion.reason, inline: false });
  }

  return embed;
}

function buildVoteRow(suggestion, config) {
  const disabled = suggestion.status !== 'pending';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sug_up_${suggestion._id}`).setLabel(`👍 ${suggestion.upvotes || 0}`).setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`sug_down_${suggestion._id}`).setLabel(`👎 ${suggestion.downvotes || 0}`).setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
  if (config?.transcriptEnabled !== false) {
    row.addComponents(
      new ButtonBuilder().setLabel('📄 Transcript').setStyle(ButtonStyle.Link).setURL(transcriptUrl(suggestion._id)),
    );
  }
  return row;
}

async function refreshSuggestionMessage(client, suggestion, config) {
  try {
    const channel = await client.channels.fetch(suggestion.channelId).catch(() => null);
    if (!channel || !suggestion.messageId) return;
    const msg = await channel.messages.fetch(suggestion.messageId).catch(() => null);
    if (!msg) return;
    const author = suggestion.anonymous ? null : await client.users.fetch(suggestion.authorId).catch(() => null);
    await msg.edit({ embeds: [buildSuggestionEmbed(suggestion, author, config)], components: [buildVoteRow(suggestion, config)] });
  } catch (_) {}
}

async function notifyAuthor(client, suggestion, config, statusLabel) {
  if (!config?.dmNotify) return;
  try {
    const user = await client.users.fetch(suggestion.authorId).catch(() => null);
    if (!user) return;
    await user.send({
      embeds: [new EmbedBuilder()
        .setColor(STATUS_COLORS[suggestion.status])
        .setTitle(`${statusLabel} — Suggestion #${suggestion.number}`)
        .setDescription(suggestion.content.slice(0, 200))
        .addFields(...(suggestion.reason ? [{ name: 'Raison', value: suggestion.reason }] : []))
        .setTimestamp()],
    }).catch(() => {});
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════════════════
//  PANEL DE CONFIGURATION AVANCÉ
// ═══════════════════════════════════════════════════════════════════════════
function renderOverview(config) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('💡 Panel — Système de Suggestions')
    .setDescription('Configurez chaque aspect du système depuis ce panel.')
    .addFields(
      { name: '📢 Statut',        value: config.enabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: '📝 Salon',         value: config.channelId ? `<#${config.channelId}>` : '*Non défini*', inline: true },
      { name: '📋 Salon de logs', value: config.logChannelId ? `<#${config.logChannelId}>` : '*Aucun*', inline: true },
      { name: '🕒 Cooldown',      value: config.cooldownMinutes > 0 ? `${config.cooldownMinutes} min` : '*Désactivé*', inline: true },
      { name: '🔒 Rôle requis',   value: config.requiredRoleId ? `<@&${config.requiredRoleId}>` : '*Aucun*', inline: true },
      { name: '📄 Transcript web', value: config.transcriptEnabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: '🕵️ Anonymat',      value: config.anonymousAllowed ? '🟢 Autorisé' : '🔴 Interdit', inline: true },
      { name: '💬 Fil auto',      value: config.autoThread ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: '📩 DM Auteur',     value: config.dmNotify ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: '🤖 Auto-approbation', value: config.autoApproveAt > 0 ? `≥ +${config.autoApproveAt} votes nets` : '*Désactivée*', inline: true },
      { name: '🤖 Auto-refus',    value: config.autoDenyAt > 0 ? `≤ -${config.autoDenyAt} votes nets` : '*Désactivé*', inline: true },
      { name: '🏷️ Catégories actives', value: (config.categoriesEnabled || []).map(c => CATEGORY_LABELS[c] || c).join(', ') || '*Aucune*', inline: false },
    )
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId('sugpanel_channel').setPlaceholder('📝 Choisir le salon des suggestions...').addChannelTypes(ChannelType.GuildText),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId('sugpanel_logchannel').setPlaceholder('📋 Choisir le salon de logs (optionnel)...').addChannelTypes(ChannelType.GuildText),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sugpanel_toggle_enabled').setLabel(config.enabled ? 'Désactiver' : 'Activer').setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success).setEmoji('📢'),
    new ButtonBuilder().setCustomId('sugpanel_view_antiabuse').setLabel('Anti-abus').setStyle(ButtonStyle.Secondary).setEmoji('🕒'),
    new ButtonBuilder().setCustomId('sugpanel_view_features').setLabel('Fonctionnalités').setStyle(ButtonStyle.Secondary).setEmoji('⚙️'),
    new ButtonBuilder().setCustomId('sugpanel_view_thresholds').setLabel('Seuils auto').setStyle(ButtonStyle.Secondary).setEmoji('📊'),
  );
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sugpanel_view_categories').setLabel('Catégories').setStyle(ButtonStyle.Secondary).setEmoji('🏷️'),
    new ButtonBuilder().setCustomId('sugpanel_toggle_transcript').setLabel(config.transcriptEnabled ? 'Transcript: ON' : 'Transcript: OFF').setStyle(config.transcriptEnabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('📄'),
    new ButtonBuilder().setCustomId('sugpanel_refresh').setLabel('Actualiser').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
  );

  return { embeds: [embed], components: [row1, row2, row3, row4] };
}

function panelBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sugpanel_back').setLabel('↩️ Retour au panel').setStyle(ButtonStyle.Secondary),
  );
}

function renderAntiAbuse(config) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('🕒 Anti-abus')
    .addFields(
      { name: 'Cooldown entre 2 suggestions', value: config.cooldownMinutes > 0 ? `${config.cooldownMinutes} minute(s)` : '*Désactivé*', inline: true },
      { name: 'Rôle requis pour proposer', value: config.requiredRoleId ? `<@&${config.requiredRoleId}>` : '*Aucun (tout le monde)*', inline: true },
    );
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sugpanel_modal_cooldown').setLabel('Définir le cooldown').setStyle(ButtonStyle.Primary).setEmoji('🕒'),
    new ButtonBuilder().setCustomId('sugpanel_reset_role').setLabel('Retirer le rôle requis').setStyle(ButtonStyle.Danger).setEmoji('🔓').setDisabled(!config.requiredRoleId),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId('sugpanel_role').setPlaceholder('🔒 Choisir le rôle requis...'),
  );
  return { embeds: [embed], components: [row1, row2, panelBackRow()] };
}

function renderFeatures(config) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('⚙️ Fonctionnalités')
    .setDescription('Activez ou désactivez ces options en un clic.');
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sugpanel_toggle_anon').setLabel(`Suggestions anonymes : ${config.anonymousAllowed ? 'Autorisées' : 'Interdites'}`).setStyle(config.anonymousAllowed ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🕵️'),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sugpanel_toggle_autothread').setLabel(`Fil de discussion auto : ${config.autoThread ? 'ON' : 'OFF'}`).setStyle(config.autoThread ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('💬'),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sugpanel_toggle_dmnotify').setLabel(`Notification DM auteur : ${config.dmNotify ? 'ON' : 'OFF'}`).setStyle(config.dmNotify ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('📩'),
  );
  return { embeds: [embed], components: [row1, row2, row3, panelBackRow()] };
}

function renderThresholds(config) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('📊 Seuils d\'auto-modération')
    .setDescription('Résout automatiquement une suggestion selon son solde de votes (👍 − 👎). Mettez 0 pour désactiver.')
    .addFields(
      { name: 'Auto-approbation', value: config.autoApproveAt > 0 ? `Dès **+${config.autoApproveAt}** votes nets` : '*Désactivée*', inline: true },
      { name: 'Auto-refus',       value: config.autoDenyAt > 0 ? `Dès **-${config.autoDenyAt}** votes nets` : '*Désactivé*', inline: true },
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sugpanel_modal_thresholds').setLabel('Définir les seuils').setStyle(ButtonStyle.Primary).setEmoji('📊'),
  );
  return { embeds: [embed], components: [row, panelBackRow()] };
}

function renderCategories(config) {
  const enabled = config.categoriesEnabled || [];
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('🏷️ Catégories')
    .setDescription('Sélectionnez les catégories que les membres pourront choisir en proposant une suggestion.');
  const menu = new StringSelectMenuBuilder()
    .setCustomId('sugpanel_categories')
    .setPlaceholder('🏷️ Choisir les catégories actives...')
    .setMinValues(1)
    .setMaxValues(CATEGORY_KEYS.length)
    .addOptions(CATEGORY_KEYS.map(key => ({
      label: CATEGORY_LABELS[key],
      value: key,
      default: enabled.includes(key),
    })));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), panelBackRow()] };
}

// ═══════════════════════════════════════════════════════════════════════════
//  STATISTIQUES EN TEMPS RÉEL
// ═══════════════════════════════════════════════════════════════════════════
async function renderStatsEmbed(guildId, guild, live = false) {
  const stats = await computeStats(guildId);
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`📊 Statistiques des Suggestions${live ? ' · 🔴 EN DIRECT' : ''}`)
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .addFields(
      { name: '💡 Total',      value: `${stats.total}`, inline: true },
      { name: '⏳ En attente',  value: `${stats.pending}`, inline: true },
      { name: '✅ Approuvées',  value: `${stats.approved}`, inline: true },
      { name: '❌ Refusées',    value: `${stats.denied}`, inline: true },
      { name: '📈 Taux d\'approbation', value: `${stats.approvalRate}%`, inline: true },
      { name: '🗳️ Votes moyens/suggestion', value: `${stats.avgVotes}`, inline: true },
      { name: '📅 Suggestions — 7 derniers jours', value: renderBarChart(stats.last7Days), inline: false },
    );

  if (stats.topVoted.length) {
    embed.addFields({
      name: '🏆 Top suggestions',
      value: stats.topVoted.map((s, i) => `**${i + 1}.** #${s.number} — 👍${s.upvotes} 👎${s.downvotes} *(${STATUS_LABELS[s.status]})*`).join('\n'),
      inline: false,
    });
  }
  if (stats.mostActive.length) {
    embed.addFields({
      name: '🙋 Membres les plus actifs',
      value: stats.mostActive.map((a, i) => `**${i + 1}.** <@${a.userId}> — ${a.count} suggestion(s)`).join('\n'),
      inline: false,
    });
  }

  embed.setFooter({ text: live ? 'Actualisation automatique toutes les 5s' : 'Cliquez sur 🔴 pour activer le direct' }).setTimestamp();
  return embed;
}

function statsRow(live) {
  return new ActionRowBuilder().addComponents(
    live
      ? new ButtonBuilder().setCustomId('sugstats_stop').setLabel('⏹️ Arrêter le direct').setStyle(ButtonStyle.Danger)
      : new ButtonBuilder().setCustomId('sugstats_live').setLabel('🔴 Activer le direct (90s)').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('sugstats_refresh').setLabel('🔄 Actualiser').setStyle(ButtonStyle.Secondary),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggestion')
    .setDescription('💡 Système de suggestions avancé')
    .addSubcommand(s => s
      .setName('proposer')
      .setDescription('Proposer une suggestion')
      .addStringOption(o => o.setName('texte').setDescription('Votre suggestion').setRequired(true).setMaxLength(1000))
      .addStringOption(o => o.setName('categorie').setDescription('Catégorie').addChoices(...CATEGORY_KEYS.map(k => ({ name: CATEGORY_LABELS[k], value: k }))))
      .addBooleanOption(o => o.setName('anonyme').setDescription('Proposer anonymement (si autorisé)')))
    .addSubcommand(s => s
      .setName('approuver')
      .setDescription('Approuver une suggestion (modérateurs)')
      .addIntegerOption(o => o.setName('numero').setDescription('Numéro de la suggestion').setRequired(true))
      .addStringOption(o => o.setName('raison').setDescription('Raison (optionnel)')))
    .addSubcommand(s => s
      .setName('refuser')
      .setDescription('Refuser une suggestion (modérateurs)')
      .addIntegerOption(o => o.setName('numero').setDescription('Numéro de la suggestion').setRequired(true))
      .addStringOption(o => o.setName('raison').setDescription('Raison (optionnel)')))
    .addSubcommand(s => s
      .setName('modifier')
      .setDescription('Modifier votre suggestion en attente')
      .addIntegerOption(o => o.setName('numero').setDescription('Numéro de la suggestion').setRequired(true))
      .addStringOption(o => o.setName('texte').setDescription('Nouveau texte').setRequired(true).setMaxLength(1000)))
    .addSubcommand(s => s
      .setName('supprimer')
      .setDescription('Supprimer votre suggestion en attente')
      .addIntegerOption(o => o.setName('numero').setDescription('Numéro de la suggestion').setRequired(true)))
    .addSubcommand(s => s
      .setName('top')
      .setDescription('Top 5 des suggestions les plus votées'))
    .addSubcommand(s => s
      .setName('stats')
      .setDescription('Statistiques en temps réel du système de suggestions'))
    .addSubcommand(s => s
      .setName('panel')
      .setDescription('Panel de configuration avancé (modérateurs)')),

  async execute(interaction, client) {
    const sub   = interaction.options.getSubcommand();
    const guild = interaction.guild;

    // ── PROPOSER ────────────────────────────────────────────────────────────
    if (sub === 'proposer') {
      const config = await SuggestionConfig.findOne({ guildId: guild.id });
      if (!config?.enabled || !config?.channelId) {
        return interaction.reply({ embeds: [errorEmbed('Désactivé', 'Le système de suggestions n\'est pas configuré sur ce serveur.')], ephemeral: true });
      }

      if (!checkRequiredRole(config, interaction.member.roles.cache.map(r => r.id))) {
        return interaction.reply({ embeds: [errorEmbed('Rôle requis', `Vous devez avoir le rôle <@&${config.requiredRoleId}> pour proposer une suggestion.`)], ephemeral: true });
      }

      const lastSuggestion = await Suggestion.findOne({ guildId: guild.id, authorId: interaction.user.id }).sort({ createdAt: -1 });
      const cooldown = checkCooldown(config, lastSuggestion?.createdAt || null);
      if (!cooldown.ok) {
        return interaction.reply({ embeds: [errorEmbed('Cooldown actif', `Vous devez attendre encore **${cooldown.remainingMinutes} min** avant de proposer une nouvelle suggestion.`)], ephemeral: true });
      }

      const text     = interaction.options.getString('texte');
      const category = interaction.options.getString('categorie') || 'general';
      let anonymous  = interaction.options.getBoolean('anonyme') || false;
      if (anonymous && !config.anonymousAllowed) anonymous = false;
      if (config.categoriesEnabled?.length && !config.categoriesEnabled.includes(category)) {
        return interaction.reply({ embeds: [errorEmbed('Catégorie désactivée', `La catégorie **${CATEGORY_LABELS[category]}** n'est pas activée sur ce serveur.`)], ephemeral: true });
      }

      const count  = await Suggestion.countDocuments({ guildId: guild.id });
      const number = count + 1;

      const suggestion = await Suggestion.create({
        guildId: guild.id, channelId: config.channelId, authorId: interaction.user.id,
        content: text, number, category, anonymous,
      });

      const channel = await guild.channels.fetch(config.channelId).catch(() => null);
      if (!channel) return interaction.reply({ embeds: [errorEmbed('Erreur', 'Salon introuvable.')], ephemeral: true });

      const embed = buildSuggestionEmbed(suggestion, anonymous ? null : interaction.user, config);
      const row   = buildVoteRow(suggestion, config);
      const msg   = await channel.send({ embeds: [embed], components: [row] });
      suggestion.messageId = msg.id;

      if (config.autoThread && channel.threads) {
        try {
          const thread = await msg.startThread({ name: `💡 Suggestion #${number}`, autoArchiveDuration: 1440 });
          suggestion.threadId = thread.id;
          await logAction({ client, guildId: guild.id, suggestionId: suggestion._id, action: 'thread_created', actorId: null, suggestionNumber: number });
        } catch (_) {}
      }
      await suggestion.save();

      await logAction({ client, guildId: guild.id, suggestionId: suggestion._id, action: 'created', actorId: interaction.user.id, suggestionNumber: number });

      return interaction.reply({ embeds: [successEmbed('Suggestion envoyée !', `Ta suggestion **#${number}** a été publiée dans <#${config.channelId}>. 💡`)], ephemeral: true });
    }

    // ── APPROUVER / REFUSER ─────────────────────────────────────────────────
    if (sub === 'approuver' || sub === 'refuser') {
      if (!isMod(interaction)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Vous devez avoir la permission `Gérer le serveur`.')], ephemeral: true });
      }

      const number = interaction.options.getInteger('numero');
      const raison = interaction.options.getString('raison') || null;
      const status = sub === 'approuver' ? 'approved' : 'denied';
      const suggestion = await Suggestion.findOne({ guildId: guild.id, number });
      if (!suggestion) return interaction.reply({ embeds: [errorEmbed('Introuvable', `Aucune suggestion #${number} trouvée.`)], ephemeral: true });
      if (suggestion.status !== 'pending') {
        return interaction.reply({ embeds: [errorEmbed('Déjà traitée', `La suggestion #${number} a déjà été ${STATUS_LABELS[suggestion.status].toLowerCase()}.`)], ephemeral: true });
      }

      suggestion.status = status;
      suggestion.reason = raison;
      suggestion.resolvedAt = new Date();
      suggestion.resolvedBy = interaction.user.id;
      await suggestion.save();

      const config = await getOrCreateConfig(guild.id);
      await refreshSuggestionMessage(client, suggestion, config);
      await logAction({ client, guildId: guild.id, suggestionId: suggestion._id, action: status, actorId: interaction.user.id, detail: raison || '', suggestionNumber: number });
      await notifyAuthor(client, suggestion, config, status === 'approved' ? '✅ Suggestion approuvée' : '❌ Suggestion refusée');

      return interaction.reply({ embeds: [successEmbed(`Suggestion ${sub === 'approuver' ? 'approuvée' : 'refusée'}`, `Suggestion #${number} mise à jour.`)] });
    }

    // ── MODIFIER ─────────────────────────────────────────────────────────────
    if (sub === 'modifier') {
      const number = interaction.options.getInteger('numero');
      const suggestion = await Suggestion.findOne({ guildId: guild.id, number });
      if (!suggestion) return interaction.reply({ embeds: [errorEmbed('Introuvable', `Aucune suggestion #${number} trouvée.`)], ephemeral: true });
      if (suggestion.authorId !== interaction.user.id && !isMod(interaction)) {
        return interaction.reply({ embeds: [errorEmbed('Non autorisé', 'Vous ne pouvez modifier que vos propres suggestions.')], ephemeral: true });
      }
      if (suggestion.status !== 'pending') {
        return interaction.reply({ embeds: [errorEmbed('Impossible', 'Seules les suggestions en attente peuvent être modifiées.')], ephemeral: true });
      }

      suggestion.content = interaction.options.getString('texte');
      suggestion.editedAt = new Date();
      await suggestion.save();

      const config = await getOrCreateConfig(guild.id);
      await refreshSuggestionMessage(client, suggestion, config);
      await logAction({ client, guildId: guild.id, suggestionId: suggestion._id, action: 'edited', actorId: interaction.user.id, suggestionNumber: number });

      return interaction.reply({ embeds: [successEmbed('Suggestion modifiée', `Suggestion #${number} mise à jour.`)], ephemeral: true });
    }

    // ── SUPPRIMER ────────────────────────────────────────────────────────────
    if (sub === 'supprimer') {
      const number = interaction.options.getInteger('numero');
      const suggestion = await Suggestion.findOne({ guildId: guild.id, number });
      if (!suggestion) return interaction.reply({ embeds: [errorEmbed('Introuvable', `Aucune suggestion #${number} trouvée.`)], ephemeral: true });
      if (suggestion.authorId !== interaction.user.id && !isMod(interaction)) {
        return interaction.reply({ embeds: [errorEmbed('Non autorisé', 'Vous ne pouvez supprimer que vos propres suggestions.')], ephemeral: true });
      }
      if (suggestion.status !== 'pending' && !isMod(interaction)) {
        return interaction.reply({ embeds: [errorEmbed('Impossible', 'Seules les suggestions en attente peuvent être supprimées.')], ephemeral: true });
      }

      try {
        const channel = await guild.channels.fetch(suggestion.channelId).catch(() => null);
        const msg = suggestion.messageId ? await channel?.messages.fetch(suggestion.messageId).catch(() => null) : null;
        await msg?.delete().catch(() => {});
      } catch (_) {}

      await logAction({ client, guildId: guild.id, suggestionId: suggestion._id, action: 'deleted', actorId: interaction.user.id, suggestionNumber: number });
      await Suggestion.deleteOne({ _id: suggestion._id });

      return interaction.reply({ embeds: [successEmbed('Suggestion supprimée', `Suggestion #${number} supprimée.`)], ephemeral: true });
    }

    // ── TOP ──────────────────────────────────────────────────────────────────
    if (sub === 'top') {
      const stats = await computeStats(guild.id);
      if (!stats.topVoted.length) {
        return interaction.reply({ embeds: [infoEmbed('Aucune suggestion', 'Il n\'y a pas encore de suggestion sur ce serveur.')], ephemeral: true });
      }
      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('🏆 Top 5 des suggestions')
        .setDescription(stats.topVoted.map((s, i) => {
          const medal = ['🥇', '🥈', '🥉', '🏅', '🏅'][i];
          return `${medal} **#${s.number}** — ${(s.content || '').slice(0, 80)}${s.content.length > 80 ? '…' : ''}\n👍 ${s.upvotes}  👎 ${s.downvotes}  ·  ${STATUS_LABELS[s.status]}`;
        }).join('\n\n'))
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // ── STATS (temps réel) ──────────────────────────────────────────────────
    if (sub === 'stats') {
      await interaction.deferReply();
      const embed = await renderStatsEmbed(guild.id, guild, false);
      const message = await interaction.editReply({ embeds: [embed], components: [statsRow(false)] });

      const collector = message.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: COLLECTOR_TIMEOUT_MS });
      let liveInterval = null;
      const stopLive = () => { if (liveInterval) { clearInterval(liveInterval); liveInterval = null; } };

      collector.on('collect', async (i) => {
        if (i.customId === 'sugstats_refresh') {
          await i.update({ embeds: [await renderStatsEmbed(guild.id, guild, !!liveInterval)], components: [statsRow(!!liveInterval)] });
          return;
        }
        if (i.customId === 'sugstats_stop') {
          stopLive();
          await i.update({ embeds: [await renderStatsEmbed(guild.id, guild, false)], components: [statsRow(false)] });
          return;
        }
        if (i.customId === 'sugstats_live') {
          await i.update({ embeds: [await renderStatsEmbed(guild.id, guild, true)], components: [statsRow(true)] });
          stopLive();
          const endAt = Date.now() + LIVE_STATS_DURATION_MS;
          liveInterval = setInterval(async () => {
            if (Date.now() >= endAt) { stopLive(); await interaction.editReply({ embeds: [await renderStatsEmbed(guild.id, guild, false)], components: [statsRow(false)] }).catch(() => {}); return; }
            await interaction.editReply({ embeds: [await renderStatsEmbed(guild.id, guild, true)], components: [statsRow(true)] }).catch(() => {});
          }, LIVE_STATS_INTERVAL_MS);
        }
      });

      collector.on('end', () => { stopLive(); interaction.editReply({ components: [] }).catch(() => {}); });
      return;
    }

    // ── PANEL ────────────────────────────────────────────────────────────────
    if (sub === 'panel') {
      if (!isMod(interaction)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Vous devez avoir la permission `Gérer le serveur`.')], ephemeral: true });
      }

      let config = await getOrCreateConfig(guild.id);
      const reply = await interaction.reply({ ...renderOverview(config), ephemeral: true, fetchReply: true });

      const collector = reply.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: COLLECTOR_TIMEOUT_MS });

      collector.on('collect', async (i) => {
        const id = i.customId;
        config = await getOrCreateConfig(guild.id);

        // ── Navigation ──
        if (id === 'sugpanel_back' || id === 'sugpanel_refresh') {
          return i.update(renderOverview(config));
        }
        if (id === 'sugpanel_view_antiabuse') return i.update(renderAntiAbuse(config));
        if (id === 'sugpanel_view_features')  return i.update(renderFeatures(config));
        if (id === 'sugpanel_view_thresholds') return i.update(renderThresholds(config));
        if (id === 'sugpanel_view_categories') return i.update(renderCategories(config));

        // ── Salons ──
        if (id === 'sugpanel_channel') {
          config.channelId = i.values[0];
          config.enabled = true;
          await config.save();
          await logAction({ client, guildId: guild.id, suggestionId: 'config', action: 'config_changed', actorId: i.user.id, detail: `Salon défini : <#${config.channelId}>` });
          return i.update(renderOverview(config));
        }
        if (id === 'sugpanel_logchannel') {
          config.logChannelId = i.values[0];
          await config.save();
          return i.update(renderOverview(config));
        }

        // ── Toggles simples ──
        if (id === 'sugpanel_toggle_enabled') {
          config.enabled = !config.enabled;
          await config.save();
          await logAction({ client, guildId: guild.id, suggestionId: 'config', action: 'config_changed', actorId: i.user.id, detail: config.enabled ? 'Système activé' : 'Système désactivé' });
          return i.update(renderOverview(config));
        }
        if (id === 'sugpanel_toggle_transcript') {
          config.transcriptEnabled = !config.transcriptEnabled;
          await config.save();
          return i.update(renderOverview(config));
        }
        if (id === 'sugpanel_toggle_anon') {
          config.anonymousAllowed = !config.anonymousAllowed;
          await config.save();
          return i.update(renderFeatures(config));
        }
        if (id === 'sugpanel_toggle_autothread') {
          config.autoThread = !config.autoThread;
          await config.save();
          return i.update(renderFeatures(config));
        }
        if (id === 'sugpanel_toggle_dmnotify') {
          config.dmNotify = !config.dmNotify;
          await config.save();
          return i.update(renderFeatures(config));
        }

        // ── Anti-abus ──
        if (id === 'sugpanel_role') {
          config.requiredRoleId = i.values[0];
          await config.save();
          return i.update(renderAntiAbuse(config));
        }
        if (id === 'sugpanel_reset_role') {
          config.requiredRoleId = null;
          await config.save();
          return i.update(renderAntiAbuse(config));
        }
        if (id === 'sugpanel_modal_cooldown') {
          const modal = new ModalBuilder().setCustomId('sugpanel_modal_cooldown_submit').setTitle('Cooldown entre suggestions');
          const input = new TextInputBuilder().setCustomId('minutes').setLabel('Minutes (0 = désactivé)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(config.cooldownMinutes || 0));
          modal.addComponents(new ActionRowBuilder().addComponents(input));
          return i.showModal(modal);
        }

        // ── Seuils ──
        if (id === 'sugpanel_modal_thresholds') {
          const modal = new ModalBuilder().setCustomId('sugpanel_modal_thresholds_submit').setTitle('Seuils d\'auto-modération');
          const approve = new TextInputBuilder().setCustomId('auto_approve').setLabel('Auto-approbation (votes nets, 0=off)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(config.autoApproveAt || 0));
          const deny = new TextInputBuilder().setCustomId('auto_deny').setLabel('Auto-refus (votes nets, 0=off)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(config.autoDenyAt || 0));
          modal.addComponents(new ActionRowBuilder().addComponents(approve), new ActionRowBuilder().addComponents(deny));
          return i.showModal(modal);
        }

        // ── Catégories ──
        if (id === 'sugpanel_categories') {
          config.categoriesEnabled = i.values;
          await config.save();
          return i.update(renderCategories(config));
        }
      });

      collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
      return;
    }
  },

  // ─── Modaux du panel ──────────────────────────────────────────────────────
  async handleModal(interaction) {
    const id = interaction.customId;
    const guild = interaction.guild;
    const config = await getOrCreateConfig(guild.id);

    if (id === 'sugpanel_modal_cooldown_submit') {
      const raw = interaction.fields.getTextInputValue('minutes').trim();
      const minutes = parseInt(raw, 10);
      if (isNaN(minutes) || minutes < 0 || minutes > 10080) {
        return interaction.reply({ embeds: [errorEmbed('Valeur invalide', 'Entrez un nombre de minutes entre 0 et 10080 (7 jours).')], ephemeral: true });
      }
      config.cooldownMinutes = minutes;
      await config.save();
      return interaction.update(renderAntiAbuse(config)).catch(() => interaction.reply({ embeds: [successEmbed('Cooldown mis à jour')], ephemeral: true }));
    }

    if (id === 'sugpanel_modal_thresholds_submit') {
      const rawApprove = interaction.fields.getTextInputValue('auto_approve').trim();
      const rawDeny    = interaction.fields.getTextInputValue('auto_deny').trim();
      const approve = parseInt(rawApprove, 10);
      const deny    = parseInt(rawDeny, 10);
      if (isNaN(approve) || isNaN(deny) || approve < 0 || deny < 0) {
        return interaction.reply({ embeds: [errorEmbed('Valeur invalide', 'Entrez des nombres entiers positifs (0 pour désactiver).')], ephemeral: true });
      }
      config.autoApproveAt = approve;
      config.autoDenyAt = deny;
      await config.save();
      return interaction.update(renderThresholds(config)).catch(() => interaction.reply({ embeds: [successEmbed('Seuils mis à jour')], ephemeral: true }));
    }
  },

  // ─── Vote boutons (message public, persistant) ──────────────────────────────
  async handleVote(interaction, suggestionId, type) {
    const suggestion = await Suggestion.findById(suggestionId);
    if (!suggestion) {
      return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Cette suggestion n\'existe plus.')], ephemeral: true });
    }
    if (suggestion.status !== 'pending') {
      return interaction.reply({ embeds: [errorEmbed('Clôturée', 'Cette suggestion n\'accepte plus de votes.')], ephemeral: true });
    }

    const result = applyVote(suggestion, interaction.user.id, type);
    if (!result.changed) {
      return interaction.reply({ embeds: [errorEmbed('Déjà voté', 'Tu as déjà voté dans ce sens pour cette suggestion.')], ephemeral: true });
    }
    await suggestion.save();

    const config = await getOrCreateConfig(interaction.guild.id);
    await logAction({
      client: interaction.client, guildId: interaction.guild.id, suggestionId: suggestion._id,
      action: result.switched ? 'vote_changed' : (type === 'up' ? 'upvoted' : 'downvoted'),
      actorId: interaction.user.id, suggestionNumber: suggestion.number,
    });

    // ── Auto-résolution par seuil de votes ──
    const autoStatus = checkAutoResolve(config, suggestion);
    if (autoStatus) {
      suggestion.status = autoStatus;
      suggestion.autoResolved = true;
      suggestion.reason = `Résolu automatiquement (${suggestion.upvotes - suggestion.downvotes >= 0 ? '+' : ''}${suggestion.upvotes - suggestion.downvotes} votes nets)`;
      suggestion.resolvedAt = new Date();
      await suggestion.save();
      await logAction({ client: interaction.client, guildId: interaction.guild.id, suggestionId: suggestion._id, action: autoStatus === 'approved' ? 'auto_approved' : 'auto_denied', actorId: null, suggestionNumber: suggestion.number });
      await notifyAuthor(interaction.client, suggestion, config, autoStatus === 'approved' ? '✅ Suggestion approuvée automatiquement' : '❌ Suggestion refusée automatiquement');
    }

    const author = suggestion.anonymous ? null : await interaction.client.users.fetch(suggestion.authorId).catch(() => null);
    await interaction.update({ embeds: [buildSuggestionEmbed(suggestion, author, config)], components: [buildVoteRow(suggestion, config)] });
    return interaction.followUp({
      embeds: [successEmbed('Vote enregistré !', `Tu as ${type === 'up' ? '👍 approuvé' : '👎 refusé'} cette suggestion${result.switched ? ' (vote modifié)' : ''}.`)],
      ephemeral: true,
    });
  },
};
