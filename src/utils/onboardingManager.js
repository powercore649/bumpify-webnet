// utils/onboardingManager.js — Moteur du système d'onboarding / portail d'accès
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits, ChannelType,
} = require('discord.js');
const OnboardingConfig = require('../models/OnboardingConfig');
const OnboardingSession = require('../models/OnboardingSession');
const { COLORS } = require('../utils/embeds');

// ─── S'assure qu'un rôle "Non-vérifié" existe, le crée sinon ─────────────────
async function ensureUnverifiedRole(guild, cfg) {
  if (cfg.unverifiedRoleId) {
    const existing = guild.roles.cache.get(cfg.unverifiedRoleId);
    if (existing) return existing;
  }

  const role = await guild.roles.create({
    name: 'Non-vérifié',
    color: 0x99AAB5,
    reason: 'Système d\'onboarding Bumpify — rôle créé automatiquement',
    permissions: [],
  });

  cfg.unverifiedRoleId = role.id;
  await cfg.save();
  return role;
}

// ─── Verrouille tous les salons existants pour le rôle non-vérifié ───────────
// Appelé une fois à l'activation du système : ViewChannel refusé partout, sauf
// dans la catégorie d'onboarding elle-même (où les salons privés sont créés).
async function lockdownExistingChannels(guild, unverifiedRole, categoryId) {
  const channels = guild.channels.cache.filter(c => c.parentId !== categoryId && c.id !== categoryId);
  for (const channel of channels.values()) {
    if (!channel.permissionsFor || typeof channel.permissionOverwrites?.edit !== 'function') continue;
    await channel.permissionOverwrites.edit(unverifiedRole, { ViewChannel: false }).catch(() => {});
  }
}

// ─── Crée le salon privé d'onboarding pour un membre ──────────────────────────
async function createOnboardingChannel(member, cfg) {
  const guild = member.guild;
  const category = cfg.categoryId ? guild.channels.cache.get(cfg.categoryId) : null;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
  ];

  const channel = await guild.channels.create({
    name: `accueil-${member.user.username}`.slice(0, 90),
    type: ChannelType.GuildText,
    parent: category?.id || null,
    topic: `Onboarding de ${member.user.tag} (${member.id})`,
    permissionOverwrites: overwrites,
    reason: 'Système d\'onboarding Bumpify',
  }).catch(err => { console.error('[Onboarding] Création salon:', err.message); return null; });

  return channel;
}

// ─── Construit le message d'une question (texte ou choix multiples) ──────────
function buildQuestionPayload(question, index, total) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`❓ Question ${index + 1}/${total}`)
    .setDescription(question.prompt)
    .setFooter({ text: question.required ? 'Réponse requise' : 'Tu peux passer cette question' });

  const components = [];

  if (question.type === 'choice' && question.choices.length) {
    const row = new ActionRowBuilder().addComponents(
      question.choices.slice(0, 5).map((choice, i) =>
        new ButtonBuilder().setCustomId(`ob_answer:${question.id}:${i}`).setLabel(choice.slice(0, 80)).setStyle(ButtonStyle.Primary),
      ),
    );
    components.push(row);
  }

  if (!question.required) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ob_skip:${question.id}`).setLabel('Passer').setStyle(ButtonStyle.Secondary),
    ));
  }

  return { embeds: [embed], components };
}

// ─── Démarre l'onboarding pour un membre ──────────────────────────────────────
async function startOnboarding(member, cfg) {
  const guild = member.guild;

  const unverifiedRole = await ensureUnverifiedRole(guild, cfg);
  await member.roles.add(unverifiedRole).catch(err => console.error('[Onboarding] Ajout rôle:', err.message));

  const channel = await createOnboardingChannel(member, cfg);
  if (!channel) return null;

  const session = await OnboardingSession.findOneAndUpdate(
    { guildId: guild.id, userId: member.id },
    { channelId: channel.id, currentQuestionIdx: 0, answers: [], completed: false, createdAt: new Date() },
    { upsert: true, new: true },
  );

  const welcomeMsg = (cfg.welcomeMessage || '').replace('{user}', `<@${member.id}>`).replace('{server}', guild.name);
  await channel.send({
    embeds: [new EmbedBuilder().setColor(COLORS.primary).setDescription(welcomeMsg)],
  }).catch(() => {});

  if (cfg.questions.length > 0) {
    await channel.send(buildQuestionPayload(cfg.questions[0], 0, cfg.questions.length)).catch(() => {});
  } else {
    await completeOnboarding(member, session, cfg);
  }

  return session;
}

// ─── Avance à la question suivante ou termine ─────────────────────────────────
async function advance(member, session, cfg, channel) {
  const nextIdx = session.currentQuestionIdx + 1;

  if (nextIdx >= cfg.questions.length) {
    await completeOnboarding(member, session, cfg, channel);
    return;
  }

  session.currentQuestionIdx = nextIdx;
  await session.save();

  await channel.send(buildQuestionPayload(cfg.questions[nextIdx], nextIdx, cfg.questions.length)).catch(() => {});
}

// ─── Enregistre une réponse texte (depuis messageCreate.js) ───────────────────
async function handleTextAnswer(message, session, cfg) {
  const question = cfg.questions[session.currentQuestionIdx];
  if (!question || question.type !== 'text') return false;

  session.answers.push({ questionId: question.id, answer: message.content.slice(0, 1000) });
  await session.save();

  await message.react('✅').catch(() => {});
  await advance(message.member, session, cfg, message.channel);
  return true;
}

// ─── Enregistre une réponse à choix multiples (depuis interactionCreate.js) ──
async function handleChoiceAnswer(interaction, session, cfg) {
  const [, questionId, choiceIdxRaw] = interaction.customId.split(':');
  const question = cfg.questions.find(q => q.id === questionId);
  if (!question) return;

  const choice = question.choices[parseInt(choiceIdxRaw, 10)] || '';
  session.answers.push({ questionId, answer: choice });
  await session.save();

  await interaction.update({ components: [] }).catch(() => {});
  await advance(interaction.member, session, cfg, interaction.channel);
}

// ─── Passe une question optionnelle (depuis interactionCreate.js) ────────────
async function handleSkip(interaction, session, cfg) {
  const questionId = interaction.customId.split(':')[1];
  session.answers.push({ questionId, answer: '(passé)' });
  await session.save();

  await interaction.update({ components: [] }).catch(() => {});
  await advance(interaction.member, session, cfg, interaction.channel);
}

// ─── Termine l'onboarding : accès accordé, salon nettoyé ──────────────────────
async function completeOnboarding(member, session, cfg, channel) {
  const guild = member.guild;
  channel = channel || guild.channels.cache.get(session.channelId);

  if (cfg.unverifiedRoleId) {
    await member.roles.remove(cfg.unverifiedRoleId).catch(() => {});
  }
  if (cfg.accessRoleId) {
    await member.roles.add(cfg.accessRoleId).catch(() => {});
  }

  session.completed = true;
  await session.save();

  cfg.totalCompleted += 1;
  await cfg.save();

  const completionMsg = (cfg.completionMessage || '').replace('{user}', `<@${member.id}>`).replace('{server}', guild.name);

  if (channel) {
    await channel.send({ embeds: [new EmbedBuilder().setColor(COLORS.success || 0x57F287).setDescription(completionMsg)] }).catch(() => {});

    if (cfg.deleteChannelOnComplete) {
      setTimeout(() => channel.delete('Onboarding terminé').catch(() => {}), 10_000);
    } else {
      await channel.permissionOverwrites.edit(member.id, { SendMessages: false }).catch(() => {});
    }
  }

  await OnboardingSession.deleteOne({ _id: session._id }).catch(() => {});
}

// ─── Nettoyage si un membre quitte en plein onboarding ────────────────────────
async function cancelOnboarding(guild, userId) {
  const session = await OnboardingSession.findOne({ guildId: guild.id, userId });
  if (!session) return;

  const channel = guild.channels.cache.get(session.channelId);
  if (channel) await channel.delete('Membre parti avant la fin de l\'onboarding').catch(() => {});

  await OnboardingSession.deleteOne({ _id: session._id }).catch(() => {});
}

module.exports = {
  ensureUnverifiedRole, lockdownExistingChannels, createOnboardingChannel,
  buildQuestionPayload, startOnboarding, advance,
  handleTextAnswer, handleChoiceAnswer, handleSkip,
  completeOnboarding, cancelOnboarding,
};
