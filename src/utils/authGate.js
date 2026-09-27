// utils/authGate.js — Verrou générique PIN pour actions sensibles (ban, raidmode, sécurité...)
// Usage : voir README_AUTH_PROFIL.md
'use strict';

const crypto = require('crypto');
const {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} = require('discord.js');
const { getOrCreateProfile, checkPin } = require('./authProfileManager');
const { COLORS } = require('../utils/embeds');

const TTL_MS = 3 * 60 * 1000; // 3 min pour saisir le PIN
const pending = new Map(); // token -> { userId, executor, payload, label, expiresAt }

function cleanup() {
  const now = Date.now();
  for (const [token, entry] of pending) {
    if (entry.expiresAt < now) pending.delete(token);
  }
}

/**
 * Protège une action sensible derrière le PIN de l'utilisateur (si configuré).
 * Si l'utilisateur n'a pas de PIN, l'action s'exécute directement (rien à vérifier).
 *
 * @param {Interaction} interaction - interaction d'origine (pas encore deferred/replied)
 * @param {Object} opts
 * @param {string} opts.label - libellé affiché dans le modal de confirmation
 * @param {Object} [opts.payload] - données nécessaires à l'exécution de l'action
 * @param {(itx: Interaction, payload: Object) => Promise<void>} opts.executor - exécute l'action réelle.
 *   `itx` est soit l'interaction d'origine (si pas de PIN configuré), soit l'interaction de
 *   confirmation du modal (si un PIN est configuré) — dans les deux cas non encore acquittée.
 */
async function protect(interaction, { label, payload = {}, executor }) {
  const profile = await getOrCreateProfile(interaction.user.id);

  if (!profile.pin.isSet) {
    return executor(interaction, payload);
  }

  cleanup();
  const token = crypto.randomBytes(8).toString('hex');
  pending.set(token, { userId: interaction.user.id, executor, payload, label, expiresAt: Date.now() + TTL_MS });

  const modal = new ModalBuilder()
    .setCustomId(`authgate_confirm_${token}`)
    .setTitle(`🔐 Confirmer : ${label}`.slice(0, 45));
  const pinInput = new TextInputBuilder()
    .setCustomId('pin')
    .setLabel('Entrez votre code PIN pour confirmer')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(8);
  modal.addComponents(new ActionRowBuilder().addComponents(pinInput));

  return interaction.showModal(modal);
}

/**
 * À appeler depuis interactionCreate.js pour tout customId commençant par `authgate_confirm_`.
 * Retourne true si l'interaction a été prise en charge.
 */
async function handleModal(interaction) {
  const id = interaction.customId;
  if (!id.startsWith('authgate_confirm_')) return false;

  const token = id.slice('authgate_confirm_'.length);
  const entry = pending.get(token);
  pending.delete(token);

  const errEmbed = (title, desc) => new EmbedBuilder().setColor(COLORS.error).setTitle(title).setDescription(desc);

  if (!entry || entry.expiresAt < Date.now()) {
    await interaction.reply({ embeds: [errEmbed('❌ Session expirée', 'Relancez la commande ou l\'action depuis le début.')], ephemeral: true }).catch(() => {});
    return true;
  }
  if (entry.userId !== interaction.user.id) {
    await interaction.reply({ embeds: [errEmbed('❌ Non autorisé', 'Cette confirmation ne vous appartient pas.')], ephemeral: true }).catch(() => {});
    return true;
  }

  const pinValue = interaction.fields.getTextInputValue('pin');
  const profile = await getOrCreateProfile(interaction.user.id);
  const check = await checkPin(profile, pinValue);

  if (check.locked) {
    await interaction.reply({ embeds: [errEmbed('🔒 Compte verrouillé', `Trop de tentatives échouées. Réessayez dans **${check.remainingMinutes} min**. Action annulée.`)], ephemeral: true }).catch(() => {});
    return true;
  }
  if (!check.ok) {
    await interaction.reply({ embeds: [errEmbed('❌ Code PIN incorrect', 'Action annulée par sécurité.')], ephemeral: true }).catch(() => {});
    return true;
  }

  try {
    await entry.executor(interaction, entry.payload);
  } catch (err) {
    console.error('❌ authGate executor:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [errEmbed('❌ Erreur', 'L\'action a échoué après confirmation du PIN.')] }).catch(() => {});
    } else {
      await interaction.reply({ embeds: [errEmbed('❌ Erreur', 'L\'action a échoué après confirmation du PIN.')], ephemeral: true }).catch(() => {});
    }
  }
  return true;
}

module.exports = { protect, handleModal };
