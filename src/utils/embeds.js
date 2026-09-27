const { EmbedBuilder } = require('discord.js');

const COLORS = {
  primary:  0x5865F2,
  success:  0x57F287,
  warning:  0xFEE75C,
  error:    0xED4245,
  info:     0x5BC0EB,
};

function successEmbed(title, description = null) {
  const e = new EmbedBuilder().setColor(COLORS.success).setTitle(`✅ ${title}`);
  if (description) e.setDescription(description);
  return e;
}

function errorEmbed(title, description = null) {
  const e = new EmbedBuilder().setColor(COLORS.error).setTitle(`❌ ${title}`);
  if (description) e.setDescription(description);
  return e;
}

function infoEmbed(title, description = null) {
  const e = new EmbedBuilder().setColor(COLORS.info).setTitle(`ℹ️ ${title}`);
  if (description) e.setDescription(description);
  return e;
}

function warningEmbed(title, description = null) {
  const e = new EmbedBuilder().setColor(COLORS.warning).setTitle(`⚠️ ${title}`);
  if (description) e.setDescription(description);
  return e;
}

module.exports = { successEmbed, errorEmbed, infoEmbed, warningEmbed, COLORS };
