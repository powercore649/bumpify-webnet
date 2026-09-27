// utils/boostManager.js — Construit et envoie le message de boost, gère le rôle bonus
'use strict';
const { EmbedBuilder } = require('discord.js');

function fillPlaceholders(str, member) {
  if (!str) return str;
  const boostCount = member.guild.premiumSubscriptionCount ?? 0;
  const level = member.guild.premiumTier ?? 0;
  return str
    .replaceAll('{user}', member.user.tag)
    .replaceAll('{mention}', `<@${member.id}>`)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{boostcount}', String(boostCount))
    .replaceAll('{level}', String(level))
    .replaceAll('{membercount}', String(member.guild.memberCount));
}

function buildBoostEmbed(member, config) {
  const embed = new EmbedBuilder()
    .setColor(config.color || '#F47FFF')
    .setTitle(fillPlaceholders(config.title, member) || null)
    .setDescription(fillPlaceholders(config.description, member) || null)
    .setTimestamp();

  if (config.footerText) embed.setFooter({ text: fillPlaceholders(config.footerText, member) });
  if (config.imageUrl) embed.setImage(config.imageUrl);

  if (config.useAvatar) {
    embed.setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }));
  } else if (config.useServerIcon && member.guild.iconURL()) {
    embed.setThumbnail(member.guild.iconURL({ extension: 'png', size: 256 }));
  }

  return embed;
}

async function sendBoostMessage(member, config) {
  const embed = buildBoostEmbed(member, config);

  const channel = config.channelId
    ? await member.guild.channels.fetch(config.channelId).catch(() => null)
    : member.guild.systemChannel;

  if (channel?.isTextBased()) {
    const content = config.pingRoleId ? `<@&${config.pingRoleId}>` : null;
    await channel.send({ content, embeds: [embed] }).catch(err => console.error('❌ sendBoostMessage:', err.message));
  }

  // Rôle bonus automatique pour les boosters
  if (config.boosterRoleId && member.guild.roles.cache.has(config.boosterRoleId)) {
    await member.roles.add(config.boosterRoleId).catch(err => console.error('❌ boosterRoleId:', err.message));
  }
}

module.exports = { sendBoostMessage, buildBoostEmbed, fillPlaceholders };
