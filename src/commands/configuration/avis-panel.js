'use strict';
// commands/avis-panel.js — Panel de configuration avancé du système d'avis (/avis-panel)
// Séparé de /avis pour un accès rapide et direct par le staff.

const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, PermissionFlagsBits,
} = require('discord.js');

const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { isMod, getOrCreateConfig, renderPanel, renderTagsView } = require('../../utils/avisUI');

const COLLECTOR_TIMEOUT_MS = 10 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avis-panel')
    .setDescription('⚙️ Panel de configuration avancé du système d\'avis (staff)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!isMod(interaction)) {
      return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Permission `Gérer le serveur` requise.')], ephemeral: true });
    }

    const guild = interaction.guild;
    let config = await getOrCreateConfig(guild.id);
    const reply = await interaction.reply({ ...renderPanel(config), ephemeral: true, fetchReply: true });
    const collector = reply.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: COLLECTOR_TIMEOUT_MS });

    collector.on('collect', async (i) => {
      const id = i.customId;
      config = await getOrCreateConfig(guild.id);

      if (id === 'avispanel_back' || id === 'avispanel_refresh') return i.update(renderPanel(config));
      if (id === 'avispanel_log') { config.logChannelId = i.values[0]; await config.save(); return i.update(renderPanel(config)); }
      if (id === 'avispanel_publish') { config.reviewChannelId = i.values[0]; await config.save(); return i.update(renderPanel(config)); }

      if (id === 'avispanel_toggle_enabled') { config.enabled = !config.enabled; await config.save(); return i.update(renderPanel(config)); }
      if (id === 'avispanel_toggle_anon') { config.allowAnonymous = !config.allowAnonymous; await config.save(); return i.update(renderPanel(config)); }
      if (id === 'avispanel_toggle_reply') { config.allowOwnerReply = !config.allowOwnerReply; await config.save(); return i.update(renderPanel(config)); }
      if (id === 'avispanel_toggle_approval') { config.requireApproval = !config.requireApproval; await config.save(); return i.update(renderPanel(config)); }

      if (id === 'avispanel_tags') return i.update(renderTagsView(config));
      if (id === 'avispanel_tags_select') { config.activeTags = i.values; await config.save(); return i.update(renderTagsView(config)); }

      if (id === 'avispanel_modal_thresholds') {
        const modal = new ModalBuilder().setCustomId('avispanel_modal_thresholds_submit').setTitle('🕒 Ancienneté & Cooldowns');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('min_join').setLabel('Ancienneté min. sur le serveur (jours, 0=off)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(config.minJoinDays))),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('min_age').setLabel('Âge min. du compte Discord (jours, 0=off)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(config.minAccountAgeDays))),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('edit_cd').setLabel('Cooldown de modification (heures)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(config.editCooldownHours))),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('report_threshold').setLabel('Signalements avant masquage auto').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(config.reportThreshold))),
        );
        return i.showModal(modal);
      }
    });

    collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
  },

  async handleModal(interaction) {
    if (interaction.customId !== 'avispanel_modal_thresholds_submit') return;

    const config = await getOrCreateConfig(interaction.guild.id);
    const minJoin = parseInt(interaction.fields.getTextInputValue('min_join'));
    const minAge  = parseInt(interaction.fields.getTextInputValue('min_age'));
    const cd      = parseInt(interaction.fields.getTextInputValue('edit_cd'));
    const thresh  = parseInt(interaction.fields.getTextInputValue('report_threshold'));

    if ([minJoin, minAge, cd, thresh].some(v => isNaN(v) || v < 0)) {
      return interaction.reply({ embeds: [errorEmbed('Valeur invalide', 'Toutes les valeurs doivent être des nombres positifs (0 pour désactiver une contrainte).')], ephemeral: true });
    }

    config.minJoinDays = minJoin; config.minAccountAgeDays = minAge; config.editCooldownHours = cd; config.reportThreshold = thresh;
    await config.save();
    return interaction.update(renderPanel(config)).catch(() => interaction.reply({ embeds: [successEmbed('Paramètres mis à jour')], ephemeral: true }));
  },
};
