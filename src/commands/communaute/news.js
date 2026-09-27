'use strict';
// commands/news.js — Système d'actualités RSS français — Bumpify v4

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  PermissionFlagsBits, ChannelType,
} = require('discord.js');

const { NewsConfig, NewsPosted } = require('../../models/News');
const { SOURCES, fetchSource, fetchAllNews, hashLink } = require('../../utils/newsFetcher');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');

// ─── Labels des catégories ────────────────────────────────────────────────────
const CATEGORIES = {
  general:  { label: 'Actualités générales', emoji: '🌍', color: 0x1A1A1A },
  gaming:   { label: 'Jeux Vidéo',           emoji: '🎮', color: 0xE8000D },
  tech:     { label: 'Tech & Numérique',     emoji: '💻', color: 0x0066CC },
  esport:   { label: 'Esport',               emoji: '🏆', color: 0xFFD700 },
};

// ─── Helper config ─────────────────────────────────────────────────────────────
async function getConfig(guildId) {
  return NewsConfig.findOneAndUpdate(
    { guildId },
    { $setOnInsert: { guildId } },
    { upsert: true, new: true }
  );
}

// ─── Construire l'embed d'un article ──────────────────────────────────────────
function buildArticleEmbed(article, config) {
  const embed = new EmbedBuilder()
    .setColor(article.color || COLORS.primary)
    .setAuthor({
      name:    `${article.emoji} ${article.source}`,
      iconURL: article.icon || null,
      url:     article.link || null,
    })
    .setTitle(article.title.slice(0, 256))
    .setURL(article.link || null)
    .setTimestamp(article.date instanceof Date && !isNaN(article.date) ? article.date : new Date());

  if (article.desc) embed.setDescription(article.desc);

  if (config?.showThumbnail && article.image) {
    embed.setThumbnail(article.image);
  }

  const cat = CATEGORIES[article.category] || CATEGORIES.general;
  embed.addFields(
    { name: '📂 Catégorie', value: `${cat.emoji} ${cat.label}`, inline: true },
    { name: '📅 Publié',    value: `<t:${Math.floor((article.date instanceof Date && !isNaN(article.date) ? article.date : new Date()).getTime() / 1000)}:R>`, inline: true },
  );

  const footer = config?.footerText || 'Bumpify v4 • Actualités';
  embed.setFooter({ text: footer });

  return embed;
}

// ─── Embed de configuration ────────────────────────────────────────────────────
function buildConfigEmbed(config, guild) {
  const ok = v => v ? '🟢' : '🔴';
  const ch = config.channels || {};
  const rl = config.roles    || {};
  const sr = config.sources  || {};

  const channelLines = [
    `🌍 Général : ${ch.general   ? `<#${ch.general}>`   : '*Non défini*'}`,
    `🎮 Gaming  : ${ch.gaming    ? `<#${ch.gaming}>`    : '*Non défini*'}`,
    `💻 Tech    : ${ch.tech      ? `<#${ch.tech}>`      : '*Non défini*'}`,
    `🏆 Esport  : ${ch.esport    ? `<#${ch.esport}>`    : '*Non défini*'}`,
    `📡 Défaut  : ${ch.default   ? `<#${ch.default}>`   : '*Non défini*'}`,
  ].join('\n');

  const sourceLines = Object.entries(SOURCES).map(([key, src]) =>
    `${sr[key] !== false ? '🟢' : '🔴'} ${src.emoji} **${src.name}** *(${src.category})*`
  ).join('\n');

  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('📰 Configuration — Actualités')
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .addFields(
      { name: 'Statut',             value: config.enabled ? '🟢 Activé' : '🔴 Désactivé',          inline: true },
      { name: 'Vérification',       value: `Toutes les **${config.interval || 30} min**`,            inline: true },
      { name: 'Thumbnails',         value: config.showThumbnail ? '🟢 Oui' : '🔴 Non',              inline: true },
      { name: '📢 Salons',          value: channelLines,                                             inline: false },
      { name: '📡 Sources actives', value: sourceLines,                                              inline: false },
    )
    .setFooter({ text: 'Bumpify v4 • News' })
    .setTimestamp();
}

// ─── Menu de configuration ─────────────────────────────────────────────────────
function buildConfigMenu(config) {
  const sr = config.sources || {};
  const options = [
    { label: config.enabled ? '🔴 Désactiver les news' : '🟢 Activer les news', value: 'toggle',     description: 'Activer/désactiver le système' },
    { label: config.showThumbnail ? '🖼️ Masquer thumbnails' : '🖼️ Afficher thumbnails', value: 'toggle_thumb', description: 'Images dans les embeds' },
    ...Object.entries(SOURCES).map(([key, src]) => ({
      label:       `${sr[key] !== false ? '🔴 Désactiver' : '🟢 Activer'} ${src.name}`,
      value:       `toggle_src_${key}`,
      description: `Source : ${src.category}`,
    })),
  ];

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('news_config_action')
      .setPlaceholder('⚙️ Configurer...')
      .addOptions(options.slice(0, 25))
  );
}

// ─── Poster les articles dans le bon salon ─────────────────────────────────────
async function postArticles(client, guildId, articles, config) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return 0;

  const ch = config.channels || {};
  const rl = config.roles    || {};
  let posted = 0;

  for (const article of articles) {
    try {
      // Vérifier si déjà posté
      const exists = await NewsPosted.findOne({ guildId, articleId: article.id });
      if (exists) continue;

      // Trouver le bon salon
      const channelId = ch[article.category] || ch.default;
      if (!channelId) continue;

      const channel = guild.channels.cache.get(channelId);
      if (!channel?.isTextBased()) continue;

      const perms = channel.permissionsFor(guild.members.me);
      if (!perms?.has(['SendMessages', 'EmbedLinks'])) continue;

      const embed   = buildArticleEmbed(article, config);
      const roleId  = rl[article.category] || rl.default;
      const mention = roleId ? `<@&${roleId}>` : null;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🔗 Lire l\'article')
          .setStyle(ButtonStyle.Link)
          .setURL(article.link || 'https://www.google.fr')
      );

      await channel.send({
        content:    mention || undefined,
        embeds:     [embed],
        components: [row],
      });

      // Marquer comme posté
      await NewsPosted.create({ guildId, articleId: article.id, source: article.sourceKey });

      posted++;
      // Rate limit protection
      await new Promise(r => setTimeout(r, 800));
    } catch (err) {
      console.error(`[News] Post article ${article.id}:`, err.message);
    }
  }

  return posted;
}

// ─── Auto-post pour tous les serveurs ─────────────────────────────────────────
async function autoPostNews(client) {
  try {
    const configs = await NewsConfig.find({ enabled: true });
    let total = 0;

    for (const config of configs) {
      try {
        // Vérifier l'intervalle
        if (config.lastCheck) {
          const elapsed = Date.now() - new Date(config.lastCheck).getTime();
          if (elapsed < (config.interval || 30) * 60 * 1000) continue;
        }

        // Mettre à jour lastCheck
        await NewsConfig.updateOne({ guildId: config.guildId }, { lastCheck: new Date() });

        // Récupérer les articles
        const articles = await fetchAllNews(config.sources || {});
        if (!articles.length) continue;

        // Poster
        const count = await postArticles(client, config.guildId, articles, config);
        if (count > 0) {
          console.log(`📰 [News] ${count} article(s) posté(s) → ${config.guildId}`);
          total += count;
        }
      } catch (err) {
        console.error(`[News] Guild ${config.guildId}:`, err.message);
      }
    }

    return total;
  } catch (err) {
    console.error('[News] autoPostNews:', err.message);
    return 0;
  }
}

// ─── Commande slash ───────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('news')
    .setDescription('📰 Système d\'actualités françaises automatiques')
    .addSubcommand(s => s
      .setName('config')
      .setDescription('⚙️ Configurer le système de news'))
    .addSubcommand(s => s
      .setName('activer')
      .setDescription('🟢 Activer les actualités'))
    .addSubcommand(s => s
      .setName('desactiver')
      .setDescription('🔴 Désactiver les actualités'))
    .addSubcommand(s => s
      .setName('tester')
      .setDescription('🧪 Tester en postant les dernières actualités maintenant'))
    .addSubcommand(s => s
      .setName('dernieres')
      .setDescription('📋 Voir les dernières actualités disponibles')
      .addStringOption(o => o
        .setName('source')
        .setDescription('Source à consulter')
        .addChoices(...Object.entries(SOURCES).map(([k, s]) => ({ name: `${s.emoji} ${s.name}`, value: k })))
      )),

  autoPostNews,

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    // ── Guard permission ─────────────────────────────────────────────────
    if (['config','activer','desactiver','tester'].includes(sub)) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Vous avez besoin de **Gérer le serveur**.')], ephemeral: true });
      }
    }

    const guild = interaction.guild;

    // ── /news dernieres ───────────────────────────────────────────────────
    if (sub === 'dernieres') {
      await interaction.deferReply({ ephemeral: true });
      const sourceKey = interaction.options.getString('source');
      const articles  = sourceKey
        ? await fetchSource(sourceKey)
        : await fetchAllNews();

      if (!articles.length) {
        return interaction.editReply({ embeds: [errorEmbed('Aucun article', 'Impossible de récupérer les actualités. Réessayez.')] });
      }

      const config  = await getConfig(guild.id);
      let page      = 0;
      const total   = Math.min(articles.length, 10);

      const navRow = () => new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('news_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('news_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= total - 1),
        new ButtonBuilder().setLabel('🔗 Lire').setStyle(ButtonStyle.Link).setURL(articles[page].link || 'https://www.google.fr'),
      );

      const reply = await interaction.editReply({
        embeds:     [buildArticleEmbed(articles[0], config)],
        components: [navRow()],
        fetchReply: true,
      });

      const col = reply.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id && ['news_prev','news_next'].includes(i.customId),
        time: 3 * 60 * 1000,
      });

      col.on('collect', async i => {
        if (i.customId === 'news_prev') page = Math.max(0, page - 1);
        else page = Math.min(total - 1, page + 1);
        await i.update({ embeds: [buildArticleEmbed(articles[page], config)], components: [navRow()] });
      });
      col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
      return;
    }

    // ── /news activer ─────────────────────────────────────────────────────
    if (sub === 'activer') {
      await interaction.deferReply({ ephemeral: true });
      const config = await getConfig(guild.id);
      const hasChannel = Object.values(config.channels || {}).some(Boolean);
      if (!hasChannel) {
        return interaction.editReply({ embeds: [errorEmbed('Configuration incomplète', 'Définissez au moins un salon via `/news config` avant d\'activer.')] });
      }
      await NewsConfig.updateOne({ guildId: guild.id }, { enabled: true });
      return interaction.editReply({ embeds: [successEmbed('✅ Actualités activées !', `Les news seront postées automatiquement toutes les **${config.interval} minutes**.`)] });
    }

    // ── /news desactiver ──────────────────────────────────────────────────
    if (sub === 'desactiver') {
      await interaction.deferReply({ ephemeral: true });
      await NewsConfig.updateOne({ guildId: guild.id }, { enabled: false });
      return interaction.editReply({ embeds: [successEmbed('🔴 Actualités désactivées', 'Les posts automatiques sont suspendus.')] });
    }

    // ── /news tester ──────────────────────────────────────────────────────
    if (sub === 'tester') {
      await interaction.deferReply({ ephemeral: true });
      const config = await getConfig(guild.id);
      const hasChannel = Object.values(config.channels || {}).some(Boolean);
      if (!hasChannel) {
        return interaction.editReply({ embeds: [errorEmbed('Aucun salon configuré', 'Configurez d\'abord via `/news config`.')] });
      }

      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('🔄 Récupération en cours...').setDescription('Téléchargement des dernières actualités...')] });

      // Reset lastCheck pour forcer le post
      await NewsConfig.updateOne({ guildId: guild.id }, { lastCheck: null });

      const articles = await fetchAllNews(config.sources || {});
      if (!articles.length) {
        return interaction.editReply({ embeds: [errorEmbed('Aucun article', 'Impossible de récupérer les articles. Vérifiez votre connexion.')] });
      }

      const count = await postArticles(client, guild.id, articles, config);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(count > 0 ? COLORS.success : COLORS.warning)
          .setTitle(count > 0 ? `✅ ${count} article(s) posté(s) !` : '⚠️ Aucun nouvel article')
          .setDescription(count > 0
            ? `Les actualités ont été postées dans les salons configurés.`
            : `Tous les articles récents ont déjà été postés. (Anti-doublon actif)`)
          .setTimestamp()],
      });
    }

    // ── /news config ──────────────────────────────────────────────────────
    if (sub === 'config') {
      await interaction.deferReply({ ephemeral: true });
      let config = await getConfig(guild.id);

      const buildComponents = () => [
        buildConfigMenu(config),
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('news_ch_general')
            .setPlaceholder('🌍 Salon — Actualités générales')
            .setChannelTypes(ChannelType.GuildText)
        ),
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('news_ch_gaming')
            .setPlaceholder('🎮 Salon — Jeux Vidéo')
            .setChannelTypes(ChannelType.GuildText)
        ),
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('news_ch_tech')
            .setPlaceholder('💻 Salon — Tech')
            .setChannelTypes(ChannelType.GuildText)
        ),
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('news_ch_default')
            .setPlaceholder('📡 Salon par défaut (toutes catégories)')
            .setChannelTypes(ChannelType.GuildText)
        ),
      ];

      const reply = await interaction.editReply({
        embeds:     [buildConfigEmbed(config, guild)],
        components: buildComponents(),
        fetchReply: true,
      });

      const col = reply.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time:   10 * 60 * 1000,
      });

      col.on('collect', async i => {
        await i.deferUpdate();
        const cid = i.customId;
        const update = {};

        // Salons
        if (cid === 'news_ch_general') update['channels.general'] = i.values[0];
        if (cid === 'news_ch_gaming')  update['channels.gaming']  = i.values[0];
        if (cid === 'news_ch_tech')    update['channels.tech']    = i.values[0];
        if (cid === 'news_ch_default') update['channels.default'] = i.values[0];

        // Actions menu
        if (cid === 'news_config_action') {
          const action = i.values[0];
          if (action === 'toggle')       update.enabled      = !config.enabled;
          if (action === 'toggle_thumb') update.showThumbnail = !config.showThumbnail;
          if (action.startsWith('toggle_src_')) {
            const key = action.replace('toggle_src_', '');
            update[`sources.${key}`] = config.sources?.[key] === false ? true : false;
          }
        }

        if (Object.keys(update).length) {
          await NewsConfig.updateOne({ guildId: guild.id }, { $set: update });
          config = await getConfig(guild.id);
        }

        await i.editReply({ embeds: [buildConfigEmbed(config, guild)], components: buildComponents() });
      });

      col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
      return;
    }
  },
};
