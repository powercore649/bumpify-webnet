// commands/onboarding.js — Portail d'accès / Onboarding, panel avancé
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, ChannelType,
} = require('discord.js');
const OnboardingConfig = require('../../models/OnboardingConfig');
const { lockdownExistingChannels } = require('../../utils/onboardingManager');
const { COLORS, errorEmbed, successEmbed } = require('../../utils/embeds');

async function getOrCreate(guildId) {
  let cfg = await OnboardingConfig.findOne({ guildId });
  if (!cfg) cfg = await OnboardingConfig.create({ guildId });
  return cfg;
}

// ─── Panel principal ───────────────────────────────────────────────────────
function buildOverviewEmbed(cfg, guild) {
  const questionsPreview = cfg.questions.length
    ? cfg.questions.map((q, i) => `**${i + 1}.** ${q.type === 'choice' ? '🔘' : '💬'} ${q.prompt.slice(0, 60)}${q.required ? '' : ' *(optionnelle)*'}`).join('\n')
    : '*Aucune question configurée.*';

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🚪 Portail d\'accès — Onboarding')
    .setDescription('Crée un salon privé pour chaque nouveau membre, pose des questions, et lui donne accès au serveur une fois terminé.')
    .addFields(
      { name: '📢 Statut', value: cfg.enabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: '📁 Catégorie', value: cfg.categoryId ? `<#${cfg.categoryId}>` : '*Non définie*', inline: true },
      { name: '🚫 Rôle non-vérifié', value: cfg.unverifiedRoleId ? `<@&${cfg.unverifiedRoleId}>` : '*Créé automatiquement*', inline: true },
      { name: '✅ Rôle d\'accès (fin)', value: cfg.accessRoleId ? `<@&${cfg.accessRoleId}>` : '*Aucun (retire juste le rôle non-vérifié)*', inline: true },
      { name: '🗑️ Suppr. salon à la fin', value: cfg.deleteChannelOnComplete ? '✅ Oui' : '❌ Non', inline: true },
      { name: '⏱️ Délai limite', value: cfg.timeoutMinutes > 0 ? `${cfg.timeoutMinutes} min (${cfg.timeoutAction === 'kick' ? 'expulsion' : 'aucune action'})` : '*Aucune limite*', inline: true },
      { name: '💫 Complétés / Expirés', value: `${cfg.totalCompleted} / ${cfg.totalTimedOut}`, inline: true },
      { name: `❓ Questions (${cfg.questions.length})`, value: questionsPreview, inline: false },
    )
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .setFooter({ text: 'Placeholders des messages : {user} {server}' })
    .setTimestamp();
}

function buildOverviewComponents(cfg) {
  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('ob_select_category')
      .setPlaceholder('📁 Catégorie des salons d\'accueil...')
      .addChannelTypes(ChannelType.GuildCategory),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('ob_select_access_role')
      .setPlaceholder('✅ Rôle donné à la fin (optionnel)...')
      .setMinValues(0).setMaxValues(1),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ob_toggle_enabled').setLabel(cfg.enabled ? '🔴 Désactiver' : '🟢 Activer').setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ob_toggle_delete').setLabel('🗑️ Suppr. auto salon').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ob_settings').setLabel('⚙️ Réglages').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ob_messages').setLabel('💬 Messages').setStyle(ButtonStyle.Secondary),
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ob_add_question').setLabel('➕ Ajouter une question').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ob_manage_questions').setLabel('📋 Gérer les questions').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ob_close').setLabel('✖ Fermer').setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3, row4];
}

// ─── Vue de gestion des questions ──────────────────────────────────────────
function buildQuestionsEmbed(cfg) {
  const lines = cfg.questions.length
    ? cfg.questions.map((q, i) => `**${i + 1}.** ${q.type === 'choice' ? '🔘 Choix' : '💬 Texte'} — ${q.prompt}${q.type === 'choice' ? `\n> Options : ${q.choices.join(', ')}` : ''}${q.required ? '' : ' *(optionnelle)*'}`).join('\n\n')
    : '*Aucune question pour l\'instant.*';

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('📋 Questions configurées')
    .setDescription(lines);
}

function buildQuestionsComponents(cfg) {
  const rows = [];
  if (cfg.questions.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('ob_select_question')
        .setPlaceholder('Choisir une question à supprimer...')
        .addOptions(cfg.questions.slice(0, 25).map((q, i) => ({
          label: `${i + 1}. ${q.prompt.slice(0, 90)}`, value: q.id,
        }))),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ob_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('onboarding')
    .setDescription('🚪 Panel du portail d\'accès (onboarding des nouveaux membres)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const cfg = await getOrCreate(interaction.guild.id);

    const refresh = async i => {
      const fresh = await getOrCreate(interaction.guild.id);
      await i.update({ embeds: [buildOverviewEmbed(fresh, interaction.guild)], components: buildOverviewComponents(fresh) });
    };

    const reply = await interaction.reply({
      embeds: [buildOverviewEmbed(cfg, interaction.guild)],
      components: buildOverviewComponents(cfg),
      ephemeral: true,
      fetchReply: true,
    });

    const col = reply.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time: 15 * 60 * 1000,
    });

    col.on('collect', async i => {
      try {
        const live = await getOrCreate(interaction.guild.id);

        if (i.customId === 'ob_close') return i.update({ components: [] });
        if (i.customId === 'ob_back') return refresh(i);

        if (i.customId === 'ob_select_category') {
          live.categoryId = i.values[0];
          await live.save();
          return refresh(i);
        }
        if (i.customId === 'ob_select_access_role') {
          live.accessRoleId = i.values[0] || null;
          await live.save();
          return refresh(i);
        }

        if (i.customId === 'ob_toggle_enabled') {
          if (!live.enabled && live.questions.length === 0) {
            return i.reply({ embeds: [errorEmbed('Aucune question', 'Ajoute au moins une question avant d\'activer le portail (sinon les membres passeront directement sans rien répondre).')], ephemeral: true });
          }

          const wasDisabled = !live.enabled;
          live.enabled = !live.enabled;
          await live.save();

          // À l'activation : verrouille tous les salons existants pour le rôle non-vérifié
          if (wasDisabled) {
            await i.deferUpdate();
            const { ensureUnverifiedRole } = require('../../utils/onboardingManager');
            const role = await ensureUnverifiedRole(interaction.guild, live);
            await lockdownExistingChannels(interaction.guild, role, live.categoryId);
            const fresh = await getOrCreate(interaction.guild.id);
            return i.editReply({ embeds: [buildOverviewEmbed(fresh, interaction.guild)], components: buildOverviewComponents(fresh) });
          }
          return refresh(i);
        }

        if (i.customId === 'ob_toggle_delete') {
          live.deleteChannelOnComplete = !live.deleteChannelOnComplete;
          await live.save();
          return refresh(i);
        }

        if (i.customId === 'ob_settings') {
          const modal = new ModalBuilder().setCustomId('ob_modal_settings').setTitle('⚙️ Réglages du portail');
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ob_timeout').setLabel('Délai limite en minutes (0 = aucun)').setStyle(TextInputStyle.Short).setValue(String(live.timeoutMinutes)).setMaxLength(5).setRequired(true)),
          );
          return i.showModal(modal);
        }

        if (i.customId === 'ob_messages') {
          const modal = new ModalBuilder().setCustomId('ob_modal_messages').setTitle('💬 Messages du portail');
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ob_welcome').setLabel('Message d\'accueil ({user} {server})').setStyle(TextInputStyle.Paragraph).setValue(live.welcomeMessage).setMaxLength(1000).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ob_completion').setLabel('Message de fin ({user} {server})').setStyle(TextInputStyle.Paragraph).setValue(live.completionMessage).setMaxLength(1000).setRequired(true)),
          );
          return i.showModal(modal);
        }

        if (i.customId === 'ob_add_question') {
          if (live.questions.length >= 15) {
            return i.reply({ embeds: [errorEmbed('Limite atteinte', 'Maximum 15 questions.')], ephemeral: true });
          }
          const modal = new ModalBuilder().setCustomId('ob_modal_add_question').setTitle('➕ Nouvelle question');
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ob_q_prompt').setLabel('Question').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ob_q_type').setLabel('Type : "texte" ou "choix"').setStyle(TextInputStyle.Short).setValue('texte').setMaxLength(10).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ob_q_choices').setLabel('Options si "choix" (virgules, max 5)').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ob_q_required').setLabel('Obligatoire ? "oui" ou "non"').setStyle(TextInputStyle.Short).setValue('oui').setMaxLength(5).setRequired(true)),
          );
          return i.showModal(modal);
        }

        if (i.customId === 'ob_manage_questions') {
          return i.update({ embeds: [buildQuestionsEmbed(live)], components: buildQuestionsComponents(live) });
        }

        if (i.customId === 'ob_select_question') {
          const qId = i.values[0];
          live.questions = live.questions.filter(q => q.id !== qId);
          await live.save();
          return i.update({ embeds: [buildQuestionsEmbed(live)], components: buildQuestionsComponents(live) });
        }
      } catch (err) {
        console.error('onboarding panel:', err.message);
      }
    });

    col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
  },

  // ─── Soumissions de modaux (routées depuis interactionCreate.js) ──────────
  async handleModal(interaction) {
    const cfg = await getOrCreate(interaction.guild.id);

    if (interaction.customId === 'ob_modal_settings') {
      const timeout = parseInt(interaction.fields.getTextInputValue('ob_timeout'), 10);
      if (!Number.isFinite(timeout) || timeout < 0 || timeout > 10080) {
        return interaction.reply({ embeds: [errorEmbed('Valeur invalide', 'Le délai doit être entre 0 et 10080 minutes (7 jours).')], ephemeral: true });
      }
      cfg.timeoutMinutes = timeout;
      await cfg.save();
    }

    if (interaction.customId === 'ob_modal_messages') {
      cfg.welcomeMessage = interaction.fields.getTextInputValue('ob_welcome').trim();
      cfg.completionMessage = interaction.fields.getTextInputValue('ob_completion').trim();
      await cfg.save();
    }

    if (interaction.customId === 'ob_modal_add_question') {
      const prompt = interaction.fields.getTextInputValue('ob_q_prompt').trim();
      const typeRaw = interaction.fields.getTextInputValue('ob_q_type').trim().toLowerCase();
      const choicesRaw = interaction.fields.getTextInputValue('ob_q_choices');
      const requiredRaw = interaction.fields.getTextInputValue('ob_q_required').trim().toLowerCase();

      const type = typeRaw === 'choix' ? 'choice' : 'text';
      const choices = choicesRaw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);

      if (type === 'choice' && choices.length < 2) {
        return interaction.reply({ embeds: [errorEmbed('Options manquantes', 'Une question à choix multiples a besoin d\'au moins 2 options séparées par des virgules.')], ephemeral: true });
      }

      cfg.questions.push({
        id: `q_${Date.now()}`,
        type, prompt, choices,
        required: requiredRaw !== 'non',
      });
      await cfg.save();
    }

    const payload = { embeds: [buildOverviewEmbed(cfg, interaction.guild)], components: buildOverviewComponents(cfg) };
    if (interaction.isFromMessage?.()) return interaction.update(payload);
    return interaction.reply({ ...payload, ephemeral: true });
  },
};
