const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} = require('discord.js');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');

// Session en mémoire par userId
const sessions = new Map();

function getOrCreateSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      title:       '',
      description: '',
      color:       COLORS.primary,
      footer:      '',
      imageURL:    '',
      thumbnailURL:'',
      fields:      [],
      targetChannelId: null,
    });
  }
  return sessions.get(userId);
}

function buildPreview(session, guild) {
  const embed = new EmbedBuilder().setColor(session.color);
  if (session.title)        embed.setTitle(session.title);
  if (session.description)  embed.setDescription(session.description);
  if (session.footer)       embed.setFooter({ text: session.footer });
  if (session.imageURL)     embed.setImage(session.imageURL);
  if (session.thumbnailURL) embed.setThumbnail(session.thumbnailURL);
  if (session.fields.length > 0) embed.addFields(session.fields);
  embed.setTimestamp();
  return embed;
}

function buildEditorComponents(session) {
  const row1 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('emb_action')
      .setPlaceholder('✏️ Modifier...')
      .addOptions([
        { label: '📝 Titre',        value: 'edit_title',       emoji: '📝' },
        { label: '📄 Description',  value: 'edit_description', emoji: '📄' },
        { label: '🎨 Couleur',      value: 'edit_color',       emoji: '🎨' },
        { label: '📌 Footer',       value: 'edit_footer',      emoji: '📌' },
        { label: '🖼️ Image',        value: 'edit_image',       emoji: '🖼️' },
        { label: '🖼️ Thumbnail',    value: 'edit_thumbnail',   emoji: '🖼️' },
        { label: '➕ Ajouter un champ', value: 'add_field',    emoji: '➕' },
        { label: '🗑️ Effacer champs',  value: 'clear_fields',  emoji: '🗑️' },
      ])
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('emb_channel')
      .setPlaceholder('📢 Salon de destination...')
      .addChannelTypes(ChannelType.GuildText)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('emb_send').setLabel('📤 Envoyer').setStyle(ButtonStyle.Success).setDisabled(!session.targetChannelId),
    new ButtonBuilder().setCustomId('emb_reset').setLabel('🔄 Réinitialiser').setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2, row3];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('📝 Créer et envoyer un embed personnalisé')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction, client) {
    const session = getOrCreateSession(interaction.user.id);
    const preview = buildPreview(session, interaction.guild);

    const infoEmbed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('📝 Éditeur d\'Embeds')
      .setDescription('Utilisez le menu ci-dessous pour modifier votre embed. L\'aperçu se met à jour en temps réel.\nSélectionnez ensuite un salon et cliquez sur **Envoyer**.');

    const reply = await interaction.reply({
      embeds:     [infoEmbed, preview],
      components: buildEditorComponents(session),
      ephemeral:  true,
      fetchReply: true,
    });

    const col = reply.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time:   30 * 60 * 1000,
    });

    async function refresh(i) {
      const s       = getOrCreateSession(interaction.user.id);
      const preview = buildPreview(s, interaction.guild);
      return i.update({ embeds: [infoEmbed, preview], components: buildEditorComponents(s) });
    }

    col.on('collect', async i => {
      const s = getOrCreateSession(interaction.user.id);

      if (i.customId === 'emb_channel') {
        s.targetChannelId = i.values[0];
        return refresh(i);
      }

      if (i.customId === 'emb_reset') {
        sessions.delete(interaction.user.id);
        return refresh(i);
      }

      if (i.customId === 'emb_send') {
        if (!s.targetChannelId) return i.reply({ embeds: [errorEmbed('Salon requis', 'Sélectionnez d\'abord un salon.')], ephemeral: true });

        const channel = await interaction.guild.channels.fetch(s.targetChannelId).catch(() => null);
        if (!channel) return i.reply({ embeds: [errorEmbed('Salon introuvable', 'Impossible de trouver ce salon.')], ephemeral: true });

        const finalEmbed = buildPreview(s, interaction.guild);
        if (!s.title && !s.description) return i.reply({ embeds: [errorEmbed('Embed vide', 'Ajoutez au moins un titre ou une description.')], ephemeral: true });

        await channel.send({ embeds: [finalEmbed] });
        sessions.delete(interaction.user.id);
        return i.update({ embeds: [successEmbed('Embed envoyé!', `Votre embed a été envoyé dans <#${s.targetChannelId}>.`)], components: [] });
      }

      if (i.customId === 'emb_action') {
        const action = i.values[0];

        if (action === 'clear_fields') {
          s.fields = [];
          return refresh(i);
        }

        // Modaux pour les champs texte
        const modalConfigs = {
          edit_title:       { title: '📝 Modifier le titre',       fields: [{ id: 'val', label: 'Titre', max: 256, value: s.title }] },
          edit_description: { title: '📄 Modifier la description', fields: [{ id: 'val', label: 'Description', max: 4000, value: s.description, para: true }] },
          edit_color:       { title: '🎨 Modifier la couleur',     fields: [{ id: 'val', label: 'Couleur hex (ex: #5865F2)', max: 7, value: s.color.toString(16).padStart(6,'0') }] },
          edit_footer:      { title: '📌 Modifier le footer',      fields: [{ id: 'val', label: 'Texte du footer', max: 2048, value: s.footer }] },
          edit_image:       { title: '🖼️ URL de l\'image',          fields: [{ id: 'val', label: 'URL (https://...)', max: 500, value: s.imageURL }] },
          edit_thumbnail:   { title: '🖼️ URL du thumbnail',         fields: [{ id: 'val', label: 'URL (https://...)', max: 500, value: s.thumbnailURL }] },
          add_field:        { title: '➕ Ajouter un champ',         fields: [{ id: 'name', label: 'Nom du champ', max: 256, value: '' }, { id: 'value', label: 'Valeur', max: 1024, value: '', para: true }] },
        };

        const cfg   = modalConfigs[action];
        const modal = new ModalBuilder().setCustomId(`emb_modal_${action}`).setTitle(cfg.title);
        modal.addComponents(cfg.fields.map(f =>
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(f.id)
              .setLabel(f.label)
              .setStyle(f.para ? TextInputStyle.Paragraph : TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(f.max)
              .setValue(f.value || '')
          )
        ));
        return i.showModal(modal);
      }
    });

    // Modal submit (géré globalement dans interactionCreate via handleEmbedModal)
    col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
  },

  // Appelé depuis interactionCreate
  async handleEmbedModal(interaction) {
    const action = interaction.customId.replace('emb_modal_', '');
    const s      = getOrCreateSession(interaction.user.id);

    if (action === 'edit_title')       s.title        = interaction.fields.getTextInputValue('val').trim();
    if (action === 'edit_description') s.description  = interaction.fields.getTextInputValue('val').trim();
    if (action === 'edit_footer')      s.footer        = interaction.fields.getTextInputValue('val').trim();
    if (action === 'edit_image')       s.imageURL      = interaction.fields.getTextInputValue('val').trim();
    if (action === 'edit_thumbnail')   s.thumbnailURL  = interaction.fields.getTextInputValue('val').trim();

    if (action === 'edit_color') {
      const raw = interaction.fields.getTextInputValue('val').trim().replace('#', '');
      const hex = parseInt(raw, 16);
      if (!isNaN(hex)) s.color = hex;
    }

    if (action === 'add_field') {
      const name  = interaction.fields.getTextInputValue('name').trim();
      const value = interaction.fields.getTextInputValue('value').trim();
      if (name && value && s.fields.length < 25) {
        s.fields.push({ name, value, inline: false });
      }
    }

    return interaction.deferUpdate().catch(() => {});
  },
};
