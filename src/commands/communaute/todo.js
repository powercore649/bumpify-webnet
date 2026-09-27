'use strict';
// commands/todo.js — ✅ Todo-list complète du serveur, en un seul panel interactif
// Cocher/décocher = menu multi-sélection (l'état "sélectionné" EST la case cochée).

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

const Todo = require('../../models/Todo');
const { COLORS, successEmbed, errorEmbed } = require('../../utils/embeds');

const PRIORITY_EMOJI = { low: '🟢', normal: '🟡', high: '🔴' };
const PRIORITY_LABEL = { low: 'Basse', normal: 'Normale', high: 'Haute' };

function normalizePriority(raw) {
  const v = (raw || '').trim().toLowerCase();
  if (['basse', 'low', 'faible'].includes(v)) return 'low';
  if (['haute', 'high', 'urgent', 'urgente'].includes(v)) return 'high';
  return 'normal';
}

// ─── Parse "JJ/MM/AAAA" ou "JJ/MM" (année courante ou suivante si passée) ──
function parseDueDate(raw) {
  const v = (raw || '').trim();
  if (!v) return { date: null, error: null };

  const m = v.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return { date: null, error: 'Format attendu : `JJ/MM` ou `JJ/MM/AAAA` (ex: 25/12 ou 25/12/2026).' };

  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  let year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();

  let date = new Date(year, month, day, 23, 59, 0);
  if (Number.isNaN(date.getTime()) || date.getDate() !== day) {
    return { date: null, error: 'Date invalide.' };
  }

  // Pas d'année précisée et déjà passée cette année -> on suppose l'année prochaine
  if (!m[3] && date.getTime() < Date.now()) {
    date = new Date(year + 1, month, day, 23, 59, 0);
  }

  return { date, error: null };
}

function taskLine(task, index) {
  const box = task.done ? '✅' : '⬜';
  const prio = PRIORITY_EMOJI[task.priority] || '';
  let text = task.done ? `~~${task.text}~~` : task.text;
  let meta = '';
  if (task.dueDate) {
    const ts = Math.floor(new Date(task.dueDate).getTime() / 1000);
    const overdue = !task.done && new Date(task.dueDate).getTime() < Date.now();
    meta = ` — ${overdue ? '🔴 ' : ''}<t:${ts}:d>`;
  }
  return `${box} \`${index}\` ${prio} ${text}${meta}`;
}

// ─── Embed principal : liste À faire / Terminées ───────────────────────────
function buildListEmbed(guild, tasks, limit) {
  const pending = tasks.filter((t) => !t.done);
  const done    = tasks.filter((t) => t.done);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`✅ Todo-list — ${guild.name}`)
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .setFooter({ text: `Bumpify • ${pending.length}/${limit} tâches actives • Cochez dans le menu ci-dessous pour marquer comme fait` })
    .setTimestamp();

  if (!tasks.length) {
    embed.setDescription('Aucune tâche pour le moment. Cliquez sur **➕ Ajouter** pour commencer !');
    return embed;
  }

  if (pending.length) {
    embed.addFields({
      name: `📋 À faire (${pending.length})`,
      value: pending.map((t) => taskLine(t, tasks.indexOf(t) + 1)).join('\n').slice(0, 1024),
      inline: false,
    });
  }
  if (done.length) {
    embed.addFields({
      name: `✔️ Terminées (${done.length})`,
      value: done.slice(-10).map((t) => taskLine(t, tasks.indexOf(t) + 1)).join('\n').slice(0, 1024) + (done.length > 10 ? `\n*+${done.length - 10} autre(s)*` : ''),
      inline: false,
    });
  }

  return embed;
}

// ─── Embed calendrier : tâches groupées par échéance ───────────────────────
function buildCalendarEmbed(guild, tasks) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(startToday.getTime() + 24 * 60 * 60 * 1000);
  const endWeek = new Date(startToday.getTime() + 7 * 24 * 60 * 60 * 1000);

  const active = tasks.filter((t) => !t.done);
  const overdue  = active.filter((t) => t.dueDate && new Date(t.dueDate) < startToday);
  const today    = active.filter((t) => t.dueDate && new Date(t.dueDate) >= startToday && new Date(t.dueDate) < endToday);
  const thisWeek = active.filter((t) => t.dueDate && new Date(t.dueDate) >= endToday && new Date(t.dueDate) < endWeek);
  const later    = active.filter((t) => t.dueDate && new Date(t.dueDate) >= endWeek);
  const noDate   = active.filter((t) => !t.dueDate);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`📅 Calendrier — ${guild.name}`)
    .setFooter({ text: 'Bumpify • Vue agenda — cliquez sur "Liste" pour revenir' })
    .setTimestamp();

  const section = (label, list) => list.length
    ? { name: label, value: list.map((t) => taskLine(t, tasks.indexOf(t) + 1)).join('\n').slice(0, 1024), inline: false }
    : null;

  const fields = [
    section('🔴 En retard', overdue),
    section('🟡 Aujourd\'hui', today),
    section('🔵 Cette semaine', thisWeek),
    section('⚪ Plus tard', later),
    section('❔ Sans échéance', noDate),
  ].filter(Boolean);

  if (!fields.length) {
    embed.setDescription('Aucune tâche active. Tout est calme ! 🎉');
  } else {
    embed.addFields(fields);
  }

  return embed;
}

// ─── Composants ─────────────────────────────────────────────────────────────
function buildCheckSelect(tasks) {
  const visible = tasks.slice(0, 25);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('todo_toggle')
    .setPlaceholder('☑️ Cocher / décocher des tâches...')
    .setMinValues(0)
    .setMaxValues(visible.length)
    .addOptions(visible.map((t) => ({
      label: t.text.slice(0, 100),
      value: String(t._id),
      description: t.dueDate ? `Échéance : ${new Date(t.dueDate).toLocaleDateString('fr-FR')}` : undefined,
      emoji: PRIORITY_EMOJI[t.priority],
      default: t.done,
    })));
  return menu;
}

function buildPanelComponents(tasks, view) {
  const rows = [];
  if (tasks.length && view === 'list') {
    rows.push(new ActionRowBuilder().addComponents(buildCheckSelect(tasks)));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('todo_add').setLabel('Ajouter').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('todo_delete').setLabel('Supprimer').setEmoji('🗑️').setStyle(ButtonStyle.Danger).setDisabled(!tasks.length),
    new ButtonBuilder().setCustomId(view === 'list' ? 'todo_calendar' : 'todo_list').setLabel(view === 'list' ? 'Calendrier' : 'Liste').setEmoji(view === 'list' ? '📅' : '📋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('todo_refresh').setLabel('Actualiser').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('todo_close').setLabel('Fermer').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

async function fetchTasks(guildId) {
  return Todo.find({ guildId }).sort({ done: 1, dueDate: 1, createdAt: 1 });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('todo')
    .setDescription('✅ Todo-list complète du serveur — cases à cocher, échéances, calendrier'),

  async execute(interaction) {
    await interaction.deferReply();
    const { getLimit } = require('../../utils/premium');
    const limit = await getLimit(interaction.guildId, 'todos');

    let view = 'list';
    let tasks = await fetchTasks(interaction.guildId);

    const reply = await interaction.editReply({
      embeds: [buildListEmbed(interaction.guild, tasks, limit)],
      components: buildPanelComponents(tasks, view),
    });

    const col = reply.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      time: 15 * 60 * 1000,
    });

    const refresh = async (i) => {
      tasks = await fetchTasks(interaction.guildId);
      const embed = view === 'list' ? buildListEmbed(interaction.guild, tasks, limit) : buildCalendarEmbed(interaction.guild, tasks);
      return i.update({ embeds: [embed], components: buildPanelComponents(tasks, view) });
    };

    col.on('collect', async (i) => {
      try {
        const id = i.customId;

        if (id === 'todo_refresh') return refresh(i);

        if (id === 'todo_list')     { view = 'list';     return refresh(i); }
        if (id === 'todo_calendar') { view = 'calendar';  tasks = await fetchTasks(interaction.guildId); return i.update({ embeds: [buildCalendarEmbed(interaction.guild, tasks)], components: buildPanelComponents(tasks, view) }); }

        if (id === 'todo_close') {
          await i.update({ components: [] });
          return;
        }

        // ── Cocher/décocher (menu multi-sélection = état des cases) ────────
        if (id === 'todo_toggle') {
          const selectedIds = new Set(i.values);
          const visible = tasks.slice(0, 25);
          for (const t of visible) {
            const shouldBeDone = selectedIds.has(String(t._id));
            if (shouldBeDone !== t.done) {
              t.done = shouldBeDone;
              t.doneBy = shouldBeDone ? i.user.id : null;
              await t.save();
            }
          }
          return refresh(i);
        }

        // ── Ajouter une tâche (modal : texte + échéance + priorité) ────────
        if (id === 'todo_add') {
          const currentCount = tasks.filter((t) => !t.done).length;
          if (currentCount >= limit) {
            return i.reply({
              embeds: [errorEmbed('Limite atteinte', `Tu as atteint la limite de **${limit} tâches actives**.\nTermine des tâches existantes ou utilise \`/premium\`.`)],
              flags: MessageFlags.Ephemeral,
            });
          }

          const modal = new ModalBuilder().setCustomId('todo_modal_add').setTitle('➕ Nouvelle tâche');
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('todo_text').setLabel('Tâche').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(200),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('todo_due').setLabel('Échéance (ex: 25/12 ou 25/12/2026)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('todo_priority').setLabel('Priorité (basse / normale / haute)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10),
            ),
          );
          await i.showModal(modal);

          const modalSubmit = await i.awaitModalSubmit({
            filter: (m) => m.customId === 'todo_modal_add' && m.user.id === interaction.user.id,
            time: 180_000,
          }).catch(() => null);
          if (!modalSubmit) return;

          const text = modalSubmit.fields.getTextInputValue('todo_text').trim();
          const dueRaw = modalSubmit.fields.getTextInputValue('todo_due');
          const prioRaw = modalSubmit.fields.getTextInputValue('todo_priority');

          const { date: dueDate, error: dueError } = parseDueDate(dueRaw);
          if (dueError) {
            return modalSubmit.reply({
              embeds: [errorEmbed('Échéance invalide', dueError)],
              flags: MessageFlags.Ephemeral,
            });
          }

          await Todo.create({
            guildId: interaction.guildId,
            createdBy: interaction.user.id,
            text,
            dueDate,
            priority: normalizePriority(prioRaw),
          });

          tasks = await fetchTasks(interaction.guildId);
          await modalSubmit.update({ embeds: [buildListEmbed(interaction.guild, tasks, limit)], components: buildPanelComponents(tasks, 'list') });
          view = 'list';
          return;
        }

        // ── Supprimer une tâche (select à choix unique) ─────────────────────
        if (id === 'todo_delete') {
          if (!tasks.length) return;
          const delMenu = new StringSelectMenuBuilder()
            .setCustomId('todo_delete_select')
            .setPlaceholder('🗑️ Choisir la tâche à supprimer...')
            .addOptions(tasks.slice(0, 25).map((t) => ({
              label: t.text.slice(0, 100),
              value: String(t._id),
              description: t.done ? 'Terminée' : 'À faire',
              emoji: t.done ? '✅' : '⬜',
            })));
          const row = new ActionRowBuilder().addComponents(delMenu);
          const msg = await i.reply({
            content: '**Quelle tâche supprimer ?**',
            components: [row],
            flags: MessageFlags.Ephemeral,
            fetchReply: true,
          });

          const picked = await msg.awaitMessageComponent({
            filter: (di) => di.user.id === interaction.user.id && di.customId === 'todo_delete_select',
            time: 60_000,
          }).catch(() => null);
          if (!picked) return i.editReply({ content: '⏱️ Temps écoulé.', components: [] }).catch(() => {});

          const target = tasks.find((t) => String(t._id) === picked.values[0]);
          await Todo.deleteOne({ _id: picked.values[0] });
          await picked.update({ content: `🗑️ Tâche supprimée : ${target?.text || ''}`, components: [] });

          tasks = await fetchTasks(interaction.guildId);
          const embed = view === 'list' ? buildListEmbed(interaction.guild, tasks, limit) : buildCalendarEmbed(interaction.guild, tasks);
          return interaction.editReply({ embeds: [embed], components: buildPanelComponents(tasks, view) }).catch(() => {});
        }
      } catch (err) {
        console.error('[Todo Panel]', err);
        const payload = { embeds: [errorEmbed('Erreur', 'Une erreur est survenue. Réessayez.')], flags: MessageFlags.Ephemeral };
        if (i.deferred || i.replied) await i.followUp(payload).catch(() => {});
        else await i.reply(payload).catch(() => {});
      }
    });

    col.on('end', () => { interaction.editReply({ components: [] }).catch(() => {}); });
  },
};