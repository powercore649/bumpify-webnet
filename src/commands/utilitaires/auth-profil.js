// commands/auth-profil.js — Panneau d'authentification personnel (PIN · 2FA · Passkeys)
// Système autonome : toute la logique (rendu + boutons + modaux + menus) vit dans ce fichier.
// Routage externe minimal requis dans events/interactionCreate.js (voir README_AUTH.md).
'use strict';

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} = require('discord.js');

const crypto = require('crypto');
const totp = require('../../utils/totp');
const {
  getOrCreateProfile,
  addLog,
  formatLog,
  computeGrade,
  checkPin,
  hashSecret,
  isPinWeak,
  encrypt,
  decrypt,
  MAX_PASSKEYS,
  FORGOT_DELAY_MS,
} = require('../../utils/authProfileManager');
const { COLORS } = require('../../utils/embeds');

const PENDING_2FA_TTL_MS = 10 * 60 * 1000; // 10 min pour finaliser l'activation 2FA

// ─── Construction du panneau principal ───────────────────────────────────────
function buildPanel(user, profile) {
  const { grade, emoji, color, tip } = computeGrade(profile);

  const pinLine = profile.pin.isSet
    ? `🟢 **Défini** ${profile.pin.weak ? '· ⚠️ Simple' : '· Robuste'}`
    : '🔴 **Non défini**';

  const twofaLine = profile.twoFA.enabled ? '🟢 **Activée**' : '🔴 **Désactivée**';

  const activePasskeys = profile.passkeys.filter(p => !p.used);
  const passkeyLine = activePasskeys.length > 0
    ? `🟢 **${activePasskeys.length}** actives`
    : '🔴 **Aucune**';

  const recentLogs = profile.logs.slice(0, 3);
  const logsLine = recentLogs.length > 0
    ? recentLogs.map(formatLog).join('\n')
    : '*Aucune activité récente*';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `@${user.username}`, iconURL: user.displayAvatarURL() })
    .setTitle('🔐 Profil d\'authentification')
    .setDescription('Sécurisez vos actions sensibles avec un code PIN, la 2FA et des Passkeys.')
    .addFields(
      { name: '🔢 Code PIN', value: pinLine, inline: true },
      { name: '⏱️ Code 2FA', value: twofaLine, inline: true },
      { name: '🔑 Passkeys', value: passkeyLine, inline: true },
      { name: '📋 Activité récente', value: logsLine, inline: false },
    )
    .setFooter({ text: `Grade de Sécurité : ${grade} — ${tip}` })
    .setTimestamp();

  if (profile.forgot?.pending) {
    const ready = profile.forgot.unlockAt && profile.forgot.unlockAt <= new Date();
    embed.addFields({
      name: '🆘 Réinitialisation en cours',
      value: ready
        ? 'Le délai de sûreté est écoulé — vous pouvez finaliser la réinitialisation.'
        : `Disponible <t:${Math.floor(new Date(profile.forgot.unlockAt).getTime() / 1000)}:R>`,
    });
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('auth_pin_modify').setLabel(profile.pin.isSet ? 'Modifier le PIN' : 'Définir un PIN').setStyle(ButtonStyle.Primary).setEmoji('🔢'),
    profile.twoFA.enabled
      ? new ButtonBuilder().setCustomId('auth_2fa_disable').setLabel('Désactiver la 2FA').setStyle(ButtonStyle.Danger).setEmoji('⏱️')
      : new ButtonBuilder().setCustomId('auth_2fa_start').setLabel('Activer la 2FA').setStyle(ButtonStyle.Success).setEmoji('⏱️'),
    new ButtonBuilder().setCustomId('auth_passkey_add').setLabel('Ajouter un Passkey').setStyle(ButtonStyle.Success).setEmoji('🔑').setDisabled(activePasskeys.length >= MAX_PASSKEYS),
  );

  const row2Buttons = [];
  if (activePasskeys.length > 0) {
    row2Buttons.push(new ButtonBuilder().setCustomId('auth_passkey_manage').setLabel('Gérer mes Passkeys').setStyle(ButtonStyle.Secondary).setEmoji('🗂️'));
  }
  row2Buttons.push(
    new ButtonBuilder().setCustomId('auth_logs_all').setLabel('Voir tous les logs').setStyle(ButtonStyle.Secondary).setEmoji('📋'),
    new ButtonBuilder().setCustomId('auth_refresh').setLabel('Actualiser').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
  );
  const row2 = new ActionRowBuilder().addComponents(...row2Buttons);

  const row3 = new ActionRowBuilder().addComponents(
    profile.forgot?.pending
      ? (profile.forgot.unlockAt && profile.forgot.unlockAt <= new Date()
          ? new ButtonBuilder().setCustomId('auth_forgot_finalize').setLabel('Finaliser la réinitialisation').setStyle(ButtonStyle.Danger).setEmoji('🆘')
          : new ButtonBuilder().setCustomId('auth_forgot_cancel').setLabel('Annuler la réinitialisation').setStyle(ButtonStyle.Secondary).setEmoji('✖️'))
      : new ButtonBuilder().setCustomId('auth_forgot').setLabel('J\'ai oublié mes auths').setStyle(ButtonStyle.Danger).setEmoji('🆘'),
  );

  return { embeds: [embed], components: [row1, row2, row3] };
}

// ─── Rendu générique (update si possible, sinon reply/editReply) ────────────
async function render(interaction, profile) {
  const payload = buildPanel(interaction.user, profile);
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  if (typeof interaction.update === 'function' && !interaction.isChatInputCommand()) {
    return interaction.update(payload).catch(() => interaction.reply({ ...payload, ephemeral: true }));
  }
  return interaction.reply({ ...payload, ephemeral: true });
}

function simpleEmbed(color, title, description) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description);
}

const backRow = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('auth_back').setLabel('Retour au profil').setStyle(ButtonStyle.Secondary).setEmoji('↩️'),
);

// ═══════════════════════════════════════════════════════════════════════════
module.exports = {
  data: new SlashCommandBuilder()
    .setName('auth-profil')
    .setDescription('Gérer votre profil d\'authentification personnel (PIN, 2FA, Passkeys)'),

  async execute(interaction) {
    const profile = await getOrCreateProfile(interaction.user.id);
    const payload = buildPanel(interaction.user, profile);
    await interaction.reply({ ...payload, ephemeral: true });
  },

  // ─── Boutons ────────────────────────────────────────────────────────────
  async handleButton(interaction) {
    const id = interaction.customId;
    const profile = await getOrCreateProfile(interaction.user.id);

    // ── Retour / actualisation ──
    if (id === 'auth_back' || id === 'auth_refresh') {
      return render(interaction, profile);
    }

    // ── PIN ──
    if (id === 'auth_pin_modify') {
      const modal = new ModalBuilder().setCustomId('auth_pin_modal').setTitle(profile.pin.isSet ? 'Modifier votre code PIN' : 'Définir votre code PIN');
      const oldPin = new TextInputBuilder()
        .setCustomId('old_pin').setLabel('PIN actuel (laisser vide si aucun)')
        .setStyle(TextInputStyle.Short).setRequired(false).setMinLength(0).setMaxLength(8);
      const newPin = new TextInputBuilder()
        .setCustomId('new_pin').setLabel('Nouveau PIN (4 à 8 chiffres)')
        .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(4).setMaxLength(8);
      const confirmPin = new TextInputBuilder()
        .setCustomId('confirm_pin').setLabel('Confirmez le nouveau PIN')
        .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(4).setMaxLength(8);
      modal.addComponents(
        new ActionRowBuilder().addComponents(oldPin),
        new ActionRowBuilder().addComponents(newPin),
        new ActionRowBuilder().addComponents(confirmPin),
      );
      return interaction.showModal(modal);
    }

    // ── 2FA : démarrage ──
    if (id === 'auth_2fa_start') {
      if (profile.twoFA.enabled) return render(interaction, profile);

      const secret = totp.generateSecret();
      profile.twoFA.pendingSecretEnc = encrypt(secret);
      profile.twoFA.pendingCreatedAt = new Date();
      await profile.save();

      const uri = totp.generateURI(secret, interaction.user.username, 'Bumpify');
      const embed = simpleEmbed(
        COLORS.info,
        '⏱️ Activer la double authentification (2FA)',
        [
          '**1.** Ouvrez une application d\'authentification (Google Authenticator, Authy, etc.)',
          '**2.** Ajoutez un compte manuellement avec la clé secrète ci-dessous :',
          `\`\`\`${secret}\`\`\``,
          `Ou via ce lien (à copier dans une app compatible) :\n\`${uri}\``,
          '**3.** Cliquez sur "Vérifier le code" et entrez le code à 6 chiffres généré.',
          '',
          '⚠️ Ce secret expire dans 10 minutes si non confirmé.',
        ].join('\n'),
      );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('auth_2fa_verify_open').setLabel('Vérifier le code').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId('auth_back').setLabel('Annuler').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
      );
      return interaction.update({ embeds: [embed], components: [row] }).catch(() => interaction.reply({ embeds: [embed], components: [row], ephemeral: true }));
    }

    // ── 2FA : ouvrir le modal de vérification ──
    if (id === 'auth_2fa_verify_open') {
      if (!profile.twoFA.pendingSecretEnc || (Date.now() - new Date(profile.twoFA.pendingCreatedAt).getTime()) > PENDING_2FA_TTL_MS) {
        profile.twoFA.pendingSecretEnc = null;
        profile.twoFA.pendingCreatedAt = null;
        await profile.save();
        const embed = simpleEmbed(COLORS.error, '❌ Session expirée', 'Veuillez relancer l\'activation de la 2FA.');
        return interaction.update({ embeds: [embed], components: [backRow] }).catch(() => interaction.reply({ embeds: [embed], components: [backRow], ephemeral: true }));
      }
      const modal = new ModalBuilder().setCustomId('auth_2fa_modal').setTitle('Vérification du code 2FA');
      const code = new TextInputBuilder().setCustomId('code').setLabel('Code à 6 chiffres').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(6).setMaxLength(6);
      modal.addComponents(new ActionRowBuilder().addComponents(code));
      return interaction.showModal(modal);
    }

    // ── 2FA : désactivation ──
    if (id === 'auth_2fa_disable') {
      if (!profile.pin.isSet) {
        const embed = simpleEmbed(COLORS.warning, '⚠️ Confirmer la désactivation', 'Vous êtes sur le point de désactiver la 2FA. Confirmez-vous ?');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('auth_2fa_disable_confirm').setLabel('Confirmer').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('auth_back').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
        );
        return interaction.update({ embeds: [embed], components: [row] }).catch(() => interaction.reply({ embeds: [embed], components: [row], ephemeral: true }));
      }
      const modal = new ModalBuilder().setCustomId('auth_2fa_disable_modal').setTitle('Désactiver la 2FA');
      const pin = new TextInputBuilder().setCustomId('pin').setLabel('Confirmez avec votre code PIN').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(4).setMaxLength(8);
      modal.addComponents(new ActionRowBuilder().addComponents(pin));
      return interaction.showModal(modal);
    }

    if (id === 'auth_2fa_disable_confirm') {
      profile.twoFA.enabled = false;
      profile.twoFA.secretEnc = null;
      profile.twoFA.enabledAt = null;
      await profile.save();
      await addLog(profile, 'twofa_disabled');
      return render(interaction, profile);
    }

    // ── Passkeys : ajout ──
    if (id === 'auth_passkey_add') {
      const activePasskeys = profile.passkeys.filter(p => !p.used);
      if (activePasskeys.length >= MAX_PASSKEYS) {
        const embed = simpleEmbed(COLORS.warning, '⚠️ Limite atteinte', `Vous ne pouvez pas avoir plus de **${MAX_PASSKEYS}** Passkeys actives. Révoquez-en une avant d'en ajouter une nouvelle.`);
        return interaction.update({ embeds: [embed], components: [backRow] }).catch(() => interaction.reply({ embeds: [embed], components: [backRow], ephemeral: true }));
      }

      const rawCode = crypto.randomBytes(9).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
      const { hash, salt } = hashSecret(rawCode);
      const passkeyId = crypto.randomBytes(4).toString('hex');
      const label = `Passkey #${profile.passkeys.length + 1}`;
      profile.passkeys.push({ id: passkeyId, label, codeHash: hash, salt, createdAt: new Date() });
      await profile.save();
      await addLog(profile, 'passkey_added', label);

      const embed = simpleEmbed(
        COLORS.success,
        '🔑 Passkey créée',
        [
          `Votre nouveau code de secours **${label}** :`,
          `\`\`\`${rawCode}\`\`\``,
          '⚠️ **Notez-le maintenant** — il ne sera plus jamais affiché. Ce code agit comme une clé physique : conservez-le en lieu sûr.',
        ].join('\n'),
      );
      // Tentative d'envoi en DM pour une sauvegarde supplémentaire
      await interaction.user.send({ embeds: [simpleEmbed(COLORS.success, '🔑 Nouvelle Passkey — copie de sauvegarde', `Code pour **${label}** :\n\`\`\`${rawCode}\`\`\``)] }).catch(() => {});

      return interaction.update({ embeds: [embed], components: [backRow] }).catch(() => interaction.reply({ embeds: [embed], components: [backRow], ephemeral: true }));
    }

    // ── Passkeys : gestion / révocation ──
    if (id === 'auth_passkey_manage') {
      const activePasskeys = profile.passkeys.filter(p => !p.used);
      if (activePasskeys.length === 0) return render(interaction, profile);

      const menu = new StringSelectMenuBuilder()
        .setCustomId('auth_passkey_select_revoke')
        .setPlaceholder('Sélectionnez une Passkey à révoquer...')
        .addOptions(activePasskeys.map(p => ({
          label: p.label,
          value: p.id,
          description: `Créée le ${new Date(p.createdAt).toLocaleDateString('fr-FR')}`,
          emoji: '🔑',
        })));
      const embed = simpleEmbed(COLORS.info, '🗂️ Gérer mes Passkeys', 'Sélectionnez une Passkey ci-dessous pour la révoquer définitivement.');
      const row = new ActionRowBuilder().addComponents(menu);
      return interaction.update({ embeds: [embed], components: [row, backRow] }).catch(() => interaction.reply({ embeds: [embed], components: [row, backRow], ephemeral: true }));
    }

    // ── Logs complets ──
    if (id === 'auth_logs_all') {
      const logs = profile.logs.slice(0, 25);
      const description = logs.length > 0 ? logs.map(formatLog).join('\n') : '*Aucune activité enregistrée.*';
      const embed = simpleEmbed(COLORS.info, '📋 Historique complet', description.slice(0, 4000));
      return interaction.update({ embeds: [embed], components: [backRow] }).catch(() => interaction.reply({ embeds: [embed], components: [backRow], ephemeral: true }));
    }

    // ── J'ai oublié mes auths ──
    if (id === 'auth_forgot') {
      const embed = simpleEmbed(
        COLORS.warning,
        '🆘 Réinitialiser tous mes moyens d\'authentification',
        [
          'Cette action va **supprimer votre PIN, votre 2FA et toutes vos Passkeys**.',
          `Un délai de sûreté de **${Math.round(FORGOT_DELAY_MS / 60000)} minutes** sera appliqué avant que la réinitialisation puisse être finalisée, pour votre sécurité.`,
          '',
          'Confirmez-vous cette demande ?',
        ].join('\n'),
      );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('auth_forgot_confirm').setLabel('Oui, réinitialiser').setStyle(ButtonStyle.Danger).setEmoji('🆘'),
        new ButtonBuilder().setCustomId('auth_back').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
      );
      return interaction.update({ embeds: [embed], components: [row] }).catch(() => interaction.reply({ embeds: [embed], components: [row], ephemeral: true }));
    }

    if (id === 'auth_forgot_confirm') {
      profile.forgot.pending = true;
      profile.forgot.requestedAt = new Date();
      profile.forgot.unlockAt = new Date(Date.now() + FORGOT_DELAY_MS);
      await profile.save();
      await addLog(profile, 'forgot_requested');
      await interaction.user.send({
        embeds: [simpleEmbed(COLORS.warning, '🆘 Demande de réinitialisation reçue', 'Si vous n\'êtes pas à l\'origine de cette demande, reconnectez-vous immédiatement et annulez-la depuis `/auth-profil`.')],
      }).catch(() => {});
      return render(interaction, profile);
    }

    if (id === 'auth_forgot_cancel') {
      profile.forgot.pending = false;
      profile.forgot.requestedAt = null;
      profile.forgot.unlockAt = null;
      await profile.save();
      await addLog(profile, 'forgot_cancelled');
      return render(interaction, profile);
    }

    if (id === 'auth_forgot_finalize') {
      if (!profile.forgot.pending || !profile.forgot.unlockAt || profile.forgot.unlockAt > new Date()) {
        return render(interaction, profile);
      }
      profile.pin = { hash: null, salt: null, isSet: false, weak: false, updatedAt: null, failedAttempts: 0, lockedUntil: null };
      profile.twoFA = { enabled: false, secretEnc: null, enabledAt: null, pendingSecretEnc: null, pendingCreatedAt: null };
      profile.passkeys = [];
      profile.forgot = { pending: false, requestedAt: null, unlockAt: null };
      await profile.save();
      await addLog(profile, 'forgot_completed');
      const embed = simpleEmbed(COLORS.success, '✅ Réinitialisation terminée', 'Tous vos moyens d\'authentification ont été supprimés. Vous pouvez en configurer de nouveaux dès maintenant.');
      return interaction.update({ embeds: [embed], components: [backRow] }).catch(() => interaction.reply({ embeds: [embed], components: [backRow], ephemeral: true }));
    }

    return render(interaction, profile);
  },

  // ─── Menus de sélection ───────────────────────────────────────────────────
  async handleSelectMenu(interaction) {
    if (interaction.customId !== 'auth_passkey_select_revoke') return;
    const profile = await getOrCreateProfile(interaction.user.id);
    const targetId = interaction.values[0];
    const passkey = profile.passkeys.find(p => p.id === targetId);
    if (!passkey) return render(interaction, profile);

    passkey.used = true; // révoquée = considérée consommée / invalide
    await profile.save();
    await addLog(profile, 'passkey_revoked', passkey.label);

    return render(interaction, profile);
  },

  // ─── Modaux ────────────────────────────────────────────────────────────
  async handleModal(interaction) {
    const id = interaction.customId;
    const profile = await getOrCreateProfile(interaction.user.id);

    // ── Définir / modifier le PIN ──
    if (id === 'auth_pin_modal') {
      const oldPin = interaction.fields.getTextInputValue('old_pin')?.trim();
      const newPin = interaction.fields.getTextInputValue('new_pin')?.trim();
      const confirmPin = interaction.fields.getTextInputValue('confirm_pin')?.trim();

      if (profile.pin.isSet) {
        if (!oldPin) {
          return interaction.reply({ embeds: [simpleEmbed(COLORS.error, '❌ PIN actuel requis', 'Vous devez saisir votre PIN actuel pour le modifier.')], components: [backRow], ephemeral: true });
        }
        const check = await checkPin(profile, oldPin);
        if (check.locked) {
          return interaction.reply({ embeds: [simpleEmbed(COLORS.error, '🔒 Compte verrouillé', `Trop de tentatives échouées. Réessayez dans **${check.remainingMinutes} min**.`)], components: [backRow], ephemeral: true });
        }
        if (!check.ok) {
          return interaction.reply({ embeds: [simpleEmbed(COLORS.error, '❌ PIN incorrect', 'Le PIN actuel saisi est incorrect.')], components: [backRow], ephemeral: true });
        }
      }

      if (!/^\d{4,8}$/.test(newPin)) {
        return interaction.reply({ embeds: [simpleEmbed(COLORS.error, '❌ Format invalide', 'Le nouveau PIN doit contenir entre 4 et 8 chiffres.')], components: [backRow], ephemeral: true });
      }
      if (newPin !== confirmPin) {
        return interaction.reply({ embeds: [simpleEmbed(COLORS.error, '❌ Les PIN ne correspondent pas', 'Les deux champs doivent être identiques.')], components: [backRow], ephemeral: true });
      }

      const wasSet = profile.pin.isSet;
      const weak = isPinWeak(newPin);
      const { hash, salt } = hashSecret(newPin);
      profile.pin.hash = hash;
      profile.pin.salt = salt;
      profile.pin.isSet = true;
      profile.pin.weak = weak;
      profile.pin.updatedAt = new Date();
      profile.pin.failedAttempts = 0;
      profile.pin.lockedUntil = null;
      await profile.save();
      await addLog(profile, wasSet ? 'pin_changed' : 'pin_set');

      const embed = simpleEmbed(COLORS.success, '✅ Code PIN enregistré', weak ? '⚠️ Ce PIN est simple à deviner. Pensez à en choisir un plus robuste (évitez les suites ou répétitions).' : 'Votre code PIN a été mis à jour avec succès.');
      if (interaction.isFromMessage && interaction.isFromMessage()) {
        return interaction.update({ embeds: [embed], components: [backRow] }).catch(() => interaction.reply({ embeds: [embed], components: [backRow], ephemeral: true }));
      }
      return interaction.reply({ embeds: [embed], components: [backRow], ephemeral: true });
    }

    // ── Vérification 2FA (activation) ──
    if (id === 'auth_2fa_modal') {
      const code = interaction.fields.getTextInputValue('code')?.trim();
      if (!profile.twoFA.pendingSecretEnc || (Date.now() - new Date(profile.twoFA.pendingCreatedAt).getTime()) > PENDING_2FA_TTL_MS) {
        profile.twoFA.pendingSecretEnc = null;
        profile.twoFA.pendingCreatedAt = null;
        await profile.save();
        return interaction.reply({ embeds: [simpleEmbed(COLORS.error, '❌ Session expirée', 'Relancez l\'activation de la 2FA depuis le profil.')], components: [backRow], ephemeral: true });
      }

      const secret = decrypt(profile.twoFA.pendingSecretEnc);
      const valid = totp.verifyTOTP(secret, code, { window: 1 });
      if (!valid) {
        return interaction.reply({ embeds: [simpleEmbed(COLORS.error, '❌ Code invalide', 'Le code saisi est incorrect ou expiré. Réessayez avec le code actuel de votre application.')], components: [backRow], ephemeral: true });
      }

      profile.twoFA.enabled = true;
      profile.twoFA.secretEnc = profile.twoFA.pendingSecretEnc;
      profile.twoFA.enabledAt = new Date();
      profile.twoFA.pendingSecretEnc = null;
      profile.twoFA.pendingCreatedAt = null;
      await profile.save();
      await addLog(profile, 'twofa_enabled');

      const embed = simpleEmbed(COLORS.success, '✅ 2FA activée', 'La double authentification protège désormais votre profil.');
      if (interaction.isFromMessage && interaction.isFromMessage()) {
        return interaction.update({ embeds: [embed], components: [backRow] }).catch(() => interaction.reply({ embeds: [embed], components: [backRow], ephemeral: true }));
      }
      return interaction.reply({ embeds: [embed], components: [backRow], ephemeral: true });
    }

    // ── Désactivation 2FA via PIN ──
    if (id === 'auth_2fa_disable_modal') {
      const pin = interaction.fields.getTextInputValue('pin')?.trim();
      const check = await checkPin(profile, pin);
      if (check.locked) {
        return interaction.reply({ embeds: [simpleEmbed(COLORS.error, '🔒 Compte verrouillé', `Trop de tentatives échouées. Réessayez dans **${check.remainingMinutes} min**.`)], components: [backRow], ephemeral: true });
      }
      if (!check.ok) {
        return interaction.reply({ embeds: [simpleEmbed(COLORS.error, '❌ PIN incorrect', 'Impossible de désactiver la 2FA.')], components: [backRow], ephemeral: true });
      }

      profile.twoFA.enabled = false;
      profile.twoFA.secretEnc = null;
      profile.twoFA.enabledAt = null;
      await profile.save();
      await addLog(profile, 'twofa_disabled');

      const embed = simpleEmbed(COLORS.success, '✅ 2FA désactivée', 'La double authentification a été désactivée.');
      if (interaction.isFromMessage && interaction.isFromMessage()) {
        return interaction.update({ embeds: [embed], components: [backRow] }).catch(() => interaction.reply({ embeds: [embed], components: [backRow], ephemeral: true }));
      }
      return interaction.reply({ embeds: [embed], components: [backRow], ephemeral: true });
    }
  },
};
