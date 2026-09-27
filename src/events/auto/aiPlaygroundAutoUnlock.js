'use strict';
// events/aiPlaygroundAutoUnlock.js — Vérifie périodiquement les salons AI Playground
// verrouillés et les déverrouille automatiquement dès qu'un modèle redevient disponible.
// Fichier indépendant (comme bumpPersonalReminders.js) : plusieurs listeners 'ready'
// coexistent sans conflit.

const { EmbedBuilder } = require('discord.js');
const AiPlaygroundConfig = require('../../models/AiPlaygroundConfig');
const { getStatusMap } = require('../../utils/aiService');
const { pickAvailableModel } = require('../../utils/aiQuotaEngine');
const { COLORS } = require('../../utils/embeds');

const CHECK_INTERVAL_MS = 2 * 60 * 1000;

async function checkLockedPlaygrounds(client) {
  try {
    const lockedConfigs = await AiPlaygroundConfig.find({ locked: true, channelId: { $ne: null } });

    for (const cfg of lockedConfigs) {
      try {
        const statusMap = await getStatusMap(cfg.modelChain);
        const pick = pickAvailableModel(cfg.modelChain, statusMap, new Date());
        if (pick.allExhausted) continue; // toujours indisponible, on repasse au prochain cycle

        const guild = await client.guilds.fetch(cfg.guildId).catch(() => null);
        if (!guild) continue;

        cfg.locked = false;
        cfg.lockedReason = null;
        cfg.lockedAt = null;
        await cfg.save();

        const { applyChannelLockState } = require('../../commands/utilitaires/ai-playground');
        await applyChannelLockState(guild, cfg).catch(() => {});

        const channel = guild.channels.cache.get(cfg.channelId) || await guild.channels.fetch(cfg.channelId).catch(() => null);
        if (channel?.isTextBased()) {
          await channel.send({
            embeds: [new EmbedBuilder()
              .setColor(COLORS.success)
              .setTitle('🔓 Salon déverrouillé')
              .setDescription(`Le modèle \`${pick.model}\` est de nouveau disponible. Vous pouvez à nouveau discuter avec l'IA ici !`)],
          }).catch(() => {});
        }
      } catch (err) {
        console.error(`❌ aiPlaygroundAutoUnlock (${cfg.guildId}):`, err.message);
      }
    }
  } catch (err) {
    console.error('❌ aiPlaygroundAutoUnlock:', err.message);
  }
}

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    checkLockedPlaygrounds(client);
    setInterval(() => checkLockedPlaygrounds(client), CHECK_INTERVAL_MS);
  },
};
