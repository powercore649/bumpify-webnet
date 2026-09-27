const {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType,
} = require('discord.js');
const BirthdayConfig = require('../../models/BirthdayConfig');
const { COLORS } = require('../../utils/embeds');

async function getOrCreate(guildId) {
  let cfg = await BirthdayConfig.findOne({ guildId });
  if (!cfg) cfg = await BirthdayConfig.create({ guildId });
  return cfg;
}

function buildPanel(cfg) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🎂 Anniversaires — Panneau de configuration')
    .setDescription('Configurez tout depuis ce panneau : salon d\'annonce, rôle du jour, rôle à mentionner, message.')
    .addFields(
      { name: 'État', value: cfg.enabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: "Salon d'annonce", value: cfg.channelId ? `<#${cfg.channelId}>` : '*Non défini*', inline: true },
      { name: 'Rôle du jour', value: cfg.roleId ? `<@&${cfg.roleId}>` : '*Aucun*', inline: true },
      { name: 'Rôle mentionné', value: cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : '*Aucun*', inline: true },
      { name: 'Message', value: `\`\`\`${cfg.message}\`\`\`` },
    )
    .setFooter({ text: 'Variables disponibles dans le message : {user}, {server}' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bd_toggle').setLabel(cfg.enabled ? 'Désactiver' : 'Activer').setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success).setEmoji(cfg.enabled ? '🔴' : '🟢'),
    new ButtonBuilder().setCustomId('bd_message').setLabel('Message').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId('bd_channel').setPlaceholder("📍 Choisir le salon d'annonce").addChannelTypes(ChannelType.GuildText),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId('bd_role').setPlaceholder('🎉 Rôle donné le jour J (optionnel)').setMinValues(0).setMaxValues(1),
  );

  const row4 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId('bd_ping_role').setPlaceholder('📣 Rôle à mentionner dans l\'annonce (optionnel)').setMinValues(0).setMaxValues(1),
  );

  return { embeds: [embed], components: [row1, row2, row3, row4] };
}

module.exports = {
  getOrCreate,
  data: new SlashCommandBuilder()
    .setName('anniversaire-config')
    .setDescription('🎂 Ouvrir le panneau de configuration des anniversaires')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const cfg = await getOrCreate(interaction.guild.id);
    const reply = await interaction.reply({ ...buildPanel(cfg), ephemeral: true, fetchReply: true });

    const collector = reply.createMessageComponentCollector({ time: 10 * 60 * 1000 });

    const modalHandler = async (i) => {
      if (!i.isModalSubmit()) return;
      if (i.user.id !== interaction.user.id || i.guildId !== interaction.guildId) return;
      if (i.customId !== 'bd_modal_message') return;

      const fresh = await getOrCreate(interaction.guild.id);
      fresh.message = i.fields.getTextInputValue('value');
      await fresh.save();
      await i.update(buildPanel(fresh));
    };
    interaction.client.on('interactionCreate', modalHandler);

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: "Seule la personne ayant ouvert ce panneau peut l'utiliser.", ephemeral: true });
      }

      const fresh = await getOrCreate(interaction.guild.id);

      if (i.customId === 'bd_toggle') {
        fresh.enabled = !fresh.enabled;
        await fresh.save();
        return i.update(buildPanel(fresh));
      }

      if (i.customId === 'bd_message') {
        const modal = new ModalBuilder().setCustomId('bd_modal_message').setTitle('Message d\'anniversaire');
        const input = new TextInputBuilder().setCustomId('value').setLabel('Message ({user}, {server})').setStyle(TextInputStyle.Paragraph).setValue(fresh.message).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return i.showModal(modal);
      }

      if (i.customId === 'bd_channel') {
        fresh.channelId = i.values[0];
        await fresh.save();
        return i.update(buildPanel(fresh));
      }

      if (i.customId === 'bd_role') {
        fresh.roleId = i.values[0] || null;
        await fresh.save();
        return i.update(buildPanel(fresh));
      }

      if (i.customId === 'bd_ping_role') {
        fresh.pingRoleId = i.values[0] || null;
        await fresh.save();
        return i.update(buildPanel(fresh));
      }
    });

    collector.on('end', () => {
      interaction.client.removeListener('interactionCreate', modalHandler);
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
