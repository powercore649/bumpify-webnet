'use strict';
// commands/streamalerts.js — Alertes Twitch (live) & YouTube (nouvelles vidéos)
// Panel de configuration avancé : ajout, édition (salon/rôle/message), suppression, test.

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

const StreamAlert = require('../../models/StreamAlert');
const twitch       = require('../../utils/twitchFetcher');
const youtube       = require('../../utils/youtubeFetcher');
const { COLORS, successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const {
  renderTemplate,
  DEFAULT_TWITCH_MESSAGE,
  DEFAULT_YOUTUBE_MESSAGE,
  buildTwitchLiveEmbed,
  buildYoutubeVideoEmbed,
} = require('../../utils/streamAlertEmbeds');

const PLATFORM_LABEL = { twitch: '🟣 Twitch', youtube: '🔴 YouTube' };

// ════════════════════════════════════════════════════════════════════════════
//  EMBEDS & COMPOSANTS — Vue d'ensemble
// ════════════════════════════════════════════════════════════════════════════
function buildOverviewEmbed(guild, alerts) {
  const tw = alerts.filter((a) => a.platform === 'twitch');
  const yt = alerts.filter((a) => a.platform === 'youtube');

  const twStatus = twitch.isConfigured()  ? '🟢 API connectée' : '🔴 Non configurée (TWITCH_CLIENT_ID/SECRET)';
  const ytStatus = youtube.isConfigured() ? '🟢 API connectée' : '🔴 Non configurée (YOUTUBE_API_KEY)';

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('📡 Panel — Alertes Twitch & YouTube')
    .setDescription('Recevez une notification automatique quand un streamer passe en live ou qu\'une chaîne publie une nouvelle vidéo.')
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .addFields(
      { name: '🟣 Twitch', value: `${twStatus}\n**${tw.length}** streamer(s) suivi(s)`, inline: true },
      { name: '🔴 YouTube', value: `${ytStatus}\n**${yt.length}** chaîne(s) suivie(s)`, inline: true },
    );

  if (tw.length) {
    embed.addFields({
      name: '🟣 Streamers Twitch',
      value: tw.slice(0, 10).map((a) => `${a.isLive ? '🔴' : '⚪'} **${a.displayName || a.identifier}** → <#${a.channelId}>${a.enabled ? '' : ' *(désactivé)*'}`).join('\n') || '*Aucun*',
      inline: false,
    });
  }
  if (yt.length) {
    embed.addFields({
      name: '🔴 Chaînes YouTube',
      value: yt.slice(0, 10).map((a) => `📺 **${a.displayName || a.identifier}** → <#${a.channelId}>${a.enabled ? '' : ' *(désactivé)*'}`).join('\n') || '*Aucun*',
      inline: false,
    });
  }

  embed.setFooter({ text: 'Bumpify • Alertes Twitch/YouTube — Sélectionnez une alerte ou ajoutez-en une' }).setTimestamp();
  return embed;
}

function buildOverviewComponents(alerts) {
  const rows = [];

  if (alerts.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('sa_manage_select')
      .setPlaceholder('🛠️ Gérer une alerte existante...')
      .addOptions(
        alerts.slice(0, 25).map((a) => ({
          label: `${a.displayName || a.identifier}`.slice(0, 100),
          value: String(a._id),
          description: `${a.platform === 'twitch' ? 'Twitch' : 'YouTube'} • ${a.enabled ? 'Actif' : 'Désactivé'}`.slice(0, 100),
          emoji: a.platform === 'twitch' ? '🟣' : '🔴',
        })),
      );
    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sa_add_twitch').setLabel('Ajouter un streamer Twitch').setEmoji('🟣').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sa_add_youtube').setLabel('Ajouter une chaîne YouTube').setEmoji('🔴').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sa_refresh').setLabel('Actualiser').setEmoji('🔄').setStyle(ButtonStyle.Primary),
  ));

  return rows;
}

// ════════════════════════════════════════════════════════════════════════════
//  EMBEDS & COMPOSANTS — Gestion d'une alerte
// ════════════════════════════════════════════════════════════════════════════
function buildManageEmbed(alert) {
  const isTwitch = alert.platform === 'twitch';
  const embed = new EmbedBuilder()
    .setColor(alert.enabled ? (isTwitch ? 0x9146FF : 0xFF0000) : COLORS.warning)
    .setTitle(`${isTwitch ? '🟣' : '🔴'} ${alert.displayName || alert.identifier}`)
    .addFields(
      { name: 'Plateforme', value: PLATFORM_LABEL[alert.platform], inline: true },
      { name: 'Statut',     value: alert.enabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: isTwitch ? 'État live' : 'Dernière vidéo', value: isTwitch ? (alert.isLive ? '🔴 En live !' : '⚪ Hors-ligne') : (alert.lastVideoId ? '✅ Suivi actif' : '⏳ En attente'), inline: true },
      { name: 'Salon d\'annonce', value: alert.channelId ? `<#${alert.channelId}>` : '❌ *Non défini*', inline: true },
      { name: 'Rôle mentionné',  value: alert.roleId ? `<@&${alert.roleId}>` : '*Aucun*', inline: true },
      { name: 'Identifiant', value: `\`${alert.identifier}\``, inline: true },
      { name: 'Message personnalisé', value: alert.customMessage ? `\`\`\`${alert.customMessage.slice(0, 200)}\`\`\`` : `*Par défaut :* ${isTwitch ? DEFAULT_TWITCH_MESSAGE : DEFAULT_YOUTUBE_MESSAGE}`, inline: false },
    )
    .setFooter({ text: 'Placeholders disponibles : {streamer}/{chaine} {titre} {jeu} {lien}' });

  if (alert.avatarUrl) embed.setThumbnail(alert.avatarUrl);
  if (alert.lastError) embed.addFields({ name: '⚠️ Dernière erreur', value: alert.lastError.slice(0, 200), inline: false });

  return embed;
}

function buildManageComponents(alert) {
  return [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('sa_edit_channel')
        .setPlaceholder('📢 Changer le salon d\'annonce...')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('sa_edit_role')
        .setPlaceholder('🔔 Changer le rôle à mentionner...'),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sa_edit_msg').setLabel('Message personnalisé').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('sa_toggle').setLabel(alert.enabled ? 'Désactiver' : 'Activer').setEmoji(alert.enabled ? '⏸️' : '▶️').setStyle(alert.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('sa_test').setLabel('Tester').setEmoji('🧪').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('sa_delete').setLabel('Supprimer').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sa_back').setLabel('Retour au panel').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ════════════════════════════════════════════════════════════════════════════
//  ACTIONS PARTAGÉES (utilisées par la commande ET par les sous-commandes)
// ════════════════════════════════════════════════════════════════════════════

// ─── Ajouter un streamer Twitch en base ───────────────────────────────────────
async function addTwitchAlert({ guildId, login, channelId, roleId = null, customMessage = null, addedBy }) {
  if (!twitch.isConfigured()) {
    throw new Error('Le système Twitch n\'est pas configuré (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET manquants dans le .env).');
  }
  const users = await twitch.getUsersByLogin([login]);
  const user = users[0];
  if (!user) throw new Error(`Aucun compte Twitch trouvé pour \`${login}\`. Vérifiez l'orthographe.`);

  const alert = await StreamAlert.findOneAndUpdate(
    { guildId, platform: 'twitch', identifier: user.login.toLowerCase() },
    {
      guildId,
      platform:     'twitch',
      identifier:   user.login.toLowerCase(),
      displayName:  user.display_name,
      avatarUrl:    user.profile_image_url,
      channelId,
      roleId,
      customMessage,
      enabled:      true,
      addedBy,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return alert;
}

// ─── Ajouter une chaîne YouTube en base ───────────────────────────────────────
async function addYoutubeAlert({ guildId, input, channelId, roleId = null, customMessage = null, addedBy }) {
  if (!youtube.isConfigured()) {
    throw new Error('Le système YouTube n\'est pas configuré (YOUTUBE_API_KEY manquant dans le .env).');
  }
  const info = await youtube.resolveChannel(input);
  if (!info) throw new Error(`Chaîne YouTube introuvable pour \`${input}\`. Essayez avec l'URL complète ou l'ID (UC...).`);

  // Baseline — on récupère la dernière vidéo pour ne pas spammer l'historique
  let lastVideoId = null;
  try {
    const videos = await youtube.fetchLatestVideos(info.uploadsPlaylistId, 1);
    lastVideoId = videos[0]?.videoId || null;
  } catch (_) { /* pas grave, sera fixé au prochain check */ }

  const alert = await StreamAlert.findOneAndUpdate(
    { guildId, platform: 'youtube', identifier: info.channelId },
    {
      guildId,
      platform:          'youtube',
      identifier:         info.channelId,
      displayName:        info.title,
      avatarUrl:          info.thumbnail,
      uploadsPlaylistId:  info.uploadsPlaylistId,
      lastVideoId,
      channelId,
      roleId,
      customMessage,
      enabled: true,
      addedBy,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return alert;
}

// ─── Envoyer un post de test pour une alerte donnée ───────────────────────────
async function sendTestAlert(alert, targetChannel) {
  if (alert.platform === 'twitch') {
    let stream = null;
    try {
      const streams = await twitch.getStreamsByLogin([alert.identifier]);
      stream = streams[0] || null;
    } catch (_) {}

    const { embed, row, url } = buildTwitchLiveEmbed({
      login:        alert.identifier,
      displayName:  alert.displayName || alert.identifier,
      avatarUrl:    alert.avatarUrl,
      title:        stream?.title || 'Exemple de titre de stream',
      gameName:     stream?.game_name || 'Just Chatting',
      thumbnailUrl: stream?.thumbnail_url || null,
      viewerCount:  stream?.viewer_count ?? 0,
      startedAt:    stream?.started_at || new Date(),
    });

    const mention  = alert.roleId ? `<@&${alert.roleId}> ` : '';
    const template = alert.customMessage?.trim() || DEFAULT_TWITCH_MESSAGE;
    const content  = `🧪 **[TEST]** ${mention}` + renderTemplate(template, {
      streamer: alert.displayName || alert.identifier,
      titre:    stream?.title || 'Exemple de titre de stream',
      jeu:      stream?.game_name || 'Just Chatting',
      lien:     url,
    });

    return targetChannel.send({ content, embeds: [embed], components: [row] });
  }

  // YouTube
  const videos = await youtube.fetchLatestVideos(alert.uploadsPlaylistId, 1).catch(() => []);
  const video = videos[0] || { title: 'Exemple de vidéo', url: `https://www.youtube.com/channel/${alert.identifier}`, thumbnail: alert.avatarUrl, description: '', publishedAt: new Date() };

  const { embed, row, url } = buildYoutubeVideoEmbed({
    channelName: alert.displayName || alert.identifier,
    channelId:   alert.identifier,
    title:       video.title,
    url:         video.url,
    thumbnail:   video.thumbnail,
    description: video.description,
    publishedAt: video.publishedAt,
  });

  const mention  = alert.roleId ? `<@&${alert.roleId}> ` : '';
  const template = alert.customMessage?.trim() || DEFAULT_YOUTUBE_MESSAGE;
  const content  = `🧪 **[TEST]** ${mention}` + renderTemplate(template, {
    chaine: alert.displayName || alert.identifier,
    titre:  video.title,
    lien:   url,
  });

  return targetChannel.send({ content, embeds: [embed], components: [row] });
}

// ─── Modal : demander l'identifiant + message personnalisé ───────────────────
function buildAddModal(platform) {
  const isTwitch = platform === 'twitch';
  const modal = new ModalBuilder()
    .setCustomId(`sa_modal_add_${platform}`)
    .setTitle(isTwitch ? '🟣 Ajouter un streamer Twitch' : '🔴 Ajouter une chaîne YouTube');

  const idInput = new TextInputBuilder()
    .setCustomId('sa_identifier')
    .setLabel(isTwitch ? 'Nom d\'utilisateur Twitch' : 'Lien, @handle ou ID de la chaîne')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(isTwitch ? 'ex: aliancequatro' : 'ex: @NomDeChaine ou https://youtube.com/@NomDeChaine')
    .setRequired(true)
    .setMaxLength(150);

  const msgInput = new TextInputBuilder()
    .setCustomId('sa_custom_message')
    .setLabel('Message personnalisé (optionnel)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(`Placeholders : {${isTwitch ? 'streamer' : 'chaine'}} {titre} ${isTwitch ? '{jeu} ' : ''}{lien}`)
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(idInput),
    new ActionRowBuilder().addComponents(msgInput),
  );
  return modal;
}

// ─── Demander la sélection d'un salon (followUp éphémère + collector) ────────
async function promptChannelSelect(interaction, label = '📢 Choisissez le salon d\'annonce') {
  const row = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('sa_prompt_channel')
      .setPlaceholder(label)
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );
  const msg = await interaction.followUp({ content: `**${label}**`, components: [row], ephemeral: true });

  const picked = await msg.awaitMessageComponent({
    filter: (i) => i.user.id === interaction.user.id && i.customId === 'sa_prompt_channel',
    time: 120_000,
  }).catch(() => null);

  if (!picked) { await msg.edit({ content: '⏱️ Temps écoulé — opération annulée.', components: [] }).catch(() => {}); return null; }
  const channelId = picked.values[0];
  await picked.update({ content: `✅ Salon sélectionné : <#${channelId}>`, components: [] }).catch(() => {});
  return channelId;
}

// ─── Demander la sélection d'un rôle (optionnelle, avec bouton "Passer") ─────
async function promptRoleSelect(interaction, label = '🔔 Rôle à mentionner (optionnel)') {
  const rows = [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId('sa_prompt_role').setPlaceholder(label),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sa_prompt_role_skip').setLabel('Aucun rôle').setStyle(ButtonStyle.Secondary),
    ),
  ];
  const msg = await interaction.followUp({ content: `**${label}**`, components: rows, ephemeral: true });

  const picked = await msg.awaitMessageComponent({
    filter: (i) => i.user.id === interaction.user.id && ['sa_prompt_role', 'sa_prompt_role_skip'].includes(i.customId),
    time: 120_000,
  }).catch(() => null);

  if (!picked) { await msg.edit({ content: '⏱️ Temps écoulé — aucun rôle sélectionné.', components: [] }).catch(() => {}); return null; }

  if (picked.customId === 'sa_prompt_role_skip') {
    await picked.update({ content: '➡️ Aucun rôle sélectionné.', components: [] }).catch(() => {});
    return null;
  }
  const roleId = picked.values[0];
  await picked.update({ content: `✅ Rôle sélectionné : <@&${roleId}>`, components: [] }).catch(() => {});
  return roleId;
}

// ─── Flux complet d'ajout via boutons du panel (modal → salon → rôle) ────────
async function runAddFlow(interaction, platform) {
  const modal = buildAddModal(platform);
  await interaction.showModal(modal);

  const modalSubmit = await interaction.awaitModalSubmit({
    filter: (m) => m.customId === `sa_modal_add_${platform}` && m.user.id === interaction.user.id,
    time: 180_000,
  }).catch(() => null);
  if (!modalSubmit) return null;

  const identifier    = modalSubmit.fields.getTextInputValue('sa_identifier').trim();
  const customMessage = modalSubmit.fields.getTextInputValue('sa_custom_message')?.trim() || null;

  await modalSubmit.deferReply({ ephemeral: true });
  await modalSubmit.editReply({ content: `🔎 Vérification de \`${identifier}\`...` });

  const channelId = await promptChannelSelect(modalSubmit);
  if (!channelId) return null;
  const roleId = await promptRoleSelect(modalSubmit);

  try {
    const alert = platform === 'twitch'
      ? await addTwitchAlert({ guildId: interaction.guild.id, login: identifier, channelId, roleId, customMessage, addedBy: interaction.user.id })
      : await addYoutubeAlert({ guildId: interaction.guild.id, input: identifier, channelId, roleId, customMessage, addedBy: interaction.user.id });

    await modalSubmit.followUp({
      embeds: [successEmbed(
        'Alerte configurée !',
        `${PLATFORM_LABEL[platform]} — **${alert.displayName || alert.identifier}**\nSalon : <#${channelId}>${roleId ? `\nRôle : <@&${roleId}>` : ''}`,
      )],
      ephemeral: true,
    });
    return alert;
  } catch (err) {
    await modalSubmit.followUp({ embeds: [errorEmbed('Erreur', err.message)], ephemeral: true });
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  COMMANDE
// ════════════════════════════════════════════════════════════════════════════
module.exports = {
  data: new SlashCommandBuilder()
    .setName('streamalerts')
    .setDescription('📡 Alertes Twitch (live) & YouTube (nouvelles vidéos)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s
      .setName('panel')
      .setDescription('⚙️ Ouvrir le panel de configuration avancé'))
    .addSubcommand((s) => s
      .setName('ajouter-twitch')
      .setDescription('🟣 Ajouter un streamer Twitch à surveiller')
      .addStringOption((o) => o.setName('pseudo').setDescription('Nom d\'utilisateur Twitch').setRequired(true))
      .addChannelOption((o) => o.setName('salon').setDescription('Salon où poster l\'alerte').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Rôle à mentionner (optionnel)').setRequired(false)))
    .addSubcommand((s) => s
      .setName('ajouter-youtube')
      .setDescription('🔴 Ajouter une chaîne YouTube à surveiller')
      .addStringOption((o) => o.setName('chaine').setDescription('URL, @handle ou ID de la chaîne').setRequired(true))
      .addChannelOption((o) => o.setName('salon').setDescription('Salon où poster l\'alerte').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Rôle à mentionner (optionnel)').setRequired(false)))
    .addSubcommand((s) => s
      .setName('liste')
      .setDescription('📋 Lister les alertes configurées'))
    .addSubcommand((s) => s
      .setName('supprimer')
      .setDescription('🗑️ Supprimer une alerte')
      .addStringOption((o) => o
        .setName('plateforme')
        .setDescription('Plateforme')
        .setRequired(true)
        .addChoices({ name: '🟣 Twitch', value: 'twitch' }, { name: '🔴 YouTube', value: 'youtube' }))
      .addStringOption((o) => o.setName('identifiant').setDescription('Pseudo Twitch ou ID/handle YouTube').setRequired(true))),

  addTwitchAlert,
  addYoutubeAlert,
  sendTestAlert,

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    // ── /streamalerts liste ─────────────────────────────────────────────────
    if (sub === 'liste') {
      await interaction.deferReply({ ephemeral: true });
      const alerts = await StreamAlert.find({ guildId: interaction.guild.id }).sort({ platform: 1, createdAt: 1 });
      if (!alerts.length) {
        return interaction.editReply({ embeds: [infoEmbed('Aucune alerte', 'Utilisez `/streamalerts panel` pour en ajouter une.')] });
      }
      return interaction.editReply({ embeds: [buildOverviewEmbed(interaction.guild, alerts)] });
    }

    // ── /streamalerts ajouter-twitch ────────────────────────────────────────
    if (sub === 'ajouter-twitch') {
      await interaction.deferReply({ ephemeral: true });
      const login   = interaction.options.getString('pseudo');
      const channel = interaction.options.getChannel('salon');
      const role    = interaction.options.getRole('role');
      try {
        const alert = await addTwitchAlert({ guildId: interaction.guild.id, login, channelId: channel.id, roleId: role?.id || null, addedBy: interaction.user.id });
        return interaction.editReply({ embeds: [successEmbed('Streamer ajouté !', `🟣 **${alert.displayName}** sera annoncé dans <#${channel.id}>.`)] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed('Erreur', err.message)] });
      }
    }

    // ── /streamalerts ajouter-youtube ───────────────────────────────────────
    if (sub === 'ajouter-youtube') {
      await interaction.deferReply({ ephemeral: true });
      const input   = interaction.options.getString('chaine');
      const channel = interaction.options.getChannel('salon');
      const role    = interaction.options.getRole('role');
      try {
        const alert = await addYoutubeAlert({ guildId: interaction.guild.id, input, channelId: channel.id, roleId: role?.id || null, addedBy: interaction.user.id });
        return interaction.editReply({ embeds: [successEmbed('Chaîne ajoutée !', `🔴 **${alert.displayName}** sera annoncée dans <#${channel.id}>.`)] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed('Erreur', err.message)] });
      }
    }

    // ── /streamalerts supprimer ─────────────────────────────────────────────
    if (sub === 'supprimer') {
      await interaction.deferReply({ ephemeral: true });
      const platform   = interaction.options.getString('plateforme');
      const identifier = interaction.options.getString('identifiant').trim().toLowerCase().replace(/^@/, '');
      const result = await StreamAlert.findOneAndDelete({ guildId: interaction.guild.id, platform, identifier });
      if (!result) {
        return interaction.editReply({ embeds: [errorEmbed('Introuvable', 'Aucune alerte correspondante. Utilisez `/streamalerts liste` pour voir les identifiants exacts.')] });
      }
      return interaction.editReply({ embeds: [successEmbed('Alerte supprimée', `${PLATFORM_LABEL[platform]} — **${result.displayName || result.identifier}**`)] });
    }

    // ── /streamalerts panel ─────────────────────────────────────────────────
    if (sub === 'panel') {
      await interaction.deferReply({ ephemeral: true });

      let alerts = await StreamAlert.find({ guildId: interaction.guild.id }).sort({ platform: 1, createdAt: 1 });

      const reply = await interaction.editReply({
        embeds:     [buildOverviewEmbed(interaction.guild, alerts)],
        components: buildOverviewComponents(alerts),
      });

      let screen  = 'overview';
      let current = null; // alerte actuellement gérée

      const col = reply.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id,
        time:   15 * 60 * 1000,
      });

      col.on('collect', async (i) => {
        try {
          const id = i.customId;

          // ── Retour au panel principal ─────────────────────────────────
          if (id === 'sa_back' || id === 'sa_refresh') {
            alerts = await StreamAlert.find({ guildId: interaction.guild.id }).sort({ platform: 1, createdAt: 1 });
            screen = 'overview';
            return i.update({ embeds: [buildOverviewEmbed(interaction.guild, alerts)], components: buildOverviewComponents(alerts) });
          }

          // ── Sélection d'une alerte à gérer ────────────────────────────
          if (id === 'sa_manage_select') {
            current = await StreamAlert.findById(i.values[0]);
            if (!current) return i.reply({ embeds: [errorEmbed('Introuvable', 'Cette alerte a été supprimée.')], ephemeral: true });
            screen = 'manage';
            return i.update({ embeds: [buildManageEmbed(current)], components: buildManageComponents(current) });
          }

          // ── Ajouter Twitch / YouTube (modal + salon + rôle) ───────────
          if (id === 'sa_add_twitch' || id === 'sa_add_youtube') {
            const platform = id === 'sa_add_twitch' ? 'twitch' : 'youtube';
            await runAddFlow(i, platform);
            alerts = await StreamAlert.find({ guildId: interaction.guild.id }).sort({ platform: 1, createdAt: 1 });
            return interaction.editReply({ embeds: [buildOverviewEmbed(interaction.guild, alerts)], components: buildOverviewComponents(alerts) }).catch(() => {});
          }

          // ── Écrans "gestion d'une alerte" — nécessitent `current` ─────
          if (!current && ['sa_edit_channel', 'sa_edit_role', 'sa_edit_msg', 'sa_toggle', 'sa_test', 'sa_delete'].includes(id)) {
            return i.reply({ embeds: [errorEmbed('Session expirée', 'Réouvrez le panel avec `/streamalerts panel`.')], ephemeral: true });
          }

          if (id === 'sa_edit_channel') {
            current = await StreamAlert.findByIdAndUpdate(current._id, { channelId: i.values[0] }, { new: true });
            return i.update({ embeds: [buildManageEmbed(current)], components: buildManageComponents(current) });
          }

          if (id === 'sa_edit_role') {
            current = await StreamAlert.findByIdAndUpdate(current._id, { roleId: i.values[0] }, { new: true });
            return i.update({ embeds: [buildManageEmbed(current)], components: buildManageComponents(current) });
          }

          if (id === 'sa_toggle') {
            current = await StreamAlert.findByIdAndUpdate(current._id, { enabled: !current.enabled }, { new: true });
            return i.update({ embeds: [buildManageEmbed(current)], components: buildManageComponents(current) });
          }

          if (id === 'sa_delete') {
            await StreamAlert.findByIdAndDelete(current._id);
            const deletedName = current.displayName || current.identifier;
            current = null;
            alerts = await StreamAlert.find({ guildId: interaction.guild.id }).sort({ platform: 1, createdAt: 1 });
            screen = 'overview';
            await i.update({ embeds: [buildOverviewEmbed(interaction.guild, alerts)], components: buildOverviewComponents(alerts) });
            return i.followUp({ embeds: [successEmbed('Alerte supprimée', deletedName)], ephemeral: true }).catch(() => {});
          }

          if (id === 'sa_test') {
            await i.deferReply({ ephemeral: true });
            const guild = interaction.guild;
            const channel = guild.channels.cache.get(current.channelId);
            if (!channel?.isTextBased()) {
              return i.editReply({ embeds: [errorEmbed('Erreur', 'Le salon configuré est introuvable ou inaccessible.')] });
            }
            try {
              await sendTestAlert(current, channel);
              return i.editReply({ embeds: [successEmbed('Test envoyé !', `Un message de test a été posté dans <#${current.channelId}>.`)] });
            } catch (err) {
              return i.editReply({ embeds: [errorEmbed('Erreur lors du test', err.message)] });
            }
          }

          if (id === 'sa_edit_msg') {
            const modal = new ModalBuilder().setCustomId('sa_modal_edit_msg').setTitle('✏️ Message personnalisé');
            const isTwitch = current.platform === 'twitch';
            const input = new TextInputBuilder()
              .setCustomId('sa_msg_value')
              .setLabel('Message (laisser vide = réinitialiser)')
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder(`Placeholders : {${isTwitch ? 'streamer' : 'chaine'}} {titre} ${isTwitch ? '{jeu} ' : ''}{lien}`)
              .setRequired(false)
              .setMaxLength(500)
              .setValue(current.customMessage || '');
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await i.showModal(modal);

            const modalSubmit = await i.awaitModalSubmit({
              filter: (m) => m.customId === 'sa_modal_edit_msg' && m.user.id === interaction.user.id,
              time: 180_000,
            }).catch(() => null);
            if (!modalSubmit) return;

            const value = modalSubmit.fields.getTextInputValue('sa_msg_value')?.trim() || null;
            current = await StreamAlert.findByIdAndUpdate(current._id, { customMessage: value }, { new: true });
            return modalSubmit.update({ embeds: [buildManageEmbed(current)], components: buildManageComponents(current) });
          }
        } catch (err) {
          console.error('[StreamAlerts] panel:', err);
          const errPayload = { embeds: [errorEmbed('Erreur', 'Une erreur est survenue. Réessayez.')], ephemeral: true };
          if (i.deferred || i.replied) await i.followUp(errPayload).catch(() => {});
          else await i.reply(errPayload).catch(() => {});
        }
      });

      col.on('end', () => {
        interaction.editReply({ components: [] }).catch(() => {});
      });
      return;
    }
  },
};
