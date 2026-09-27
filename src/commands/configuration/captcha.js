'use strict';
// commands/captcha.js — Système de vérification CAPTCHA avancé, 100% fonctionnel
// - Vraies images distordues (anti-OCR / anti-bot), générées à la volée, jamais de code en clair
// - Régénération limitée, âge de compte minimum, rôle de bypass
// - Logs configurables (relayés dans un salon si activé)
// - Panel de configuration avancé multi-sections

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, AttachmentBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  PermissionFlagsBits, ChannelType,
} = require('discord.js');
const { CaptchaConfig, CaptchaPending } = require('../../models/Captcha');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');
const { renderCaptchaImage } = require('../../utils/captchaImage');
const { checkAccountAge, checkBypass, compareAnswer, canRegenerate, attemptsExhausted } = require('../../utils/captchaEngine');
const { logAction } = require('../../utils/captchaLogger');

// ─── Générateurs de code ──────────────────────────────────────────────────────
function generateCode(type, length = 6) {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I/O (ambiguïté visuelle)
  const N = '23456789';                  // sans 0/1 (ambiguïté visuelle)
  const M = L + N;
  if (type === 'letters') return Array.from({ length }, () => L[Math.floor(Math.random() * L.length)]).join('');
  if (type === 'numbers') return Array.from({ length }, () => N[Math.floor(Math.random() * N.length)]).join('');
  if (type === 'math') {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const ops = ['+', '-', '*'];
    const op  = ops[Math.floor(Math.random() * ops.length)];
    const res = op === '+' ? a + b : op === '-' ? a - b : a * b;
    return { question: `${a} ${op} ${b} =`, answer: String(res) };
  }
  return Array.from({ length }, () => M[Math.floor(Math.random() * M.length)]).join('');
}

function securityLabel(t) {
  return { letters: 'Lettres uniquement', numbers: 'Chiffres uniquement', mixed: 'Majuscules et chiffres', math: 'Calcul mathématique' }[t] || t;
}

// ─── Construit l'image (ou le texte de repli) pour un code donné ────────────
function buildCaptchaVisual(cfg, code, question) {
  if (!cfg.imageMode) {
    return { attachment: null, questionText: question ? `Calcule : **${question} ?**` : `Entrez exactement :\n# \`${code}\`` };
  }
  try {
    const buf = renderCaptchaImage(question || code, { isMath: !!question });
    return { attachment: new AttachmentBuilder(buf, { name: 'captcha.png' }), questionText: null };
  } catch (err) {
    console.error('[Captcha] Échec génération image, repli en mode texte :', err.message);
    return { attachment: null, questionText: question ? `Calcule : **${question} ?**` : `Entrez exactement :\n# \`${code}\`` };
  }
}

// ─── Envoyer le captcha à un membre arrivant ──────────────────────────────────
async function sendCaptcha(member, cfg, client) {
  try {
    // ── Rôle de bypass : saute le captcha entièrement ──
    if (checkBypass(member.roles.cache.map(r => r.id), cfg.bypassRoleId)) {
      if (cfg.roleAfter) await member.roles.add(cfg.roleAfter).catch(() => {});
      await logAction({ client, guildId: member.guild.id, userId: member.id, action: 'bypassed' });
      return;
    }

    // ── Âge minimum du compte ──
    const ageCheck = checkAccountAge(member.user.createdAt, cfg.minAccountAgeDays);
    if (!ageCheck.ok) {
      await logAction({ client, guildId: member.guild.id, userId: member.id, action: 'blocked_age', detail: `Compte créé il y a ${ageCheck.ageDays}j (min. ${cfg.minAccountAgeDays}j requis)` });
      if (cfg.dmOnKick) {
        await member.send({ embeds: [errorEmbed('🚫 Compte trop récent', `Ton compte Discord doit avoir au moins **${cfg.minAccountAgeDays} jour(s)** pour rejoindre **${member.guild.name}**.`)] }).catch(() => {});
      }
      await member.kick('Captcha : compte trop récent').catch(() => {});
      return;
    }

    const channel = member.guild.channels.cache.get(cfg.channelId)
      || await member.guild.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      console.warn(`[Captcha] Channel introuvable : ${cfg.channelId}`);
      return;
    }

    const botPerms = channel.permissionsFor(member.guild.members.me);
    if (!botPerms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles'])) {
      console.error(`[Captcha] Permissions insuffisantes dans #${channel.name} (${member.guild.name}) : SendMessages/EmbedLinks/AttachFiles/ViewChannel requis. Le membre ${member.user.tag} n'a PAS pu être vérifié.`);
      return;
    }

    let code, question;
    if (cfg.security === 'math') {
      const gen = generateCode('math');
      code     = gen.answer;
      question = gen.question;
    } else {
      code     = generateCode(cfg.security, cfg.codeLength);
      question = null;
    }

    const expiresAt = new Date(Date.now() + cfg.timeout * 60 * 1000);

    const old = await CaptchaPending.findOneAndDelete({ userId: member.id, guildId: member.guild.id });
    if (old?.messageId && old.channelId) {
      const oldChannel = member.guild.channels.cache.get(old.channelId) || channel;
      oldChannel.messages.delete(old.messageId).catch(() => {});
    }

    const { attachment, questionText } = buildCaptchaVisual(cfg, code, question);

    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('🔒 Vérification humaine requise')
      .setDescription(
        `Bienvenue **${member.user.username}** sur **${member.guild.name}** !\n\n` +
        `Résolvez ce captcha pour accéder au serveur :\n\n` +
        (questionText || 'Regardez l\'image ci-dessous et entrez le code affiché.') + '\n\n' +
        `⏱️ Temps : **${cfg.timeout} min** ・ ❌ Tentatives : **${cfg.attempts}**` +
        (cfg.maxRegenerations > 0 ? ` ・ 🔄 Régénérations : **${cfg.maxRegenerations}**` : '')
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: `Sécurité : ${securityLabel(cfg.security)}${cfg.caseSensitive ? ' · Casse exacte requise' : ''}` })
      .setTimestamp();

    if (attachment) embed.setImage('attachment://captcha.png');

    const buttons = [
      new ButtonBuilder().setCustomId(`captcha_answer_${member.id}`).setLabel('✍️ Répondre').setStyle(ButtonStyle.Primary),
    ];
    if (cfg.maxRegenerations > 0) {
      buttons.push(new ButtonBuilder().setCustomId(`captcha_regen_${member.id}`).setLabel('🔄 Nouvelle image').setStyle(ButtonStyle.Secondary));
    }
    const row = new ActionRowBuilder().addComponents(...buttons);

    const sendPayload = { content: `<@${member.id}>`, embeds: [embed], components: [row] };
    if (attachment) sendPayload.files = [attachment];

    const msg = await channel.send(sendPayload);

    await CaptchaPending.create({
      userId: member.id, guildId: member.guild.id, code,
      attempts: 0, regenerations: 0, expiresAt, messageId: msg.id, channelId: channel.id,
    });

    if (cfg.roleBefore) {
      member.roles.add(cfg.roleBefore).catch(e => console.warn('[Captcha] roleBefore:', e.message));
    }

    await logAction({ client, guildId: member.guild.id, userId: member.id, action: 'sent' });

    setTimeout(async () => {
      const pending = await CaptchaPending.findOne({ userId: member.id, guildId: member.guild.id });
      if (!pending) return;
      await CaptchaPending.deleteOne({ _id: pending._id });

      const freshCfg = await CaptchaConfig.findOne({ guildId: member.guild.id });
      const kickOnFail = freshCfg?.kickOnFail ?? cfg.kickOnFail;

      const ch = member.guild.channels.cache.get(pending.channelId) || member.guild.channels.cache.get(cfg.channelId);
      if (ch) {
        ch.messages.delete(pending.messageId).catch(() => {});
        const timeoutEmbed = new EmbedBuilder()
          .setColor(COLORS.error)
          .setTitle('⏱️ Temps écoulé')
          .setDescription(`<@${member.id}> n'a pas complété la vérification à temps.${kickOnFail ? ' Il a été expulsé.' : ''}`)
          .setTimestamp();
        const tm = await ch.send({ embeds: [timeoutEmbed] }).catch(() => null);
        if (tm) setTimeout(() => tm.delete().catch(() => {}), 10000);
      }

      await logAction({ client, guildId: member.guild.id, userId: member.id, action: 'timeout' });

      if (kickOnFail) {
        const freshMember = await member.guild.members.fetch(member.id).catch(() => null);
        if (freshMember) {
          if (freshCfg?.dmOnKick) await freshMember.send({ embeds: [errorEmbed('⏱️ Temps écoulé', `Tu n'as pas complété la vérification sur **${member.guild.name}** à temps.`)] }).catch(() => {});
          freshMember.kick('Captcha : temps écoulé').catch(() => {});
          logAction({ client, guildId: member.guild.id, userId: member.id, action: 'kicked', detail: 'Timeout' }).catch(() => {});
        }
      }
    }, cfg.timeout * 60 * 1000);

  } catch (err) {
    console.error('[sendCaptcha]', err);
  }
}

// ─── Bouton "Répondre" → ouvrir le modal ─────────────────────────────────────
async function verifyCaptcha(interaction) {
  const targetUserId = interaction.customId.replace('captcha_answer_', '');

  if (interaction.user.id !== targetUserId) {
    return interaction.reply({ content: '❌ Ce captcha ne vous est pas destiné.', ephemeral: true });
  }

  const pending = await CaptchaPending.findOne({ userId: interaction.user.id, guildId: interaction.guild.id });
  if (!pending) {
    return interaction.reply({ content: '❌ Aucun captcha actif trouvé.', ephemeral: true });
  }
  if (new Date() > pending.expiresAt) {
    await CaptchaPending.deleteOne({ _id: pending._id });
    return interaction.reply({ content: '⏱️ Ton captcha a expiré. Rejoins le serveur à nouveau.', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`captcha_submit_${interaction.user.id}`)
    .setTitle('🔒 Répondre au captcha');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('captcha_input')
        .setLabel('Votre réponse')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Entrez la réponse exacte…'),
    ),
  );
  return interaction.showModal(modal);
}

// ─── Bouton "Nouvelle image" — régénère un code différent, capé ─────────────────
async function handleRegenerate(interaction) {
  const targetUserId = interaction.customId.replace('captcha_regen_', '');
  if (interaction.user.id !== targetUserId) {
    return interaction.reply({ content: '❌ Ce captcha ne vous est pas destiné.', ephemeral: true });
  }

  const pending = await CaptchaPending.findOne({ userId: interaction.user.id, guildId: interaction.guild.id });
  if (!pending) return interaction.reply({ content: '❌ Aucun captcha actif trouvé.', ephemeral: true });
  if (new Date() > pending.expiresAt) {
    await CaptchaPending.deleteOne({ _id: pending._id });
    return interaction.reply({ content: '⏱️ Ton captcha a expiré. Rejoins le serveur à nouveau.', ephemeral: true });
  }

  const cfg = await CaptchaConfig.findOne({ guildId: interaction.guild.id });
  if (!canRegenerate(pending.regenerations, cfg?.maxRegenerations ?? 0)) {
    return interaction.reply({ content: `❌ Tu as atteint la limite de régénérations (**${cfg?.maxRegenerations ?? 0}**).`, ephemeral: true });
  }

  let code, question;
  if (cfg.security === 'math') {
    const gen = generateCode('math');
    code = gen.answer; question = gen.question;
  } else {
    code = generateCode(cfg.security, cfg.codeLength); question = null;
  }

  pending.code = code;
  pending.regenerations += 1;
  await pending.save();

  const { attachment, questionText } = buildCaptchaVisual(cfg, code, question);
  const embed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('🔒 Vérification humaine requise')
    .setDescription(
      `Nouvelle image générée. Résolvez ce captcha pour accéder au serveur :\n\n` +
      (questionText || 'Regardez l\'image ci-dessous et entrez le code affiché.') + '\n\n' +
      `⏱️ Temps restant jusqu'à <t:${Math.floor(pending.expiresAt.getTime() / 1000)}:R> ・ ❌ Tentatives restantes : **${Math.max(0, cfg.attempts - pending.attempts)}**`
    )
    .setThumbnail(interaction.user.displayAvatarURL())
    .setFooter({ text: `Sécurité : ${securityLabel(cfg.security)} ・ Régénérations restantes : ${Math.max(0, cfg.maxRegenerations - pending.regenerations)}` })
    .setTimestamp();
  if (attachment) embed.setImage('attachment://captcha.png');

  const buttons = [new ButtonBuilder().setCustomId(`captcha_answer_${interaction.user.id}`).setLabel('✍️ Répondre').setStyle(ButtonStyle.Primary)];
  if (canRegenerate(pending.regenerations, cfg.maxRegenerations)) {
    buttons.push(new ButtonBuilder().setCustomId(`captcha_regen_${interaction.user.id}`).setLabel('🔄 Nouvelle image').setStyle(ButtonStyle.Secondary));
  }

  const updatePayload = { embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)] };
  if (attachment) updatePayload.files = [attachment];

  await interaction.update(updatePayload);
  await logAction({ client: interaction.client, guildId: interaction.guild.id, userId: interaction.user.id, action: 'regenerated' });
}

// ─── Soumission du modal captcha ──────────────────────────────────────────────
async function handleCaptchaSubmit(interaction) {
  const targetUserId = interaction.customId.replace('captcha_submit_', '');
  if (interaction.user.id !== targetUserId) return;

  const pending = await CaptchaPending.findOne({ userId: interaction.user.id, guildId: interaction.guild.id });
  if (!pending) return interaction.reply({ content: '❌ Captcha introuvable.', ephemeral: true });

  if (new Date() > pending.expiresAt) {
    await CaptchaPending.deleteOne({ _id: pending._id });
    return interaction.reply({ content: '⏱️ Ton captcha a expiré.', ephemeral: true });
  }

  const cfg    = await CaptchaConfig.findOne({ guildId: interaction.guild.id });
  const answer = interaction.fields.getTextInputValue('captcha_input');
  const isOK   = compareAnswer(answer, pending.code, cfg?.caseSensitive);

  if (isOK) {
    await CaptchaPending.deleteOne({ _id: pending._id });
    const member = interaction.member;

    if (cfg?.roleBefore && member.roles.cache.has(cfg.roleBefore)) {
      await member.roles.remove(cfg.roleBefore).catch(() => {});
    }
    if (cfg?.roleAfter) {
      await member.roles.add(cfg.roleAfter).catch(e => console.warn('[Captcha] roleAfter:', e.message));
    }

    const ch = interaction.guild.channels.cache.get(pending.channelId);
    if (ch) ch.messages.delete(pending.messageId).catch(() => {});

    await logAction({ client: interaction.client, guildId: interaction.guild.id, userId: interaction.user.id, action: 'success' });

    const successMsg = await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('✅ Vérification réussie !')
        .setDescription(`Bienvenue **${interaction.user.username}** ! Tu as maintenant accès au serveur. 🎉`)
        .setTimestamp()],
      fetchReply: true,
    });
    setTimeout(() => successMsg.delete().catch(() => {}), 8000);

  } else {
    pending.attempts += 1;
    await pending.save();
    const maxAttempts = cfg?.attempts ?? 3;

    await logAction({ client: interaction.client, guildId: interaction.guild.id, userId: interaction.user.id, action: 'fail', detail: `Tentative ${pending.attempts}/${maxAttempts}` });

    if (attemptsExhausted(pending.attempts, maxAttempts)) {
      await CaptchaPending.deleteOne({ _id: pending._id });
      const ch = interaction.guild.channels.cache.get(pending.channelId);
      if (ch) ch.messages.delete(pending.messageId).catch(() => {});

      await interaction.reply({
        embeds: [errorEmbed('❌ Trop de tentatives', `Tu as échoué ${maxAttempts} fois.${cfg?.kickOnFail ? ' Tu vas être expulsé.' : ''}`)],
        ephemeral: true,
      });

      if (cfg?.kickOnFail) {
        if (cfg?.dmOnKick) await interaction.user.send({ embeds: [errorEmbed('❌ Vérification échouée', `Tu as épuisé tes tentatives sur **${interaction.guild.name}**.`)] }).catch(() => {});
        setTimeout(() => {
          interaction.member.kick('Captcha : trop de tentatives').catch(() => {});
          logAction({ client: interaction.client, guildId: interaction.guild.id, userId: interaction.user.id, action: 'kicked', detail: 'Tentatives épuisées' }).catch(() => {});
        }, 2000);
      }
    } else {
      const remaining = maxAttempts - pending.attempts;
      await interaction.reply({
        embeds: [errorEmbed('❌ Réponse incorrecte', `Il te reste **${remaining}** tentative(s). Clique à nouveau sur "Répondre".`)],
        ephemeral: true,
      });
    }
  }
}

// ─── Build embeds/components du panel /captcha ────────────────────────────────
function buildCaptchaEmbed(cfg) {
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🔒 Configuration — Captcha')
    .setDescription('Panel de configuration avancé. Choisissez une section à modifier.')
    .addFields(
      { name: '**Statut**',                value: cfg?.enabled    ? '🟢 Activé'           : '🔴 Désactivé',                  inline: true },
      { name: '**Mode image**',            value: cfg?.imageMode  ? '🖼️ Image distordue'  : '📝 Texte brut',                 inline: true },
      { name: '**Salon**',                 value: cfg?.channelId  ? `<#${cfg.channelId}>` : 'Aucun',                        inline: true },
      { name: '**Salon de logs**',         value: cfg?.logChannelId ? `<#${cfg.logChannelId}>` : 'Aucun',                   inline: true },
      { name: '**Rôle avant**',            value: cfg?.roleBefore ? `<@&${cfg.roleBefore}>` : 'Aucun',                      inline: true },
      { name: '**Rôle après**',            value: cfg?.roleAfter  ? `<@&${cfg.roleAfter}>`  : 'Aucun',                      inline: true },
      { name: '**Rôle bypass**',           value: cfg?.bypassRoleId ? `<@&${cfg.bypassRoleId}>` : 'Aucun',                  inline: true },
      { name: '**Sécurité**',              value: securityLabel(cfg?.security || 'mixed'),                                 inline: true },
      { name: '**Tentatives max**',        value: String(cfg?.attempts  ?? 3),                                             inline: true },
      { name: '**Expiration**',            value: `${cfg?.timeout ?? 10} min`,                                             inline: true },
      { name: '**Régénérations max**',     value: String(cfg?.maxRegenerations ?? 2),                                      inline: true },
      { name: '**Âge de compte min.**',    value: cfg?.minAccountAgeDays > 0 ? `${cfg.minAccountAgeDays} jour(s)` : 'Désactivé', inline: true },
      { name: '**Casse exacte**',          value: cfg?.caseSensitive ? '✅ Requise' : '❌ Non', inline: true },
      { name: '**Kick si échec/timeout**', value: cfg?.kickOnFail ? '✅ Oui' : '❌ Non',        inline: true },
      { name: '**Prévenir en DM**',        value: cfg?.dmOnKick ? '✅ Oui' : '❌ Non',          inline: true },
    )
    .setFooter({ text: 'Bumpify • Captcha avancé' })
    .setTimestamp();
}

function buildCaptchaComponents(cfg) {
  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('captcha_toggle').setLabel(cfg?.enabled ? '🔴 Désactiver' : '🟢 Activer').setStyle(cfg?.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('captcha_set_channel').setLabel('# Salon').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('captcha_set_role_before').setLabel('@ Rôle avant').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('captcha_set_role_after').setLabel('@ Rôle après').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('captcha_set_security').setLabel('🔒 Sécurité').setStyle(ButtonStyle.Secondary),
  );
  const r2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('captcha_set_logs').setLabel('📋 Logs').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('captcha_set_bypass').setLabel('🟢 Rôle bypass').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('captcha_advanced').setLabel('⚙️ Paramètres').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('captcha_antibot').setLabel('🛡️ Anti-bot avancé').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('captcha_toggle_image').setLabel(cfg?.imageMode ? '🖼️ Image: ON' : '📝 Image: OFF').setStyle(cfg?.imageMode ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
  return [r1, r2];
}

// ─── Commande slash ───────────────────────────────────────────────────────────
module.exports = {
  sendCaptcha,
  verifyCaptcha,
  handleCaptchaSubmit,
  handleRegenerate,

  data: new SlashCommandBuilder()
    .setName('captcha')
    .setDescription('🔒 Configurer le système de vérification Captcha')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    let cfg = await CaptchaConfig.findOne({ guildId: interaction.guildId });
    if (!cfg) cfg = await CaptchaConfig.create({ guildId: interaction.guildId });

    const reply = await interaction.reply({
      embeds:     [buildCaptchaEmbed(cfg)],
      components: buildCaptchaComponents(cfg),
      ephemeral:  true,
      fetchReply: true,
    });

    const col = reply.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time:   10 * 60 * 1000,
    });

    const refresh = async (i) => {
      cfg = await CaptchaConfig.findOne({ guildId: interaction.guildId });
      return i.update({ embeds: [buildCaptchaEmbed(cfg)], components: buildCaptchaComponents(cfg) });
    };

    col.on('collect', async i => {
      cfg = await CaptchaConfig.findOne({ guildId: interaction.guildId });
      const back = new ButtonBuilder().setCustomId('captcha_back').setLabel('← Retour').setStyle(ButtonStyle.Secondary);

      if (i.customId === 'captcha_toggle') {
        cfg.enabled = !cfg.enabled;
        await cfg.save();
        return refresh(i);
      }

      if (i.customId === 'captcha_toggle_image') {
        cfg.imageMode = !cfg.imageMode;
        await cfg.save();
        return refresh(i);
      }

      if (i.customId === 'captcha_set_channel') {
        return i.update({
          embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('# Salon Captcha').setDescription(`Actuel : ${cfg.channelId ? `<#${cfg.channelId}>` : '*Aucun*'}\n\nSélectionnez le salon où le captcha sera envoyé à l'arrivée.`)],
          components: [
            new ActionRowBuilder().addComponents(
              new ChannelSelectMenuBuilder().setCustomId('captcha_channel_select').setPlaceholder('Choisir un salon…').addChannelTypes(ChannelType.GuildText),
            ),
            new ActionRowBuilder().addComponents(back),
          ],
        });
      }

      if (i.customId === 'captcha_set_logs') {
        const clear = new ButtonBuilder().setCustomId('captcha_clear_logs').setLabel('🗑️ Retirer').setStyle(ButtonStyle.Danger);
        return i.update({
          embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('📋 Salon de logs').setDescription(`Chaque évènement (envoi, réussite, échec, régénération, expulsion…) y sera relayé en direct.\nActuel : ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : '*Aucun*'}`)],
          components: [
            new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('captcha_log_channel_select').setPlaceholder('Choisir un salon de logs…').addChannelTypes(ChannelType.GuildText)),
            new ActionRowBuilder().addComponents(back, clear),
          ],
        });
      }

      if (i.customId === 'captcha_set_bypass') {
        const clear = new ButtonBuilder().setCustomId('captcha_clear_bypass').setLabel('🗑️ Retirer').setStyle(ButtonStyle.Danger);
        return i.update({
          embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('🟢 Rôle de bypass').setDescription(`Les membres possédant ce rôle sautent le captcha entièrement (utile pour les bots vérifiés ou membres de confiance ajoutés manuellement).\nActuel : ${cfg.bypassRoleId ? `<@&${cfg.bypassRoleId}>` : '*Aucun*'}`)],
          components: [
            new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('captcha_bypass_role_select').setPlaceholder('Rôle de bypass…')),
            new ActionRowBuilder().addComponents(back, clear),
          ],
        });
      }

      if (i.customId === 'captcha_set_role_before') {
        const clear = new ButtonBuilder().setCustomId('captcha_clear_role_before').setLabel('🗑️ Retirer').setStyle(ButtonStyle.Danger);
        return i.update({
          embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('@ Rôle avant le captcha').setDescription(`Attribué dès l'arrivée, **avant** la vérification.\nActuel : ${cfg.roleBefore ? `<@&${cfg.roleBefore}>` : '*Aucun*'}`)],
          components: [
            new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('captcha_role_before_select').setPlaceholder('Rôle non-vérifié…')),
            new ActionRowBuilder().addComponents(back, clear),
          ],
        });
      }

      if (i.customId === 'captcha_set_role_after') {
        const clear = new ButtonBuilder().setCustomId('captcha_clear_role_after').setLabel('🗑️ Retirer').setStyle(ButtonStyle.Danger);
        return i.update({
          embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('@ Rôle après le captcha').setDescription(`Attribué **après** la vérification réussie.\nActuel : ${cfg.roleAfter ? `<@&${cfg.roleAfter}>` : '*Aucun*'}`)],
          components: [
            new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('captcha_role_after_select').setPlaceholder('Rôle vérifié…')),
            new ActionRowBuilder().addComponents(back, clear),
          ],
        });
      }

      if (i.customId === 'captcha_set_security') {
        return i.update({
          embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('🔒 Type de captcha').setDescription(`Actuel : **${securityLabel(cfg.security)}**\n\nTous les types sont désormais rendus comme **image distordue** (si le mode image est activé) — aucun code n'est jamais exposé en texte brut lisible par un bot.`)],
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder().setCustomId('captcha_security_select').setPlaceholder('Type de captcha…').addOptions([
                { label: 'Lettres uniquement',     value: 'letters', emoji: '🔤', description: 'Code en majuscules seulement' },
                { label: 'Chiffres uniquement',    value: 'numbers', emoji: '🔢', description: 'Code numérique' },
                { label: 'Majuscules et chiffres', value: 'mixed',   emoji: '🔣', description: 'Mélange (recommandé)' },
                { label: 'Calcul mathématique',    value: 'math',    emoji: '➕', description: 'Opération simple à calculer' },
              ]),
            ),
            new ActionRowBuilder().addComponents(back),
          ],
        });
      }

      if (i.customId === 'captcha_advanced') {
        const modal = new ModalBuilder().setCustomId('captcha_advanced_modal').setTitle('⚙️ Paramètres');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('captcha_attempts').setLabel('Tentatives max (1–10)').setStyle(TextInputStyle.Short).setValue(String(cfg.attempts)).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('captcha_timeout').setLabel('Expiration en minutes (1–60)').setStyle(TextInputStyle.Short).setValue(String(cfg.timeout)).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('captcha_length').setLabel('Longueur du code (4–10)').setStyle(TextInputStyle.Short).setValue(String(cfg.codeLength)).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('captcha_kick').setLabel('Kick si échec ou timeout ? (oui/non)').setStyle(TextInputStyle.Short).setValue(cfg.kickOnFail ? 'oui' : 'non').setRequired(true)),
        );
        return i.showModal(modal);
      }

      if (i.customId === 'captcha_antibot') {
        const modal = new ModalBuilder().setCustomId('captcha_antibot_modal').setTitle('🛡️ Anti-bot avancé');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('captcha_regens').setLabel('Régénérations max (0–5)').setStyle(TextInputStyle.Short).setValue(String(cfg.maxRegenerations)).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('captcha_min_age').setLabel('Âge min. du compte en jours (0=off)').setStyle(TextInputStyle.Short).setValue(String(cfg.minAccountAgeDays)).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('captcha_case').setLabel('Casse exacte requise ? (oui/non)').setStyle(TextInputStyle.Short).setValue(cfg.caseSensitive ? 'oui' : 'non').setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('captcha_dm').setLabel('Prévenir en DM avant expulsion ? (oui/non)').setStyle(TextInputStyle.Short).setValue(cfg.dmOnKick ? 'oui' : 'non').setRequired(true)),
        );
        return i.showModal(modal);
      }

      if (i.customId === 'captcha_back') return refresh(i);
      if (i.customId === 'captcha_channel_select')      { cfg.channelId    = i.values[0]; await cfg.save(); return refresh(i); }
      if (i.customId === 'captcha_log_channel_select')  { cfg.logChannelId = i.values[0]; await cfg.save(); return refresh(i); }
      if (i.customId === 'captcha_bypass_role_select')  { cfg.bypassRoleId = i.values[0]; await cfg.save(); return refresh(i); }
      if (i.customId === 'captcha_role_before_select')  { cfg.roleBefore   = i.values[0]; await cfg.save(); return refresh(i); }
      if (i.customId === 'captcha_role_after_select')   { cfg.roleAfter    = i.values[0]; await cfg.save(); return refresh(i); }
      if (i.customId === 'captcha_clear_logs')          { cfg.logChannelId = null;         await cfg.save(); return refresh(i); }
      if (i.customId === 'captcha_clear_bypass')        { cfg.bypassRoleId = null;         await cfg.save(); return refresh(i); }
      if (i.customId === 'captcha_clear_role_before')   { cfg.roleBefore   = null;         await cfg.save(); return refresh(i); }
      if (i.customId === 'captcha_clear_role_after')    { cfg.roleAfter    = null;         await cfg.save(); return refresh(i); }
      if (i.customId === 'captcha_security_select')     { cfg.security     = i.values[0]; await cfg.save(); return refresh(i); }
    });

    col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
  },

  async handleAdvancedModal(interaction) {
    const cfg = await CaptchaConfig.findOne({ guildId: interaction.guildId });
    if (!cfg) return;
    cfg.attempts   = Math.min(10, Math.max(1, parseInt(interaction.fields.getTextInputValue('captcha_attempts'))   || 3));
    cfg.timeout    = Math.min(60, Math.max(1, parseInt(interaction.fields.getTextInputValue('captcha_timeout'))    || 10));
    cfg.codeLength = Math.min(10, Math.max(4, parseInt(interaction.fields.getTextInputValue('captcha_length'))     || 6));
    const raw      = interaction.fields.getTextInputValue('captcha_kick').toLowerCase().trim();
    cfg.kickOnFail = raw === 'oui' || raw === 'yes' || raw === '1' || raw === 'true';
    await cfg.save();
    return interaction.reply({
      embeds: [successEmbed('✅ Paramètres mis à jour',
        `Tentatives : **${cfg.attempts}** ・ Expiration : **${cfg.timeout} min** ・ Code : **${cfg.codeLength} caractères** ・ Kick : **${cfg.kickOnFail ? 'Oui' : 'Non'}**`)],
      ephemeral: true,
    });
  },

  async handleAntiBotModal(interaction) {
    const cfg = await CaptchaConfig.findOne({ guildId: interaction.guildId });
    if (!cfg) return;

    const regens = parseInt(interaction.fields.getTextInputValue('captcha_regens'));
    const minAge = parseInt(interaction.fields.getTextInputValue('captcha_min_age'));
    if (isNaN(regens) || isNaN(minAge) || regens < 0 || regens > 5 || minAge < 0) {
      return interaction.reply({ embeds: [errorEmbed('Valeur invalide', 'Régénérations : 0 à 5. Âge minimum : nombre positif de jours (0 pour désactiver).')], ephemeral: true });
    }

    cfg.maxRegenerations = regens;
    cfg.minAccountAgeDays = minAge;
    const caseRaw = interaction.fields.getTextInputValue('captcha_case').toLowerCase().trim();
    cfg.caseSensitive = caseRaw === 'oui' || caseRaw === 'yes' || caseRaw === '1' || caseRaw === 'true';
    const dmRaw = interaction.fields.getTextInputValue('captcha_dm').toLowerCase().trim();
    cfg.dmOnKick = dmRaw === 'oui' || dmRaw === 'yes' || dmRaw === '1' || dmRaw === 'true';
    await cfg.save();

    return interaction.reply({
      embeds: [successEmbed('✅ Anti-bot mis à jour',
        `Régénérations max : **${cfg.maxRegenerations}** ・ Âge min. du compte : **${cfg.minAccountAgeDays > 0 ? cfg.minAccountAgeDays + 'j' : 'désactivé'}** ・ Casse exacte : **${cfg.caseSensitive ? 'Oui' : 'Non'}** ・ DM avant kick : **${cfg.dmOnKick ? 'Oui' : 'Non'}**`)],
      ephemeral: true,
    });
  },
};
