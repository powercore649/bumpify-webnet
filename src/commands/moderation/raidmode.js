const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const AutoMod = require('../../models/AutoMod');
const { COLORS } = require('../../utils/embeds');
const authGate = require('../../utils/authGate');

async function triggerRaidMode(guild, enable) {
  let locked = 0;
  for (const [, ch] of guild.channels.cache) {
    if (ch.isTextBased() && !ch.isThread()) {
      try {
        await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: enable ? false : null });
        locked++;
      } catch (_) {}
    }
  }

  await AutoMod.findOneAndUpdate({ guildId: guild.id }, { raidEnabled: enable }, { upsert: true });

  return locked;
}

async function getOrCreateAutoMod(guildId) {
  let cfg = await AutoMod.findOne({ guildId });
  if (!cfg) cfg = await AutoMod.create({ guildId });
  return cfg;
}

module.exports = {
  triggerRaidMode,
  getOrCreateAutoMod,

  data: new SlashCommandBuilder().setName('raidmode').setDescription('🚨 Activer/désactiver le mode anti-raid d\'urgence (verrouille tout)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(o => o.setName('activer').setDescription('Activer (true) ou désactiver (false)').setRequired(true)),

  async execute(interaction) {
    const enable = interaction.options.getBoolean('activer');

    return authGate.protect(interaction, {
      label: enable ? 'Activer le mode raid d\'urgence' : 'Désactiver le mode raid',
      payload: { enable },
      executor: async (itx, payload) => {
        await itx.deferReply({ ephemeral: itx.isModalSubmit?.() ? true : false });

        const locked = await triggerRaidMode(itx.guild, payload.enable);

        const embed = new EmbedBuilder()
          .setColor(payload.enable ? COLORS.error : COLORS.success)
          .setTitle(payload.enable ? '🚨 MODE RAID ACTIVÉ' : '✅ Mode raid désactivé')
          .setDescription(payload.enable
            ? `**${locked} salons verrouillés.** Personne ne peut écrire sauf les modérateurs.\nDésactive avec \`/raidmode activer:false\` quand la situation est sous contrôle.`
            : `**${locked} salons déverrouillés.** Le serveur reprend son fonctionnement normal.`)
          .setTimestamp();
        return itx.editReply({ embeds: [embed] });
      },
    });
  },
};
