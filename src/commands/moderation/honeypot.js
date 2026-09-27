// commands/honeypot.js — Salon piège anti-bot / anti-token-grabber, panel 100% fonctionnel
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelSelectMenuBuilder, PermissionFlagsBits, ChannelType,
} = require('discord.js');
const Honeypot = require('../../models/Honeypot');
const HoneypotTrigger = require('../../models/HoneypotTrigger');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');

const ACTION_LABELS = {
  mute: '🔇 Mute temporaire',
  kick: '👢 Expulsion',
  ban:  '🔨 Bannissement',
};

// Noms crédibles pour attirer les bots (évite les mots "piège"/"trap" qui les feraient fuir)
const DECOY_NAMES = [
  'verification-compte', 'lisez-avant-de-parler', 'annonces-importantes',
  'regles-du-serveur', 'bienvenue-ici', 'confirmez-votre-arrivee',
  'infos-serveur', 'a-lire-absolument',
];

async function getOrCreate(guildId) {
  let cfg = await Honeypot.findOne({ guildId });
  if (!cfg) cfg = await Honeypot.create({ guildId });
  return cfg;
}

// ─── Sanction partagée (message piège ET bouton piège) ───────────────────────
async function applySanction(guild, member, user, cfg, { channelId, contentPreview, triggerLabel }) {
  if (cfg.dmUser) {
    const actionTxt = {
      mute: `mis en sourdine pendant **${Math.round(cfg.muteDuration / (24 * 60))} jour(s)**`,
      kick: 'expulsé du serveur',
      ban:  'banni du serveur',
    }[cfg.action];
    await user.send({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.error)
        .setTitle('⚠️ Sanction automatique — Honeypot')
        .setDescription(`Vous avez déclenché un piège de sécurité sur **${guild.name}**.\nVous avez été ${actionTxt}.`)],
    }).catch(() => {});
  }

  if (member) {
    if (cfg.action === 'mute' && member.moderatable) {
      await member.timeout(cfg.muteDuration * 60 * 1000, 'Honeypot déclenché').catch(() => {});
    } else if (cfg.action === 'kick' && member.kickable) {
      await member.kick('Honeypot déclenché').catch(() => {});
    } else if (cfg.action === 'ban' && member.bannable) {
      await member.ban({ reason: 'Honeypot déclenché' }).catch(() => {});
    }
  }

  await Honeypot.updateOne({ guildId: guild.id }, { $inc: { totalTriggered: 1 } }).catch(() => {});

  await HoneypotTrigger.create({
    guildId: guild.id, userId: user.id, userTag: user.tag, channelId, action: cfg.action, contentPreview,
  }).catch(() => {});

  if (cfg.logChannelId) {
    const logChannel = guild.channels.cache.get(cfg.logChannelId);
    if (logChannel) {
      await logChannel.send({
        embeds: [new EmbedBuilder()
          .setColor(0xE67E22)
          .setTitle('🍯 Honeypot déclenché')
          .addFields(
            { name: 'Membre', value: `${user.tag} (${user.id})`, inline: true },
            { name: 'Salon', value: `<#${channelId}>`, inline: true },
            { name: 'Déclencheur', value: triggerLabel, inline: true },
            { name: 'Action', value: ACTION_LABELS[cfg.action], inline: true },
            { name: 'Détail', value: contentPreview.slice(0, 500), inline: false },
          )
          .setTimestamp()],
      }).catch(() => {});
    }
  }
}

// ─── Déclenché en écrivant dans un salon piège — utilisé par messageCreate.js ─
async function handleTrigger(message, cfg) {
  const member = message.member;
  if (member?.permissions?.has(PermissionFlagsBits.Administrator)) return; // jamais un admin

  if (cfg.deleteMessage) await message.delete().catch(() => {});

  await applySanction(message.guild, member, message.author, cfg, {
    channelId: message.channel.id,
    contentPreview: message.content ? message.content.slice(0, 300) : '*Vide / pièce jointe*',
    triggerLabel: '💬 Message envoyé',
  });
}

// ─── Déclenché en cliquant le bouton piège — routé depuis interactionCreate.js
async function handleButtonTrigger(interaction) {
  const guild = interaction.guild;
  if (!guild) return;

  const cfg = await Honeypot.findOne({ guildId: guild.id, enabled: true });
  if (!cfg) {
    return interaction.reply({ content: "⚠️ Ce piège n'est plus actif.", ephemeral: true }).catch(() => {});
  }

  const member = interaction.member;
  if (member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '👑 Les administrateurs ne sont pas affectés par ce piège.', ephemeral: true }).catch(() => {});
  }

  await interaction.reply({ content: '⏳ Vérification en cours…', ephemeral: true }).catch(() => {});

  await applySanction(guild, member, interaction.user, cfg, {
    channelId: interaction.channel?.id || 'inconnu',
    contentPreview: '🔘 Bouton piège cliqué',
    triggerLabel: '🔘 Bouton cliqué',
  });
}

// ─── Construit l'embed + bouton piège publiés dans les salons ────────────────
function buildWarningPayload(guild, cfg) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle('⚠️ Avertissement')
    .setDescription(cfg.warningMessage)
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .setFooter({ text: `Sécurité automatique • ${guild.name}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hp_trap_click').setLabel('✅ Confirmer avoir lu').setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [row] };
}

// ─── Embed + composants du panel ──────────────────────────────────────────────
function buildEmbed(cfg) {
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🍯 Honeypot — Panel de configuration')
    .setDescription("Salon piège anti-bot / anti-token-grabber. Tout membre écrivant dans un salon configuré ci-dessous — ou cliquant sur le bouton piège du message d'avertissement — est automatiquement sanctionné.")
    .addFields(
      { name: 'État', value: cfg.enabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: 'Action', value: ACTION_LABELS[cfg.action], inline: true },
      { name: 'Durée mute', value: cfg.action === 'mute' ? `${Math.round(cfg.muteDuration / (24 * 60))} jour(s)` : '—', inline: true },
      { name: 'Salons piège', value: cfg.channelIds.length ? cfg.channelIds.map(id => `<#${id}>`).join(', ') : '*Aucun — le système ne peut pas être activé*', inline: false },
      { name: 'Salon de logs', value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : '*Non défini*', inline: true },
      { name: 'Suppression message', value: cfg.deleteMessage ? '✅ Oui' : '❌ Non', inline: true },
      { name: 'DM au membre', value: cfg.dmUser ? '✅ Oui' : '❌ Non', inline: true },
      { name: 'Déclenchements', value: `${cfg.totalTriggered}`, inline: true },
      { name: "Message d'avertissement", value: cfg.warningMessage.slice(0, 1000), inline: false },
    )
    .setFooter({ text: 'Bumpify • Honeypot' })
    .setTimestamp();
}

function buildComponents() {
  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hp_toggle').setLabel('🔛 Activer / Désactiver').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('hp_set_channels').setLabel('# Salons piège').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('hp_set_logs').setLabel('# Salon logs').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('hp_set_action').setLabel('⚔️ Action').setStyle(ButtonStyle.Secondary),
  );
  const r2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hp_autocreate').setLabel('🪄 Créer un salon automatiquement').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('hp_publish').setLabel("📌 Publier l'avertissement").setStyle(ButtonStyle.Secondary),
  );
  const r3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hp_advanced').setLabel('⚙️ Paramètres avancés').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('hp_stats').setLabel('📊 Statistiques').setStyle(ButtonStyle.Secondary),
  );
  return [r1, r2, r3];
}

// ─── Statistiques détaillées + historique (v2) ────────────────────────────────
async function buildStatsEmbed(guildId) {
  const now = Date.now();
  const since = h => new Date(now - h * 3600 * 1000);

  const [total, last24h, last7d, last30d, byAction, byChannel, recent] = await Promise.all([
    HoneypotTrigger.countDocuments({ guildId }),
    HoneypotTrigger.countDocuments({ guildId, triggeredAt: { $gte: since(24) } }),
    HoneypotTrigger.countDocuments({ guildId, triggeredAt: { $gte: since(24 * 7) } }),
    HoneypotTrigger.countDocuments({ guildId, triggeredAt: { $gte: since(24 * 30) } }),
    HoneypotTrigger.aggregate([{ $match: { guildId } }, { $group: { _id: '$action', count: { $sum: 1 } } }]),
    HoneypotTrigger.aggregate([
      { $match: { guildId } },
      { $group: { _id: '$channelId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ]),
    HoneypotTrigger.find({ guildId }).sort({ triggeredAt: -1 }).limit(10).lean(),
  ]);

  const actionCounts = { mute: 0, kick: 0, ban: 0 };
  byAction.forEach(a => { actionCounts[a._id] = a.count; });
  const topChannel = byChannel[0];

  const recentLines = recent.length
    ? recent.map(r => {
        const ts = Math.floor(new Date(r.triggeredAt).getTime() / 1000);
        return `${ACTION_LABELS[r.action]} — **${r.userTag}** dans <#${r.channelId}> <t:${ts}:R>`;
      }).join('\n')
    : '*Aucun déclenchement enregistré.*';

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('📊 Honeypot — Statistiques détaillées')
    .addFields(
      { name: 'Total',    value: `${total}`,    inline: true },
      { name: '24h',      value: `${last24h}`,  inline: true },
      { name: '7 jours',  value: `${last7d}`,   inline: true },
      { name: '30 jours', value: `${last30d}`,  inline: true },
      { name: 'Par action', value: `🔇 Mute: **${actionCounts.mute}**\n👢 Kick: **${actionCounts.kick}**\n🔨 Ban: **${actionCounts.ban}**`, inline: true },
      { name: 'Salon le plus déclenché', value: topChannel ? `<#${topChannel._id}> (${topChannel.count})` : '*Aucun*', inline: true },
      { name: 'Historique récent (10 derniers)', value: recentLines, inline: false },
    )
    .setFooter({ text: 'Bumpify • Honeypot v2' })
    .setTimestamp();
}

module.exports = {
  getOrCreate,
  handleTrigger,
  handleButtonTrigger,

  data: new SlashCommandBuilder()
    .setName('honeypot')
    .setDescription('🍯 Configurer le salon piège anti-bot / anti-token-grabber')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    let cfg = await getOrCreate(interaction.guild.id);

    const reply = await interaction.reply({
      embeds: [buildEmbed(cfg)],
      components: buildComponents(),
      ephemeral: true,
      fetchReply: true,
    });

    const col = reply.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time: 10 * 60 * 1000,
    });

    const refresh = async (i) => {
      cfg = await getOrCreate(interaction.guild.id);
      return i.update({ embeds: [buildEmbed(cfg)], components: buildComponents() });
    };

    col.on('collect', async i => {
      cfg = await getOrCreate(interaction.guild.id);

      // ── Activer / Désactiver ──────────────────────────────────────────
      if (i.customId === 'hp_toggle') {
        if (!cfg.enabled && cfg.channelIds.length === 0) {
          return i.reply({ embeds: [errorEmbed('Aucun salon configuré', 'Ajoute au moins un salon piège avec le bouton "# Salons piège" avant d\'activer le système.')], ephemeral: true });
        }
        cfg.enabled = !cfg.enabled;
        await cfg.save();
        return refresh(i);
      }

      // ── Salons piège (ajout via ChannelSelect + retrait via StringSelect) ──
      if (i.customId === 'hp_set_channels') {
        const back = new ButtonBuilder().setCustomId('hp_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary);
        const rows = [
          new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder().setCustomId('hp_channel_add').setPlaceholder('➕ Ajouter un ou plusieurs salons…')
              .addChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(5),
          ),
        ];
        if (cfg.channelIds.length) {
          rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('hp_channel_remove').setPlaceholder('➖ Retirer un ou plusieurs salons…')
              .setMinValues(1).setMaxValues(cfg.channelIds.length)
              .addOptions(cfg.channelIds.slice(0, 25).map(id => {
                const ch = interaction.guild.channels.cache.get(id);
                return { label: ch ? `#${ch.name}` : id, value: id };
              })),
          ));
        }
        rows.push(new ActionRowBuilder().addComponents(back));
        return i.update({
          embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('# Salons piège')
            .setDescription(`Actuels : ${cfg.channelIds.length ? cfg.channelIds.map(id => `<#${id}>`).join(', ') : '*Aucun*'}`)],
          components: rows,
        });
      }
      if (i.customId === 'hp_channel_add') {
        const merged = Array.from(new Set([...cfg.channelIds, ...i.values]));
        cfg.channelIds = merged;
        await cfg.save();
        return refresh(i);
      }
      if (i.customId === 'hp_channel_remove') {
        cfg.channelIds = cfg.channelIds.filter(id => !i.values.includes(id));
        await cfg.save();
        return refresh(i);
      }

      // ── Salon de logs ──────────────────────────────────────────────────
      if (i.customId === 'hp_set_logs') {
        const back = new ButtonBuilder().setCustomId('hp_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary);
        const clear = new ButtonBuilder().setCustomId('hp_logs_clear').setLabel('🗑️ Retirer').setStyle(ButtonStyle.Danger);
        return i.update({
          embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('# Salon de logs')
            .setDescription(`Actuel : ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : '*Aucun*'}`)],
          components: [
            new ActionRowBuilder().addComponents(
              new ChannelSelectMenuBuilder().setCustomId('hp_logs_select').setPlaceholder('Choisir un salon…').addChannelTypes(ChannelType.GuildText),
            ),
            new ActionRowBuilder().addComponents(back, clear),
          ],
        });
      }
      if (i.customId === 'hp_logs_select') { cfg.logChannelId = i.values[0]; await cfg.save(); return refresh(i); }
      if (i.customId === 'hp_logs_clear')  { cfg.logChannelId = null;        await cfg.save(); return refresh(i); }

      // ── Action ──────────────────────────────────────────────────────────
      if (i.customId === 'hp_set_action') {
        const back = new ButtonBuilder().setCustomId('hp_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary);
        return i.update({
          embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('⚔️ Action déclenchée').setDescription(`Actuelle : **${ACTION_LABELS[cfg.action]}**`)],
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder().setCustomId('hp_action_select').setPlaceholder('Choisir une action…').addOptions([
                { label: 'Mute temporaire', value: 'mute', emoji: '🔇', description: 'Timeout natif Discord' },
                { label: 'Expulsion',       value: 'kick', emoji: '👢', description: 'Kick immédiat' },
                { label: 'Bannissement',    value: 'ban',  emoji: '🔨', description: 'Ban immédiat' },
              ]),
            ),
            new ActionRowBuilder().addComponents(back),
          ],
        });
      }
      if (i.customId === 'hp_action_select') { cfg.action = i.values[0]; await cfg.save(); return refresh(i); }

      // ── Création automatique du salon piège ────────────────────────────
      if (i.customId === 'hp_autocreate') {
        const me = interaction.guild.members.me;
        if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return i.reply({ embeds: [errorEmbed('Permission manquante', 'Le bot a besoin de la permission "Gérer les salons" pour créer le salon automatiquement.')], ephemeral: true });
        }

        const name = DECOY_NAMES[Math.floor(Math.random() * DECOY_NAMES.length)];
        let channel;
        try {
          channel = await interaction.guild.channels.create({
            name,
            type: ChannelType.GuildText,
            topic: '⚠️ Salon système généré par Bumpify — ne pas supprimer',
            position: 0, // en haut de la liste pour être vu (et scanné) en premier
            permissionOverwrites: [
              {
                id: interaction.guild.roles.everyone.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
              },
            ],
          });
        } catch (err) {
          return i.reply({ embeds: [errorEmbed('Échec de la création', `Discord a refusé la création du salon : ${err.message}`)], ephemeral: true });
        }

        cfg.channelIds = Array.from(new Set([...cfg.channelIds, channel.id]));
        await cfg.save();

        // Publie et épingle immédiatement l'avertissement dans le nouveau salon
        const warnMsg = await channel.send(buildWarningPayload(interaction.guild, cfg)).catch(() => null);
        if (warnMsg) await warnMsg.pin().catch(() => {});

        return refresh(i);
      }

      // ── Publier l'avertissement dans les salons piège ─────────────────────
      if (i.customId === 'hp_publish') {
        if (!cfg.channelIds.length) {
          return i.reply({ embeds: [errorEmbed('Aucun salon configuré', 'Ajoute un salon piège avant de publier le message.')], ephemeral: true });
        }
        let posted = 0;
        for (const id of cfg.channelIds) {
          const ch = interaction.guild.channels.cache.get(id);
          if (!ch) continue;
          const msg = await ch.send(buildWarningPayload(interaction.guild, cfg)).catch(() => null);
          if (msg) { await msg.pin().catch(() => {}); posted++; }
        }
        return i.reply({ embeds: [successEmbed('Message publié', `Avertissement envoyé et épinglé dans ${posted} salon(s).`)], ephemeral: true });
      }

      // ── Paramètres avancés (modal) ─────────────────────────────────────
      if (i.customId === 'hp_advanced') {
        const modal = new ModalBuilder().setCustomId('hp_advanced_modal').setTitle('⚙️ Paramètres avancés Honeypot');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('hp_duree').setLabel('Durée du mute en jours (1–28)').setStyle(TextInputStyle.Short).setValue(String(Math.round(cfg.muteDuration / (24 * 60)))).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('hp_delete').setLabel('Supprimer le message piégé ? (oui/non)').setStyle(TextInputStyle.Short).setValue(cfg.deleteMessage ? 'oui' : 'non').setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('hp_dm').setLabel('Envoyer un DM au membre ? (oui/non)').setStyle(TextInputStyle.Short).setValue(cfg.dmUser ? 'oui' : 'non').setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('hp_message').setLabel("Message d'avertissement").setStyle(TextInputStyle.Paragraph).setValue(cfg.warningMessage).setMaxLength(1000).setRequired(true)),
        );
        return i.showModal(modal);
      }

      if (i.customId === 'hp_back') return refresh(i);

      // ── Statistiques détaillées (v2) ────────────────────────────────────
      if (i.customId === 'hp_stats') {
        const back  = new ButtonBuilder().setCustomId('hp_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary);
        const clear = new ButtonBuilder().setCustomId('hp_stats_clear').setLabel("🧹 Vider l'historique").setStyle(ButtonStyle.Danger);
        const statsEmbed = await buildStatsEmbed(interaction.guild.id);
        return i.update({ embeds: [statsEmbed], components: [new ActionRowBuilder().addComponents(back, clear)] });
      }
      if (i.customId === 'hp_stats_clear') {
        await HoneypotTrigger.deleteMany({ guildId: interaction.guild.id });
        await Honeypot.updateOne({ guildId: interaction.guild.id }, { $set: { totalTriggered: 0 } });
        const back  = new ButtonBuilder().setCustomId('hp_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary);
        const clear = new ButtonBuilder().setCustomId('hp_stats_clear').setLabel("🧹 Vider l'historique").setStyle(ButtonStyle.Danger);
        const statsEmbed = await buildStatsEmbed(interaction.guild.id);
        return i.update({ embeds: [statsEmbed], components: [new ActionRowBuilder().addComponents(back, clear)] });
      }
    });

    col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
  },

  async handleAdvancedModal(interaction) {
    const cfg = await getOrCreate(interaction.guild.id);
    const jours = Math.min(28, Math.max(1, parseInt(interaction.fields.getTextInputValue('hp_duree')) || 7));
    cfg.muteDuration = jours * 24 * 60;

    const del = interaction.fields.getTextInputValue('hp_delete').toLowerCase().trim();
    cfg.deleteMessage = ['oui', 'yes', '1', 'true'].includes(del);

    const dm = interaction.fields.getTextInputValue('hp_dm').toLowerCase().trim();
    cfg.dmUser = ['oui', 'yes', '1', 'true'].includes(dm);

    cfg.warningMessage = interaction.fields.getTextInputValue('hp_message').slice(0, 1000);

    await cfg.save();

    return interaction.reply({
      embeds: [successEmbed('✅ Paramètres mis à jour',
        `Durée mute : **${jours} jour(s)** ・ Suppression : **${cfg.deleteMessage ? 'Oui' : 'Non'}** ・ DM : **${cfg.dmUser ? 'Oui' : 'Non'}**`)],
      ephemeral: true,
    });
  },
};
