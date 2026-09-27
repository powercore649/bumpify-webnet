// events/guildMemberUpdate.js — Détecte les boosts (premiumSince: null → date)
const { EmbedBuilder } = require('discord.js');
const BoostConfig = require('../../models/BoostConfig');
const { sendBoostMessage } = require('../../utils/boostManager');

module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    try {
      // Un membre vient de commencer à booster (transition null → date)
      const justBoosted = !oldMember.premiumSinceTimestamp && newMember.premiumSinceTimestamp;
      if (!justBoosted) return;

      const config = await BoostConfig.findOne({ guildId: newMember.guild.id });
      if (!config || !config.enabled) return;

      await sendBoostMessage(newMember, config);
    } catch (err) {
      console.error('❌ guildMemberUpdate (boost):', err.message);
    }
  },
};
