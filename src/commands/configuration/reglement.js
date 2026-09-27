const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const Reglement = require('../../models/Reglement');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('reglement').setDescription('📜 Gérer le règlement interactif du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('ajouter').setDescription('Ajouter une règle')
      .addStringOption(o => o.setName('règle').setDescription('Texte de la règle').setRequired(true)))
    .addSubcommand(s => s.setName('publier').setDescription('Publier le règlement avec bouton d\'acceptation')
      .addChannelOption(o => o.setName('salon').setDescription('Salon').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addRoleOption(o => o.setName('rôle_acceptation').setDescription('Rôle donné après acceptation')))
    .addSubcommand(s => s.setName('voir').setDescription('Voir le règlement actuel'))
    .addSubcommand(s => s.setName('supprimer').setDescription('Supprimer une règle')
      .addIntegerOption(o => o.setName('numéro').setDescription('Numéro de la règle').setRequired(true).setMinValue(1))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    let reg = await Reglement.findOne({ guildId: interaction.guildId });
    if (!reg) reg = await Reglement.create({ guildId: interaction.guildId });

    if (sub === 'ajouter') {
      reg.rules.push(interaction.options.getString('règle'));
      await reg.save();
      return interaction.reply({ embeds: [successEmbed('Règle ajoutée', `#${reg.rules.length} — ${reg.rules[reg.rules.length-1]}`)], ephemeral: true });
    }

    if (sub === 'voir') {
      if (!reg.rules.length) return interaction.reply({ embeds: [errorEmbed('Vide', 'Aucune règle définie. Utilisez `/reglement ajouter`.')], ephemeral: true });
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('📜 Règlement')
        .setDescription(reg.rules.map((r,i) => `**${i+1}.** ${r}`).join('\n\n'))], ephemeral: true });
    }

    if (sub === 'supprimer') {
      const num = interaction.options.getInteger('numéro') - 1;
      if (!reg.rules[num]) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Numéro invalide.')], ephemeral: true });
      const removed = reg.rules.splice(num, 1);
      await reg.save();
      return interaction.reply({ embeds: [successEmbed('Règle supprimée', removed[0])], ephemeral: true });
    }

    if (sub === 'publier') {
      if (!reg.rules.length) return interaction.reply({ embeds: [errorEmbed('Vide', 'Ajoutez des règles avant de publier.')], ephemeral: true });
      const channel = interaction.options.getChannel('salon');
      const role    = interaction.options.getRole('rôle_acceptation');
      reg.channelId = channel.id;
      reg.acceptRoleId = role?.id || null;

      const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(`📜 Règlement — ${interaction.guild.name}`)
        .setDescription(reg.rules.map((r,i) => `**${i+1}.** ${r}`).join('\n\n'))
        .setFooter({ text: role ? 'Cliquez sur "J\'accepte" pour obtenir l\'accès au serveur' : 'Merci de respecter ces règles' });

      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('reglement_accept').setLabel('✅ J\'accepte le règlement').setStyle(ButtonStyle.Success));
      const msg = await channel.send({ embeds: [embed], components: role ? [row] : [] });
      reg.messageId = msg.id;
      await reg.save();
      return interaction.reply({ embeds: [successEmbed('Règlement publié', `Publié dans <#${channel.id}>`)], ephemeral: true });
    }
  },

  async handleAccept(interaction) {
    const reg = await Reglement.findOne({ guildId: interaction.guildId });
    if (!reg?.acceptRoleId) return interaction.reply({ content: '✅ Règlement accepté !', ephemeral: true });
    if (interaction.member.roles.cache.has(reg.acceptRoleId)) return interaction.reply({ content: '✅ Tu as déjà accepté le règlement.', ephemeral: true });
    await interaction.member.roles.add(reg.acceptRoleId).catch(() => {});
    return interaction.reply({ content: '✅ Règlement accepté ! Accès débloqué.', ephemeral: true });
  },
};
