'use strict';
// commands/suggestion.js — Système de suggestions v2 (sans dashboard)
//
// - Configuration via UN SEUL panneau éphémère (/suggestion config), 5 rangées max :
//   menus salon + logs + logs avancés, bouton statut, bouton anti-abus (modal),
//   bouton catégories (menu), logs DM, seuils auto (modal).
// - Flux direct par sous-commandes : proposer / approuver / refuser / modifier /
//   supprimer / top / stats — aucun dashboard de navigation.
// - Boutons de modération persistants (résoudre/épingler) sur les messages publics,
//   et votes 👍/👎 persistants gérés par interactionCreate (handleVote).
// - Logs avancés : chaque type d'événement est filtrable individuellement.

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

const { Suggestion, SuggestionConfig, CATEGORY_KEYS } = require('../../models/Suggestion');
const { logAction, LOG_TYPE_KEYS, LOG_TYPE_LABELS, isLogTypeEnabled } = require('../../utils/suggestionLogger');
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

const CONFIG_TIMEOUT_MS = 10 * 60 * 1000;

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
    embed.setFooter({ text: `Proposé par ${author?.username ?? 'Inconnu'}`, iconURL: author?.displayAvatarURL?.() });
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

/** Boutons de modération visibles uniquement par les modérateurs (Discord gère la visibilité). */
function buildModRow(suggestion) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sugm_approve_${suggestion._id}`).setLabel('Résoudre (approuver)').setStyle(ButtonStyle.Success).setEmoji('✅').setDisabled(suggestion.status !== 'pending'),
    new ButtonBuilder().setCustomId(`sugm_deny_${suggestion._id}`).setLabel('Refuser').setStyle(ButtonStyle.Danger).setEmoji('❌').setDisabled(suggestion.status !== 'pending'),
    new ButtonBuilder().setCustomId(`sugm_pin_${suggestion._id}`).setLabel(suggestion.pinned ? 'Désépingler' : 'Épingler').setStyle(ButtonStyle.Secondary).setEmoji('📌'),
  );
}

async function refreshSuggestionMessage(client, suggestion, config) {
  try {
    const channel = await client.channels.fetch(suggestion.channelId).catch(() => null);
    if (!channel || !suggestion.messageId) return;
    const msg = await channel.messages.fetch(suggestion.messageId).catch(() => null);
    if (!msg) return;
    const author = suggestion.anonymous ? null : await client.users.fetch(suggestion.authorId).catch(() => null);
    await msg.edit({ embeds: [buildSuggestionEmbed(suggestion, author, config)], components: [buildVoteRow(suggestion, config), buildModRow(suggestion)] });
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
//  PANNEAU DE CONFIGURATION UNIQUE (éphémère, 5 rangées max)
// ═══════════════════════════════════════════════════════════════════════════
function buildConfigPanel(config, client) {
  const lt = config.logTypes;
  const logsSummary = LOG_TYPE_KEYS.filter(k => isLogTypeEnabled(config, k)).length;

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('💡 Configuration — Système de Suggestions')
    .setDescription('Panneau unique : tout se règle ici. Les boutons **Anti-abus** et **Seuils auto** ouvrent un petit formulaire, le reste se règle par menu.')
    .addFields(
      { name: '📢 Statut',           value: config.enabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: '📝 Salon',            value: config.channelId ? `<#${config.channelId}>` : '*Non défini*', inline: true },
      { name: '📋 Salon de logs',    value: config.logChannelId ? `<#${config.logChannelId}>` : '*Aucun*', inline: true },
      { name: '🕒 Cooldown',         value: config.cooldownMinutes > 0 ? `${config.cooldownMinutes} min` : '*Désactivé*', inline: true },
      { name: '🔒 Rôle requis',      value: config.requiredRoleId ? `<@&${config.requiredRoleId}>` : '*Aucun*', inline: true },
      { name: '🏷️ Catégories',       value: (config.categoriesEnabled || []).length ? `${(config.categoriesEnabled || []).length}/${CATEGORY_KEYS.length} actives` : '*Aucune*', inline: true },
      { name: '🕵️ Anonymat',         value: config.anonymousAllowed ? '🟢 Autorisé' : '🔴 Interdit', inline: true },
      { name: '💬 Fil auto',         value: config.autoThread ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: '📩 DM auteur',        value: config.dmNotify ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: '🤖 Auto-approbation', value: config.autoApproveAt > 0 ? `≥ +${config.autoApproveAt} votes nets` : '*Désactivée*', inline: true },
      { name: '🤖 Auto-refus',       value: config.autoDenyAt > 0 ? `≤ -${config.autoDenyAt} votes nets` : '*Désactivé*', inline: true },
      { name: '🧾 Logs avancés',     value: logsSummary === LOG_TYPE_KEYS.length ? `Tous (${LOG_TYPE_KEYS.length} types)` : `${logsSummary}/${LOG_TYPE_KEYS.length} types`, inline: true },
    )
    .setFooter({ text: "Panneau éphémère — ne disparaît que pour vous après 10 min d'inactivité" })
    .setTimestamp();

  // Rangée 1 — salon des suggestions + salon de logs
  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId('sugc_channel').setPlaceholder('📝 Salon des suggestions…').addChannelTypes(ChannelType.GuildText),
    new ChannelSelectMenuBuilder().setCustomId('sugc_logchannel').setPlaceholder('📋 Salon des logs…').addChannelTypes(ChannelType.GuildText),
  );

  // Rangée 2 — types de logs avancés (multi-select, maxValues = nb de defaults)
  const defaults = LOG_TYPE_KEYS.filter(k => isLogTypeEnabled(config, k));
  const logsMenu = new StringSelectMenuBuilder()
    .setCustomId('sugc_logtypes')
    .setPlaceholder('🧾 Logs avancés — choisir les types relayés…')
    .setMinValues(0)
    .setMaxValues(Math.max(1, defaults.length))
    .addOptions(LOG_TYPE_KEYS.map(key => ({
      label: LOG_TYPE_LABELS[key] || key,
      value: key,
      default: isLogTypeEnabled(config, key),
    })));
  const row2 = new ActionRowBuilder().addComponents(logsMenu);

  // Rangée 3 — statut + catégories + anti-abus + seuils
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sugc_toggle_enabled').setLabel(config.enabled ? 'Désactiver le système' : 'Activer le système').setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success).setEmoji('📢'),
    new ButtonBuilder().setCustomId('sugc_categories').setLabel(`Catégories (${(config.categoriesEnabled || []).length})`).setStyle(ButtonStyle.Secondary).setEmoji('🏷️'),
    new ButtonBuilder().setCustomId('sugc_antiabuse').setLabel('Anti-abus').setStyle(ButtonStyle.Secondary).setEmoji('🕒'),
    new ButtonBuilder().setCustomId('sugc_thresholds').setLabel('Seuils auto').setStyle(ButtonStyle.Secondary).setEmoji('📊'),
  );

  // Rangée 4 — fonctionnalités
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sugc_toggle_anon').setLabel(`Anonymat : ${config.anonymousAllowed ? 'ON' : 'OFF'}`).setStyle(config.anonymousAllowed ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🕵️'),
    new ButtonBuilder().setCustomId('sugc_toggle_autothread').setLabel(`Fil auto : ${config.autoThread ? 'ON' : 'OFF'}`).setStyle(config.autoThread ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('💬'),
    new ButtonBuilder().setCustomId('sugc_toggle_dmnotify').setLabel(`DM auteur : ${config.dmNotify ? 'ON' : 'OFF'}`).setStyle(config.dmNotify ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('📩'),
  );

  // Rangée 5 — transcript + actualiser
  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sugc_toggle_transcript').setLabel(`Transcript web : ${config.transcriptEnabled ? 'ON' : 'OFF'}`).setStyle(config.transcriptEnabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('📄'),
    new ButtonBuilder().setCustomId('sugc_refresh').setLabel('Actualiser').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
  );

  return { embeds: [embed], components: [row1, row2, row3, row4, row5] };
}

// ═══════════════════════════════════════════════════════════════════════════
//  STATISTIQUES
// ═══════════════════════════════════════════════════════════════════════════
async function renderStatsEmbed(guildId, guild) {
  const stats = await computeStats(guildId);
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('📊 Statistiques des Suggestions')
    .setThumbnail(guild?.iconURL?.({ dynamic: true }) ?? null)
    .addFields(
      { name: '💡 Total',      value: `${stats.total}`, inline: true },
      { name: '⏳ En attente',  value: `${stats.pending}`, inline: true },
      { name: '✅ Approuvées',  value: `${stats.approved}`, inline: true },
      { name: '❌ Refusées',    value: `${stats.denied}`, inline: true },
      { name: "📈 Taux d'approbation", value: `${stats.approvalRate}%`, inline: true },
      { name: '🗳️ Votes moyens/suggestion', value: `${stats.avgVotes}`, inline: true },
      { name: '📅 Suggestions — 7 derniers jours', value: renderBarChart(stats.last7Days), inline: false },
    )
    .setTimestamp();
  return embed;
}

// ═══════════════════════════════════════════════════════════════════════════
module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggestion')
    .setDescription('💡 Système de suggestions (v2)')
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
      .setDescription('Statistiques du système de suggestions'))
    .addSubcommand(s => s
      .setName('config')
      .setDescription('Panneau de configuration unique (modérateurs)')),

  async execute(interaction, client) {
    const sub   = interaction.options.getSubcommand();
    const guild = interaction.guild;

    // ── PROPOSER ────────────────────────────────────────────────────────────
    if (sub === 'proposer') {
      const config = await SuggestionConfig.findOne({ guildId: guild.id });
      if (!config?.enabled || !config?.channelId) {
        return interaction.reply({ embeds: [errorEmbed('Désactivé', "Le système de suggestions n'est pas configuré sur ce serveur.")], ephemeral: true });
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
      const msg   = await channel.send({ embeds: [embed], components: [buildVoteRow(suggestion, config), buildModRow(suggestion)] });
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
        return interaction.reply({ embeds: [infoEmbed('Aucune suggestion', "Il n'y a pas encore de suggestion sur ce serveur.")], ephemeral: true });
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

    // ── STATS ────────────────────────────────────────────────────────────────
    if (sub === 'stats') {
      const embed = await renderStatsEmbed(guild.id, guild);
      return interaction.reply({ embeds: [embed] });
    }

    // ── CONFIG (panneau unique) ─────────────────────────────────────────────
    if (sub === 'config') {
      if (!isMod(interaction)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Vous devez avoir la permission `Gérer le serveur`.')], ephemeral: true });
      }

      const config = await getOrCreateConfig(guild.id);
      const reply = await interaction.reply({ ...buildConfigPanel(config, client), ephemeral: true, fetchReply: true });

      const collector = reply.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: CONFIG_TIMEOUT_MS });

      // Le collecteur sert uniquement à maintenir le panneau actif et à retirer
      // les composants après 10 min. Toutes les actions (sugc_*) sont routées de
      // façon persistante par interactionCreate → handleButton / handleSelect.
      collector.on('collect', () => {});

      collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
      return;
    }
  },

  // ─── Menus du panneau (persistants, routés par interactionCreate) ─────────
  async handleSelect(interaction, client) {
    const id = interaction.customId;
    const guildId = interaction.guild.id;
    const config = await getOrCreateConfig(guildId);

    if (id === 'sugc_channel') {
      config.channelId = interaction.values[0];
      config.enabled = true;
      await config.save();
      await logAction({ client, guildId, suggestionId: 'config', action: 'config_changed', actorId: interaction.user.id, detail: `Salon défini : <#${config.channelId}>` });
      return interaction.update(buildConfigPanel(config, client));
    }
    if (id === 'sugc_logchannel') {
      config.logChannelId = interaction.values[0];
      await config.save();
      await logAction({ client, guildId, suggestionId: 'config', action: 'config_changed', actorId: interaction.user.id, detail: `Salon de logs défini : <#${config.logChannelId}>` });
      return interaction.update(buildConfigPanel(config, client));
    }
    if (id === 'sugc_logtypes') {
      // Menus multi : tout désélectionné → tout désactivé ; sinon seulement la sélection.
      const selected = new Set(interaction.values);
      const next = {};
      for (const key of LOG_TYPE_KEYS) next[key] = selected.has(key);
      config.logTypes = next;
      await config.save();
      await logAction({ client, guildId, suggestionId: 'config', action: 'config_changed', actorId: interaction.user.id, detail: 'Types de logs mis à jour' });
      return interaction.update(buildConfigPanel(config, client));
    }
    if (id === 'sugc_categories') {
      // Sélection vide = toutes les catégories actives (comportement par défaut).
      config.categoriesEnabled = interaction.values.length ? interaction.values : [...CATEGORY_KEYS];
      await config.save();
      await logAction({ client, guildId, suggestionId: 'config', action: 'config_changed', actorId: interaction.user.id, detail: 'Catégories mises à jour' });
      return interaction.update({ embeds: [successEmbed('Catégories mises à jour', `Catégories actives : ${config.categoriesEnabled.map(c => CATEGORY_LABELS[c] || c).join(', ')}`)], components: [] });
    }
  },

  // ─── Boutons du panneau + modération persistante (routés par interactionCreate) ──
  async handleButton(interaction, client) {
    const id = interaction.customId;

    // ── Modération persistante sur les messages publics ──
    if (id.startsWith('sugm_approve_') || id.startsWith('sugm_deny_')) {
      if (!isMod(interaction)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Vous devez avoir la permission `Gérer le serveur`.')], ephemeral: true });
      }
      const action = id.startsWith('sugm_approve_') ? 'approved' : 'denied';
      const suggestionId = id.replace(id.startsWith('sugm_approve_') ? 'sugm_approve_' : 'sugm_deny_', '');
      const suggestion = await Suggestion.findById(suggestionId);
      if (!suggestion) return interaction.reply({ embeds: [errorEmbed('Introuvable', "Cette suggestion n'existe plus.")], ephemeral: true });
      if (suggestion.status !== 'pending') {
        return interaction.reply({ embeds: [errorEmbed('Déjà traitée', `Cette suggestion a déjà été ${STATUS_LABELS[suggestion.status].toLowerCase()}.`)], ephemeral: true });
      }
      if (suggestion.guildId !== interaction.guildId) {
        return interaction.reply({ embeds: [errorEmbed('Erreur', 'Cette suggestion appartient à un autre serveur.')], ephemeral: true });
      }

      suggestion.status = action;
      suggestion.resolvedAt = new Date();
      suggestion.resolvedBy = interaction.user.id;
      await suggestion.save();

      const config = await getOrCreateConfig(interaction.guildId);
      await refreshSuggestionMessage(interaction.client, suggestion, config);
      await logAction({ client: interaction.client, guildId: interaction.guildId, suggestionId: suggestion._id, action, actorId: interaction.user.id, suggestionNumber: suggestion.number });
      await notifyAuthor(interaction.client, suggestion, config, action === 'approved' ? '✅ Suggestion approuvée' : '❌ Suggestion refusée');

      return interaction.reply({ embeds: [successEmbed('Suggestion traitée', `Suggestion **#${suggestion.number}** ${action === 'approved' ? 'approuvée' : 'refusée'} par <@${interaction.user.id}>.`)] });
    }

    if (id.startsWith('sugm_pin_')) {
      if (!isMod(interaction)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Vous devez avoir la permission `Gérer le serveur`.')], ephemeral: true });
      }
      const suggestionId = id.replace('sugm_pin_', '');
      const suggestion = await Suggestion.findById(suggestionId);
      if (!suggestion) return interaction.reply({ embeds: [errorEmbed('Introuvable', "Cette suggestion n'existe plus.")], ephemeral: true });
      if (suggestion.guildId !== interaction.guildId) {
        return interaction.reply({ embeds: [errorEmbed('Erreur', 'Cette suggestion appartient à un autre serveur.')], ephemeral: true });
      }

      suggestion.pinned = !suggestion.pinned;
      await suggestion.save();
      const config = await getOrCreateConfig(interaction.guildId);
      await refreshSuggestionMessage(interaction.client, suggestion, config);
      await logAction({ client: interaction.client, guildId: interaction.guildId, suggestionId: suggestion._id, action: suggestion.pinned ? 'pinned' : 'unpinned', actorId: interaction.user.id, suggestionNumber: suggestion.number });

      const author = suggestion.anonymous ? null : await interaction.client.users.fetch(suggestion.authorId).catch(() => null);
      await interaction.update({ embeds: [buildSuggestionEmbed(suggestion, author, config)], components: [buildVoteRow(suggestion, config), buildModRow(suggestion)] });
      return interaction.followUp({
        embeds: [successEmbed(suggestion.pinned ? 'Suggestion épinglée' : 'Suggestion désépinglée', `Suggestion **#${suggestion.number}** mise à jour.`)],
        ephemeral: true,
      });
    }

    // ── Boutons du panneau de configuration ──
    if (id === 'sugc_refresh') {
      const config = await getOrCreateConfig(interaction.guildId);
      return interaction.update(buildConfigPanel(config, interaction.client));
    }

    if (id === 'sugc_toggle_enabled') {
      const config = await getOrCreateConfig(interaction.guildId);
      config.enabled = !config.enabled;
      await config.save();
      await logAction({ client: interaction.client, guildId: interaction.guildId, suggestionId: 'config', action: 'config_changed', actorId: interaction.user.id, detail: config.enabled ? 'Système activé' : 'Système désactivé' });
      return interaction.update(buildConfigPanel(config, interaction.client));
    }

    if (id === 'sugc_toggle_anon') {
      const config = await getOrCreateConfig(interaction.guildId);
      config.anonymousAllowed = !config.anonymousAllowed;
      await config.save();
      return interaction.update(buildConfigPanel(config, interaction.client));
    }

    if (id === 'sugc_toggle_autothread') {
      const config = await getOrCreateConfig(interaction.guildId);
      config.autoThread = !config.autoThread;
      await config.save();
      return interaction.update(buildConfigPanel(config, interaction.client));
    }

    if (id === 'sugc_toggle_dmnotify') {
      const config = await getOrCreateConfig(interaction.guildId);
      config.dmNotify = !config.dmNotify;
      await config.save();
      return interaction.update(buildConfigPanel(config, interaction.client));
    }

    if (id === 'sugc_toggle_transcript') {
      const config = await getOrCreateConfig(interaction.guildId);
      config.transcriptEnabled = !config.transcriptEnabled;
      await config.save();
      return interaction.update(buildConfigPanel(config, interaction.client));
    }

    if (id === 'sugc_antiabuse') {
      const config = await getOrCreateConfig(interaction.guildId);
      const modal = new ModalBuilder().setCustomId('sugm_modal_cooldown').setTitle('🕒 Anti-abus');
      const minutes = new TextInputBuilder().setCustomId('minutes').setLabel('Cooldown en minutes (0 = désactivé)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(config.cooldownMinutes || 0));
      const role = new TextInputBuilder().setCustomId('role_id').setLabel('ID du rôle requis (vide = tout le monde)').setStyle(TextInputStyle.Short).setRequired(false).setValue(config.requiredRoleId || '');
      modal.addComponents(new ActionRowBuilder().addComponents(minutes), new ActionRowBuilder().addComponents(role));
      return interaction.showModal(modal);
    }

    if (id === 'sugc_thresholds') {
      const config = await getOrCreateConfig(interaction.guildId);
      const modal = new ModalBuilder().setCustomId('sugm_modal_thresholds').setTitle("📊 Seuils d'auto-résolution");
      const approve = new TextInputBuilder().setCustomId('auto_approve').setLabel('Auto-approbation (votes nets, 0 = off)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(config.autoApproveAt || 0));
      const deny = new TextInputBuilder().setCustomId('auto_deny').setLabel('Auto-refus (votes nets, 0 = off)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(config.autoDenyAt || 0));
      modal.addComponents(new ActionRowBuilder().addComponents(approve), new ActionRowBuilder().addComponents(deny));
      return interaction.showModal(modal);
    }

    // Bouton catégories → réutilise le menu persistant sugc_categories via un message éphémère
    if (id === 'sugc_categories') {
      const config = await getOrCreateConfig(interaction.guildId);
      const menu = new StringSelectMenuBuilder()
        .setCustomId('sugc_categories')
        .setPlaceholder('🏷️ Choisir les catégories actives…')
        .setMinValues(0)
        .setMaxValues(CATEGORY_KEYS.length)
        .addOptions(CATEGORY_KEYS.map(key => ({ label: CATEGORY_LABELS[key], value: key, default: (config.categoriesEnabled || []).includes(key) })));
      return interaction.reply({
        embeds: [infoEmbed('🏷️ Catégories', 'Sélectionnez les catégories que les membres pourront choisir en proposant une suggestion. Tout désélectionner = toutes actives.')],
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true,
      });
    }
  },

  // ─── Modaux anti-abus et seuils (persistants, routés par interactionCreate) ──
  async handleModal(interaction, client) {
    const id = interaction.customId;
    const guildId = interaction.guild.id;
    const config = await getOrCreateConfig(guildId);

    if (id === 'sugm_modal_cooldown') {
      if (!isMod(interaction)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Vous devez avoir la permission `Gérer le serveur`.')], ephemeral: true });
      }
      const raw = interaction.fields.getTextInputValue('minutes').trim();
      const minutes = parseInt(raw, 10);
      if (isNaN(minutes) || minutes < 0 || minutes > 10080) {
        return interaction.reply({ embeds: [errorEmbed('Valeur invalide', 'Entrez un nombre de minutes entre 0 et 10080 (7 jours).')], ephemeral: true });
      }
      let roleRaw = (interaction.fields.getTextInputValue('role_id') || '').trim();
      let roleId = null;
      if (roleRaw) {
        const m = roleRaw.match(/^<@&(\d+)>$/) || roleRaw.match(/^(\d{17,20})$/);
        if (!m) return interaction.reply({ embeds: [errorEmbed('Rôle invalide', 'Fournissez un ID de rôle (17–20 chiffres) ou une mention <@&…>.')], ephemeral: true });
        roleId = m[1];
      }
      config.cooldownMinutes = minutes;
      config.requiredRoleId = roleId;
      await config.save();
      await logAction({ client, guildId, suggestionId: 'config', action: 'config_changed', actorId: interaction.user.id, detail: `Anti-abus : cooldown ${minutes} min, rôle ${roleId ? `<@&${roleId}>` : 'aucun'}` });
      return interaction.reply({ embeds: [successEmbed('Anti-abus mis à jour', `Cooldown : **${minutes} min** · Rôle requis : ${roleId ? `<@&${roleId}>` : '*aucun*'}`)], ephemeral: true });
    }

    if (id === 'sugm_modal_thresholds') {
      if (!isMod(interaction)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Vous devez avoir la permission `Gérer le serveur`.')], ephemeral: true });
      }
      const approve = parseInt(interaction.fields.getTextInputValue('auto_approve').trim(), 10);
      const deny = parseInt(interaction.fields.getTextInputValue('auto_deny').trim(), 10);
      if (isNaN(approve) || isNaN(deny) || approve < 0 || deny < 0 || approve > 100000 || deny > 100000) {
        return interaction.reply({ embeds: [errorEmbed('Valeur invalide', 'Entrez des nombres entiers positifs (0 pour désactiver).')], ephemeral: true });
      }
      config.autoApproveAt = approve;
      config.autoDenyAt = deny;
      await config.save();
      await logAction({ client, guildId, suggestionId: 'config', action: 'config_changed', actorId: interaction.user.id, detail: `Seuils : auto-approuve ≥ +${approve}, auto-refuse ≤ -${deny}` });
      return interaction.reply({ embeds: [successEmbed('Seuils mis à jour', `Auto-approbation : **≥ +${approve}** · Auto-refus : **≤ -${deny}** votes nets.`)], ephemeral: true });
    }
  },

  // ─── Vote boutons (message public, persistant) ──────────────────────────────
  async handleVote(interaction, suggestionId, type) {
    const suggestion = await Suggestion.findById(suggestionId);
    if (!suggestion) {
      return interaction.reply({ embeds: [errorEmbed('Introuvable', "Cette suggestion n'existe plus.")], ephemeral: true });
    }
    if (suggestion.status !== 'pending') {
      return interaction.reply({ embeds: [errorEmbed('Clôturée', "Cette suggestion n'accepte plus de votes.")], ephemeral: true });
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
    await interaction.update({ embeds: [buildSuggestionEmbed(suggestion, author, config)], components: [buildVoteRow(suggestion, config), buildModRow(suggestion)] });
    return interaction.followUp({
      embeds: [successEmbed('Vote enregistré !', `Tu as ${type === 'up' ? '👍 approuvé' : '👎 refusé'} cette suggestion${result.switched ? ' (vote modifié)' : ''}.`)],
      ephemeral: true,
    });
  },
};
