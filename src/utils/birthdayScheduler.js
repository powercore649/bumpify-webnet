const Birthday = require('../models/Birthday');
const BirthdayConfig = require('../models/BirthdayConfig');
const { EmbedBuilder } = require('discord.js');

// Exécuté une fois par jour (voir index.js). Pour chaque serveur ayant le
// système activé : annonce les anniversaires du jour, donne le rôle dédié
// s'il est configuré, et retire ce même rôle à ceux dont ce n'était PAS
// l'anniversaire hier (pour que le rôle ne reste pas indéfiniment).
async function checkBirthdays(client) {
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const configs = await BirthdayConfig.find({ enabled: true });

  for (const config of configs) {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) continue;

    // ── Retirer le rôle "anniversaire" à ceux qui l'ont mais dont ce n'est plus le jour ──
    if (config.roleId) {
      const role = guild.roles.cache.get(config.roleId);
      if (role) {
        const stillBirthdayToday = await Birthday.find({ guildId: config.guildId, day, month }).distinct('userId');
        for (const member of role.members.values()) {
          if (!stillBirthdayToday.includes(member.id)) {
            await member.roles.remove(role).catch(() => {});
          }
        }
      }
    }

    // ── Trouver les anniversaires du jour, pas déjà annoncés cette année ──
    const todaysBirthdays = await Birthday.find({
      guildId: config.guildId,
      day,
      month,
      $or: [{ lastAnnouncedYear: { $ne: year } }, { lastAnnouncedYear: null }],
    });

    if (todaysBirthdays.length === 0) continue;

    const channel = config.channelId ? guild.channels.cache.get(config.channelId) : null;

    for (const bday of todaysBirthdays) {
      const member = await guild.members.fetch(bday.userId).catch(() => null);
      if (!member) continue;

      if (config.roleId) {
        const role = guild.roles.cache.get(config.roleId);
        if (role) await member.roles.add(role).catch(() => {});
      }

      if (channel) {
        const text = config.message
          .replace(/{user}/g, `<@${member.id}>`)
          .replace(/{server}/g, guild.name);

        const embed = new EmbedBuilder()
          .setColor(0xf2a93b)
          .setTitle('🎂 Anniversaire !')
          .setDescription(text)
          .setThumbnail(member.displayAvatarURL())
          .setTimestamp();

        const content = config.pingRoleId ? `<@&${config.pingRoleId}>` : undefined;
        await channel.send({ content, embeds: [embed] }).catch(() => {});
      }

      bday.lastAnnouncedYear = year;
      await bday.save();
    }
  }
}

module.exports = { checkBirthdays };
