// commands/reddit-annonce.js — Annonces Reddit automatiques, panel avancé
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, ChannelType,
} = require('discord.js');
const RedditWatch = require('../../models/RedditWatch');
const { checkSubredditExists, checkAndPost } = require('../../utils/redditWatcher');
const { errorEmbed } = require('../../utils/embeds');

const SORT_LABELS = { new: '🆕 Nouveaux', hot: '🔥 Tendances', top: '🏆 Top' };

function sanitizeSubreddit(raw) {
  return (raw || '').trim().replace(/^\/?r\//i, '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

// ─── Vue d'ensemble : liste des subreddits suivis sur ce serveur ─────────────
async function buildOverviewEmbed(guild) {
  const watches = await RedditWatch.find({ guildId: guild.id }).sort({ subreddit: 1 });

  const lines = watches.length
    ? watches.map(w => `${w.enabled ? '🟢' : '🔴'} **r/${w.subreddit}** — ${w.channelId ? `<#${w.channelId}>` : '*aucun salon*'} · ${SORT_LABELS[w.sort]} · ${w.totalPosted} posté(s)`).join('\n')
    : '*Aucun subreddit suivi pour l\'instant.*';

  return new EmbedBuilder()
    .setColor(0xFF4500)
    .setTitle('🟠 Annonces Reddit')
    .setDescription('Publie automatiquement les nouveaux posts d\'un ou plusieurs subreddits dans les salons de ton choix, avec filtres avancés.\n\n' + lines)
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .setFooter({ text: `Bumpify • ${watches.length} subreddit(s) suivi(s)` });
}

function buildOverviewComponents(watches) {
  const rows = [];

  if (watches.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('rd_select')
        .setPlaceholder('⚙️ Configurer un subreddit suivi...')
        .addOptions(watches.slice(0, 25).map(w => ({
          label: `r/${w.subreddit}`, value: w.subreddit,
          description: `${w.enabled ? 'Activé' : 'Désactivé'} · ${SORT_LABELS[w.sort]}`,
          emoji: w.enabled ? '🟢' : '🔴',
        }))),
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rd_add').setLabel('➕ Ajouter un subreddit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rd_close').setLabel('✖ Fermer').setStyle(ButtonStyle.Secondary),
  ));

  return rows;
}

// ─── Vue détaillée d'UN subreddit suivi ───────────────────────────────────────
function buildDetailEmbed(cfg, guild) {
  return new EmbedBuilder()
    .setColor(0xFF4500)
    .setTitle(`🟠 r/${cfg.subreddit}`)
    .addFields(
      { name: '📢 Statut', value: cfg.enabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: '📍 Salon', value: cfg.channelId ? `<#${cfg.channelId}>` : '*Non défini*', inline: true },
      { name: '🔔 Rôle ping', value: cfg.roleId ? `<@&${cfg.roleId}>` : '*Aucun*', inline: true },
      { name: '🔀 Tri', value: SORT_LABELS[cfg.sort], inline: true },
      { name: '👍 Upvotes min.', value: `${cfg.minUpvotes}`, inline: true },
      { name: '🔞 NSFW', value: cfg.nsfwAllowed ? '✅ Autorisé' : '❌ Bloqué', inline: true },
      { name: '🖼️ Médias uniquement', value: cfg.mediaOnly ? '✅ Oui' : '❌ Non', inline: true },
      { name: '💫 Total publié', value: `${cfg.totalPosted}`, inline: true },
      { name: '✅ Mots-clés inclus', value: cfg.includeKeywords.length ? cfg.includeKeywords.join(', ') : '*Aucun*', inline: false },
      { name: '🚫 Mots-clés exclus', value: cfg.excludeKeywords.length ? cfg.excludeKeywords.join(', ') : '*Aucun*', inline: false },
      { name: '🚫 Flairs exclus', value: cfg.excludeFlairs.length ? cfg.excludeFlairs.join(', ') : '*Aucun*', inline: false },
    )
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .setFooter({ text: 'Bumpify • Annonces Reddit' })
    .setTimestamp();
}

function buildDetailComponents(cfg) {
  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('rd_select_channel')
      .setPlaceholder('📍 Choisir le salon d\'annonce...')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('rd_select_role')
      .setPlaceholder('🔔 Rôle à ping (optionnel)...')
      .setMinValues(0)
      .setMaxValues(1),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('rd_select_sort')
      .setPlaceholder(`Tri actuel : ${SORT_LABELS[cfg.sort]}`)
      .addOptions(
        { label: 'Nouveaux', value: 'new', emoji: '🆕', default: cfg.sort === 'new' },
        { label: 'Tendances', value: 'hot', emoji: '🔥', default: cfg.sort === 'hot' },
        { label: 'Top', value: 'top', emoji: '🏆', default: cfg.sort === 'top' },
      ),
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rd_toggle_enabled').setLabel(cfg.enabled ? '🔴 Désactiver' : '🟢 Activer').setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rd_toggle_nsfw').setLabel('🔞 NSFW').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rd_toggle_media').setLabel('🖼️ Médias only').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rd_test').setLabel('📤 Tester maintenant').setStyle(ButtonStyle.Primary),
  );

  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rd_filters').setLabel('⚙️ Filtres avancés').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rd_delete').setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('rd_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3, row4, row5];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reddit-annonce')
    .setDescription('🟠 Panel des annonces Reddit automatiques')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const watches = await RedditWatch.find({ guildId: interaction.guild.id }).sort({ subreddit: 1 });

    const goHome = async i => {
      const w = await RedditWatch.find({ guildId: interaction.guild.id }).sort({ subreddit: 1 });
      await i.update({ embeds: [await buildOverviewEmbed(interaction.guild)], components: buildOverviewComponents(w) });
    };

    const goDetail = async (i, subreddit) => {
      const cfg = await RedditWatch.findOne({ guildId: interaction.guild.id, subreddit });
      if (!cfg) return goHome(i);
      await i.update({ embeds: [buildDetailEmbed(cfg, interaction.guild)], components: buildDetailComponents(cfg) });
    };

    const reply = await interaction.reply({
      embeds: [await buildOverviewEmbed(interaction.guild)],
      components: buildOverviewComponents(watches),
      ephemeral: true,
      fetchReply: true,
    });

    const col = reply.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time: 15 * 60 * 1000,
    });

    col.on('collect', async i => {
      try {
        if (i.customId === 'rd_close') return i.update({ components: [] });
        if (i.customId === 'rd_back') return goHome(i);

        if (i.customId === 'rd_select') return goDetail(i, i.values[0]);

        // ── Ajouter un subreddit ────────────────────────────────────────
        if (i.customId === 'rd_add') {
          const modal = new ModalBuilder().setCustomId('rd_modal_add').setTitle('➕ Ajouter un subreddit');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rd_subreddit').setLabel('Nom du subreddit (sans r/)').setStyle(TextInputStyle.Short).setMaxLength(21).setRequired(true).setPlaceholder('ex: france'),
          ));
          return i.showModal(modal);
        }

        // À partir d'ici, on a besoin du subreddit actuellement affiché
        const currentSub = i.message.embeds[0]?.title?.replace(/^🟠 r\//, '');
        const cfg = currentSub ? await RedditWatch.findOne({ guildId: interaction.guild.id, subreddit: currentSub }) : null;
        if (!cfg) return;

        if (i.customId === 'rd_select_channel') {
          cfg.channelId = i.values[0];
          await cfg.save();
          return goDetail(i, cfg.subreddit);
        }
        if (i.customId === 'rd_select_role') {
          cfg.roleId = i.values[0] || null;
          await cfg.save();
          return goDetail(i, cfg.subreddit);
        }
        if (i.customId === 'rd_select_sort') {
          cfg.sort = i.values[0];
          await cfg.save();
          return goDetail(i, cfg.subreddit);
        }
        if (i.customId === 'rd_toggle_enabled') {
          if (!cfg.channelId && !cfg.enabled) {
            return i.reply({ embeds: [errorEmbed('Salon requis', 'Choisis un salon avant d\'activer ce suivi.')], ephemeral: true });
          }
          cfg.enabled = !cfg.enabled;
          await cfg.save();
          return goDetail(i, cfg.subreddit);
        }
        if (i.customId === 'rd_toggle_nsfw') {
          cfg.nsfwAllowed = !cfg.nsfwAllowed;
          await cfg.save();
          return goDetail(i, cfg.subreddit);
        }
        if (i.customId === 'rd_toggle_media') {
          cfg.mediaOnly = !cfg.mediaOnly;
          await cfg.save();
          return goDetail(i, cfg.subreddit);
        }
        if (i.customId === 'rd_delete') {
          await RedditWatch.deleteOne({ _id: cfg._id });
          return goHome(i);
        }
        if (i.customId === 'rd_test') {
          if (!cfg.channelId) {
            return i.reply({ embeds: [errorEmbed('Salon requis', 'Choisis un salon avant de tester.')], ephemeral: true });
          }
          await i.deferUpdate();
          const wasEnabled = cfg.enabled;
          cfg.enabled = true; // le test doit fonctionner même si pas encore activé en continu
          await cfg.save();
          const posted = await checkAndPost(interaction.client, cfg);
          if (!wasEnabled) { cfg.enabled = false; await cfg.save(); }
          await interaction.followUp({
            content: posted > 0
              ? `✅ ${posted} post(s) publié(s) dans <#${cfg.channelId}> pour tester.`
              : 'ℹ️ Aucun nouveau post à publier pour l\'instant (rien de récent ne passe les filtres).',
            ephemeral: true,
          }).catch(() => {});
          return goDetail(i, cfg.subreddit);
        }
        if (i.customId === 'rd_filters') {
          const modal = new ModalBuilder().setCustomId(`rd_modal_filters:${cfg.subreddit}`).setTitle(`Filtres — r/${cfg.subreddit}`);
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rd_min_upvotes').setLabel('Upvotes minimum').setStyle(TextInputStyle.Short).setValue(String(cfg.minUpvotes)).setMaxLength(6).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rd_include_kw').setLabel('Mots-clés inclus (virgules)').setStyle(TextInputStyle.Short).setValue(cfg.includeKeywords.join(', ')).setMaxLength(200).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rd_exclude_kw').setLabel('Mots-clés exclus (virgules)').setStyle(TextInputStyle.Short).setValue(cfg.excludeKeywords.join(', ')).setMaxLength(200).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rd_exclude_flairs').setLabel('Flairs exclus (virgules)').setStyle(TextInputStyle.Short).setValue(cfg.excludeFlairs.join(', ')).setMaxLength(200).setRequired(false)),
          );
          return i.showModal(modal);
        }
      } catch (err) {
        console.error('reddit-annonce panel:', err.message);
      }
    });

    col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
  },

  // ─── Soumissions de modaux (routées depuis interactionCreate.js) ──────────
  async handleModal(interaction) {
    if (interaction.customId === 'rd_modal_add') {
      const sub = sanitizeSubreddit(interaction.fields.getTextInputValue('rd_subreddit'));
      if (!sub) {
        return interaction.reply({ embeds: [errorEmbed('Nom invalide', 'Le nom du subreddit ne peut contenir que des lettres, chiffres et underscores.')], ephemeral: true });
      }

      const existing = await RedditWatch.findOne({ guildId: interaction.guild.id, subreddit: sub });
      if (existing) {
        return interaction.reply({ embeds: [errorEmbed('Déjà suivi', `r/${sub} est déjà dans ta liste de suivis.`)], ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      const check = await checkSubredditExists(sub);
      if (!check.ok) {
        return interaction.editReply({ embeds: [errorEmbed('Subreddit inaccessible', check.reason)] });
      }

      const cfg = await RedditWatch.create({ guildId: interaction.guild.id, subreddit: sub });
      return interaction.editReply({
        embeds: [buildDetailEmbed(cfg, interaction.guild)],
        components: buildDetailComponents(cfg),
      });
    }

    if (interaction.customId.startsWith('rd_modal_filters:')) {
      const currentSub = interaction.customId.split(':')[1];
      const cfg = await RedditWatch.findOne({ guildId: interaction.guild.id, subreddit: currentSub });
      if (!cfg) return;

      const minUp = parseInt(interaction.fields.getTextInputValue('rd_min_upvotes'), 10);
      if (!Number.isFinite(minUp) || minUp < 0) {
        return interaction.reply({ embeds: [errorEmbed('Valeur invalide', 'Les upvotes minimum doivent être un nombre positif.')], ephemeral: true });
      }
      cfg.minUpvotes = minUp;

      const parseList = raw => raw.split(',').map(s => s.trim()).filter(Boolean);
      cfg.includeKeywords = parseList(interaction.fields.getTextInputValue('rd_include_kw'));
      cfg.excludeKeywords = parseList(interaction.fields.getTextInputValue('rd_exclude_kw'));
      cfg.excludeFlairs   = parseList(interaction.fields.getTextInputValue('rd_exclude_flairs'));

      await cfg.save();

      const payload = { embeds: [buildDetailEmbed(cfg, interaction.guild)], components: buildDetailComponents(cfg) };
      if (interaction.isFromMessage?.()) return interaction.update(payload);
      return interaction.reply({ ...payload, ephemeral: true });
    }
  },
};
