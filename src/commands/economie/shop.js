// commands/shop.js  —  Boutique avec items achetables
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { ShopItem, Inventory } = require('../../models/Shop');
const Balance  = require('../../models/Balance');
const { COLORS, errorEmbed, successEmbed } = require('../../utils/embeds');
const { randomUUID } = require('crypto');

// ─── helpers ─────────────────────────────────────────────────────────────────
function shortId() { return randomUUID().split('-')[0]; }

function buildShopEmbed(items, guildName) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`🛒 Boutique — ${guildName}`)
    .setDescription('Utilisez `/shop acheter <id>` pour acheter un article.\nVotre solde : consultez `/balance`.')
    .setTimestamp();

  if (!items.length) {
    embed.addFields({ name: 'Aucun article', value: 'La boutique est vide pour l\'instant.' });
    return embed;
  }

  for (const item of items) {
    const stockStr = item.stock === -1 ? '∞' : `${item.stock}`;
    const typeEmoji = { role: '🎭', badge: '🏅', perk: '✨' }[item.type] || '📦';
    embed.addFields({
      name: `${typeEmoji} ${item.name} — \`ID: ${item.itemId}\``,
      value: [
        item.description || '*Pas de description*',
        `💰 **${item.price} 🪙** ・ Stock : ${stockStr} ・ Vendus : ${item.purchases}`,
      ].join('\n'),
    });
  }
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('🛒 Boutique du serveur')
    .addSubcommand(s => s.setName('voir').setDescription('Voir les articles disponibles'))
    .addSubcommand(s => s.setName('acheter').setDescription('Acheter un article')
      .addStringOption(o => o.setName('id').setDescription('ID de l\'article').setRequired(true)))
    .addSubcommand(s => s.setName('inventaire').setDescription('Voir tes achats'))
    .addSubcommand(s => s.setName('ajouter').setDescription('Ajouter un article *(Admin)*')
      .addStringOption(o => o.setName('nom').setDescription('Nom de l\'article').setRequired(true))
      .addIntegerOption(o => o.setName('prix').setDescription('Prix en coins').setRequired(true).setMinValue(1))
      .addStringOption(o => o.setName('type').setDescription('Type').setRequired(true)
        .addChoices(
          { name: '🎭 Rôle', value: 'role' },
          { name: '🏅 Badge', value: 'badge' },
          { name: '✨ Perk', value: 'perk' },
        ))
      .addRoleOption(o => o.setName('role').setDescription('Rôle attribué (si type = role)'))
      .addStringOption(o => o.setName('badge').setDescription('Emoji badge (si type = badge)'))
      .addStringOption(o => o.setName('description').setDescription('Description de l\'article'))
      .addIntegerOption(o => o.setName('stock').setDescription('Stock (-1 = illimité)').setMinValue(-1)))
    .addSubcommand(s => s.setName('supprimer').setDescription('Supprimer un article *(Admin)*')
      .addStringOption(o => o.setName('id').setDescription('ID de l\'article').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── /shop voir ────────────────────────────────────────────────────────
    if (sub === 'voir') {
      await interaction.deferReply();
      const items = await ShopItem.find({ guildId: interaction.guildId, enabled: true });
      return interaction.editReply({ embeds: [buildShopEmbed(items, interaction.guild.name)] });
    }

    // ── /shop acheter ─────────────────────────────────────────────────────
    if (sub === 'acheter') {
      await interaction.deferReply({ ephemeral: true });
      const itemId = interaction.options.getString('id');
      const item = await ShopItem.findOne({ guildId: interaction.guildId, itemId, enabled: true });

      if (!item) return interaction.editReply({ embeds: [errorEmbed('Introuvable', 'Cet article n\'existe pas dans la boutique.')] });
      if (item.stock === 0) return interaction.editReply({ embeds: [errorEmbed('Rupture', 'Cet article est en rupture de stock.')] });

      let balance = await Balance.findOne({ userId: interaction.user.id, guildId: interaction.guildId });
      if (!balance) balance = await Balance.create({ userId: interaction.user.id, guildId: interaction.guildId });

      if (balance.coins < item.price) {
        return interaction.editReply({
          embeds: [errorEmbed('Solde insuffisant', `Il te manque **${item.price - balance.coins} 🪙** pour acheter cet article.`)],
        });
      }

      // Déjà en possession ?
      if (item.type === 'role') {
        const already = await Inventory.findOne({ userId: interaction.user.id, guildId: interaction.guildId, itemId });
        if (already) return interaction.editReply({ embeds: [errorEmbed('Déjà possédé', 'Tu as déjà cet article.')] });
      }

      // Achat
      balance.coins -= item.price;
      await balance.save();

      item.purchases += 1;
      if (item.stock > 0) item.stock -= 1;
      await item.save();

      await Inventory.create({
        userId: interaction.user.id,
        guildId: interaction.guildId,
        itemId: item.itemId,
        name: item.name,
        type: item.type,
        roleId: item.roleId,
        badge: item.badge,
      });

      // Attribuer rôle si applicable
      if (item.type === 'role' && item.roleId) {
        const member = interaction.member;
        await member.roles.add(item.roleId).catch(() => {});
      }

      const embed = new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('✅ Achat réussi !')
        .addFields(
          { name: '🛒 Article', value: item.name, inline: true },
          { name: '💰 Prix payé', value: `${item.price} 🪙`, inline: true },
          { name: '💳 Solde restant', value: `${balance.coins} 🪙`, inline: true },
        )
        .setTimestamp();

      if (item.type === 'role' && item.roleId) {
        embed.setDescription(`Le rôle <@&${item.roleId}> t'a été attribué !`);
      }
      if (item.type === 'badge' && item.badge) {
        embed.setDescription(`Tu as reçu le badge **${item.badge}** !`);
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /shop inventaire ──────────────────────────────────────────────────
    if (sub === 'inventaire') {
      await interaction.deferReply({ ephemeral: true });
      const items = await Inventory.find({ userId: interaction.user.id, guildId: interaction.guildId });

      if (!items.length) {
        return interaction.editReply({ embeds: [errorEmbed('Inventaire vide', 'Tu n\'as pas encore acheté d\'articles.')] });
      }

      const typeEmoji = { role: '🎭', badge: '🏅', perk: '✨' };
      const desc = items.map(i => {
        const emoji = typeEmoji[i.type] || '📦';
        const extra = i.roleId ? ` → <@&${i.roleId}>` : i.badge ? ` → ${i.badge}` : '';
        return `${emoji} **${i.name}**${extra}`;
      }).join('\n');

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('🎒 Ton inventaire')
        .setDescription(desc)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /shop ajouter ─────────────────────────────────────────────────────
    if (sub === 'ajouter') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Vous devez être administrateur.')], ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });

      const { getLimit } = require('../../utils/premium');
      const limit = await getLimit(interaction.guildId, 'shopItems');
      const currentCount = await ShopItem.countDocuments({ guildId: interaction.guildId });
      if (currentCount >= limit) {
        return interaction.editReply({ embeds: [errorEmbed('Limite atteinte', `Tu as atteint la limite de **${limit} articles**.\nUtilise \`/premium\` pour voir comment débloquer plus.`)] });
      }

      const nom   = interaction.options.getString('nom');
      const prix  = interaction.options.getInteger('prix');
      const type  = interaction.options.getString('type');
      const role  = interaction.options.getRole('role');
      const badge = interaction.options.getString('badge');
      const desc  = interaction.options.getString('description') || '';
      const stock = interaction.options.getInteger('stock') ?? -1;
      const itemId = shortId();

      if (type === 'role' && !role) {
        return interaction.editReply({ embeds: [errorEmbed('Erreur', 'Vous devez spécifier un rôle pour un article de type "role".')] });
      }

      await ShopItem.create({
        guildId: interaction.guildId,
        itemId,
        name: nom,
        description: desc,
        price: prix,
        type,
        roleId: role?.id || null,
        badge: badge || null,
        stock,
      });

      const embed = new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('✅ Article ajouté')
        .addFields(
          { name: 'Nom',   value: nom,          inline: true },
          { name: 'Prix',  value: `${prix} 🪙`, inline: true },
          { name: 'Type',  value: type,          inline: true },
          { name: 'ID',    value: `\`${itemId}\``, inline: true },
          { name: 'Stock', value: stock === -1 ? 'Illimité' : `${stock}`, inline: true },
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /shop supprimer ───────────────────────────────────────────────────
    if (sub === 'supprimer') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée', 'Vous devez être administrateur.')], ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      const itemId = interaction.options.getString('id');
      const deleted = await ShopItem.findOneAndDelete({ guildId: interaction.guildId, itemId });

      if (!deleted) return interaction.editReply({ embeds: [errorEmbed('Introuvable', 'Aucun article avec cet ID.')] });

      return interaction.editReply({ embeds: [successEmbed('Article supprimé', `L'article \`${deleted.name}\` a été supprimé.`)] });
    }
  },
};
