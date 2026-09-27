// commands/livre.js — Livre personnel avancé (chapitres, navigation, partage, recherche, export)
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
} = require('discord.js');
const Book = require('../../models/Book');
const { COLORS, successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { buildTextContent, buildPdfBuffer } = require('../../utils/bookExport');

const HEX_RE = /^#?[0-9A-Fa-f]{6}$/;

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizeColor(input) {
  if (!input) return null;
  const clean = input.startsWith('#') ? input : `#${input}`;
  return HEX_RE.test(clean) ? clean : null;
}

async function findBookByTitle(guildId, ownerId, title) {
  const books = await Book.find({ guildId, ownerId });
  return books.find(b => b.title.toLowerCase() === title.toLowerCase()) || null;
}

async function findAccessibleBook(guildId, userId, title) {
  const books = await Book.find({ guildId, $or: [{ ownerId: userId }, { sharedWith: userId }] });
  return books.find(b => b.title.toLowerCase() === title.toLowerCase()) || null;
}

function hasAccess(book, userId) {
  return book.ownerId === userId || book.sharedWith.includes(userId);
}

function sortedChapters(book) {
  return [...book.chapters].sort((a, b) => a.order - b.order);
}

function buildChapterEmbed(book, index) {
  const chapters = sortedChapters(book);
  const embed = new EmbedBuilder().setColor(book.coverColor || COLORS.primary);
  if (book.coverImage) embed.setThumbnail(book.coverImage);

  if (!chapters.length) {
    embed.setTitle(`📖 ${book.title}`);
    if (book.description) embed.setDescription(book.description);
    embed.addFields({ name: '\u200b', value: '_Ce livre ne contient encore aucun chapitre._' });
    return embed;
  }

  const chapter = chapters[index];
  embed.setTitle(`📖 ${book.title} — ${chapter.title}`);
  embed.setDescription(chapter.content);
  embed.setFooter({ text: `Chapitre ${index + 1} / ${chapters.length}` });
  return embed;
}

function buildTocEmbed(book) {
  const chapters = sortedChapters(book);
  const embed = new EmbedBuilder()
    .setColor(book.coverColor || COLORS.primary)
    .setTitle(`📚 ${book.title} — Sommaire`);
  if (book.description) embed.setDescription(book.description);
  if (book.coverImage) embed.setThumbnail(book.coverImage);

  if (!chapters.length) {
    embed.addFields({ name: '\u200b', value: '_Aucun chapitre pour le moment._' });
  } else {
    const toc = chapters.map((c, i) => `\`${i + 1}\` ${c.title}`).join('\n');
    embed.addFields({ name: `${chapters.length} chapitre(s)`, value: toc.slice(0, 1024) });
  }
  return embed;
}

function buildNavRow(book, index, requesterId, isOwner) {
  const chapters = sortedChapters(book);
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`livre_nav_${book._id}_${index - 1}_${requesterId}`)
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index <= 0),
    new ButtonBuilder()
      .setCustomId(`livre_toc_${book._id}_${requesterId}`)
      .setEmoji('📚')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!chapters.length),
    new ButtonBuilder()
      .setCustomId(`livre_nav_${book._id}_${index + 1}_${requesterId}`)
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index >= chapters.length - 1),
  );
  if (isOwner) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`livre_addchap_${book._id}_${requesterId}`)
        .setEmoji('➕')
        .setStyle(ButtonStyle.Success),
    );
  }
  return row;
}

function chapterModal(customId, { title = '', content = '' } = {}) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle('📖 Chapitre');
  const titleInput = new TextInputBuilder()
    .setCustomId('chap_title')
    .setLabel('Titre du chapitre')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true);
  if (title) titleInput.setValue(title);

  const contentInput = new TextInputBuilder()
    .setCustomId('chap_content')
    .setLabel('Contenu')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(4000)
    .setRequired(true);
  if (content) contentInput.setValue(content);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(contentInput),
  );
  return modal;
}

// ── Commande ─────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('livre')
    .setDescription('📖 Ton livre personnel — chapitres, navigation, partage et export')

    .addSubcommand(s => s.setName('creer').setDescription('Créer un nouveau livre')
      .addStringOption(o => o.setName('titre').setDescription('Titre du livre').setRequired(true).setMaxLength(100))
      .addStringOption(o => o.setName('description').setDescription('Courte description').setMaxLength(300))
      .addStringOption(o => o.setName('couleur').setDescription('Couleur de couverture (hex, ex: #5865F2)'))
      .addStringOption(o => o.setName('image').setDescription('URL d\'image de couverture')))

    .addSubcommand(s => s.setName('couverture').setDescription('Modifier la couverture d\'un livre')
      .addStringOption(o => o.setName('titre').setDescription('Livre à modifier').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('nouveau_titre').setDescription('Nouveau titre').setMaxLength(100))
      .addStringOption(o => o.setName('description').setDescription('Nouvelle description').setMaxLength(300))
      .addStringOption(o => o.setName('couleur').setDescription('Nouvelle couleur (hex)'))
      .addStringOption(o => o.setName('image').setDescription('Nouvelle URL d\'image')))

    .addSubcommand(s => s.setName('liste').setDescription('Voir la liste de tes livres'))
    .addSubcommand(s => s.setName('partages').setDescription('Voir les livres partagés avec toi'))

    .addSubcommand(s => s.setName('ouvrir').setDescription('Ouvrir un livre et naviguer dans ses chapitres')
      .addStringOption(o => o.setName('titre').setDescription('Titre du livre').setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName('page').setDescription('Numéro du chapitre à afficher').setMinValue(1)))

    .addSubcommand(s => s.setName('sommaire').setDescription('Voir le sommaire d\'un livre')
      .addStringOption(o => o.setName('titre').setDescription('Titre du livre').setRequired(true).setAutocomplete(true)))

    .addSubcommand(s => s.setName('supprimer').setDescription('Supprimer un livre entier')
      .addStringOption(o => o.setName('titre').setDescription('Titre du livre').setRequired(true).setAutocomplete(true)))

    .addSubcommand(s => s.setName('rechercher').setDescription('Rechercher un mot dans tes livres (ou un livre précis)')
      .addStringOption(o => o.setName('terme').setDescription('Terme à rechercher').setRequired(true))
      .addStringOption(o => o.setName('titre').setDescription('Limiter la recherche à un livre').setAutocomplete(true)))

    .addSubcommand(s => s.setName('exporter').setDescription('Exporter un livre en fichier')
      .addStringOption(o => o.setName('titre').setDescription('Titre du livre').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('format').setDescription('Format du fichier').addChoices(
        { name: 'Texte (.txt)', value: 'txt' },
        { name: 'PDF (.pdf)', value: 'pdf' },
      )))

    .addSubcommandGroup(g => g.setName('chapitre').setDescription('Gérer les chapitres d\'un livre')
      .addSubcommand(s => s.setName('ajouter').setDescription('Ajouter un chapitre')
        .addStringOption(o => o.setName('titre').setDescription('Livre concerné').setRequired(true).setAutocomplete(true)))
      .addSubcommand(s => s.setName('editer').setDescription('Éditer un chapitre existant')
        .addStringOption(o => o.setName('titre').setDescription('Livre concerné').setRequired(true).setAutocomplete(true))
        .addIntegerOption(o => o.setName('numero').setDescription('Numéro du chapitre').setRequired(true).setMinValue(1)))
      .addSubcommand(s => s.setName('supprimer').setDescription('Supprimer un chapitre')
        .addStringOption(o => o.setName('titre').setDescription('Livre concerné').setRequired(true).setAutocomplete(true))
        .addIntegerOption(o => o.setName('numero').setDescription('Numéro du chapitre').setRequired(true).setMinValue(1)))
      .addSubcommand(s => s.setName('deplacer').setDescription('Déplacer un chapitre (réordonner)')
        .addStringOption(o => o.setName('titre').setDescription('Livre concerné').setRequired(true).setAutocomplete(true))
        .addIntegerOption(o => o.setName('numero').setDescription('Numéro actuel').setRequired(true).setMinValue(1))
        .addIntegerOption(o => o.setName('nouvelle_position').setDescription('Nouvelle position').setRequired(true).setMinValue(1))))

    .addSubcommandGroup(g => g.setName('partage').setDescription('Gérer le partage d\'un livre')
      .addSubcommand(s => s.setName('ajouter').setDescription('Partager un livre avec quelqu\'un')
        .addStringOption(o => o.setName('titre').setDescription('Livre concerné').setRequired(true).setAutocomplete(true))
        .addUserOption(o => o.setName('utilisateur').setDescription('Personne avec qui partager').setRequired(true)))
      .addSubcommand(s => s.setName('retirer').setDescription('Retirer l\'accès partagé')
        .addStringOption(o => o.setName('titre').setDescription('Livre concerné').setRequired(true).setAutocomplete(true))
        .addUserOption(o => o.setName('utilisateur').setDescription('Personne à retirer').setRequired(true)))),

  // ── Autocomplete ──────────────────────────────────────────────────────
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'titre') return interaction.respond([]);

    const sub = interaction.options.getSubcommand(false);
    const includeShared = sub === 'ouvrir' || sub === 'sommaire' || sub === 'rechercher';

    const query = includeShared
      ? { guildId: interaction.guildId, $or: [{ ownerId: interaction.user.id }, { sharedWith: interaction.user.id }] }
      : { guildId: interaction.guildId, ownerId: interaction.user.id };

    const books = await Book.find(query).select('title').limit(25).lean();
    const search = (focused.value || '').toLowerCase();
    const filtered = books
      .filter(b => b.title.toLowerCase().includes(search))
      .slice(0, 25)
      .map(b => ({ name: b.title, value: b.title }));

    return interaction.respond(filtered);
  },

  // ── Exécution des sous-commandes ─────────────────────────────────────
  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === 'chapitre') return handleChapitre(interaction, sub);
    if (group === 'partage') return handlePartage(interaction, sub);

    switch (sub) {
      case 'creer':       return handleCreer(interaction);
      case 'couverture':  return handleCouverture(interaction);
      case 'liste':       return handleListe(interaction);
      case 'partages':    return handlePartages(interaction);
      case 'ouvrir':      return handleOuvrir(interaction);
      case 'sommaire':    return handleSommaire(interaction);
      case 'supprimer':   return handleSupprimer(interaction);
      case 'rechercher':  return handleRechercher(interaction);
      case 'exporter':    return handleExporter(interaction);
    }
  },

  // ── Boutons ───────────────────────────────────────────────────────────
  async handleButton(interaction) {
    const [, action, bookId, arg1, arg2] = interaction.customId.split('_');

    if (action === 'nav' || action === 'toc') {
      const requesterId = action === 'nav' ? arg2 : arg1;
      if (interaction.user.id !== requesterId) {
        return interaction.reply({ embeds: [errorEmbed('Non autorisé', 'Seule la personne qui a ouvert ce livre peut naviguer.')], ephemeral: true });
      }
      const book = await Book.findById(bookId);
      if (!book || !hasAccess(book, interaction.user.id)) {
        return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Ce livre n\'existe plus ou tu n\'y as plus accès.')], ephemeral: true });
      }
      const isOwner = book.ownerId === interaction.user.id;

      if (action === 'toc') {
        return interaction.update({ embeds: [buildTocEmbed(book)], components: [buildNavRow(book, 0, requesterId, isOwner)] });
      }

      const chapters = sortedChapters(book);
      let index = parseInt(arg1, 10);
      if (Number.isNaN(index)) index = 0;
      index = Math.max(0, Math.min(index, Math.max(chapters.length - 1, 0)));
      return interaction.update({ embeds: [buildChapterEmbed(book, index)], components: [buildNavRow(book, index, requesterId, isOwner)] });
    }

    if (action === 'addchap') {
      const requesterId = arg1;
      if (interaction.user.id !== requesterId) {
        return interaction.reply({ embeds: [errorEmbed('Non autorisé', 'Seul l\'auteur du livre peut ajouter un chapitre.')], ephemeral: true });
      }
      const book = await Book.findById(bookId);
      if (!book || book.ownerId !== interaction.user.id) {
        return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Ce livre n\'existe plus ou tu n\'en es plus l\'auteur.')], ephemeral: true });
      }
      return interaction.showModal(chapterModal(`livre_modal_add_${book._id}`));
    }
  },

  // ── Modaux ────────────────────────────────────────────────────────────
  async handleModal(interaction) {
    const parts = interaction.customId.split('_'); // livre_modal_add_<id> | livre_modal_edit_<id>_<index>
    const action = parts[2];
    const bookId = parts[3];

    const book = await Book.findById(bookId);
    if (!book || book.ownerId !== interaction.user.id) {
      return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Ce livre n\'existe plus ou tu n\'en es plus l\'auteur.')], ephemeral: true });
    }

    const title = interaction.fields.getTextInputValue('chap_title').trim();
    const content = interaction.fields.getTextInputValue('chap_content').trim();

    if (action === 'add') {
      const nextOrder = book.chapters.length ? Math.max(...book.chapters.map(c => c.order)) + 1 : 0;
      book.chapters.push({ title, content, order: nextOrder });
      book.updatedAt = new Date();
      await book.save();
      const index = sortedChapters(book).findIndex(c => c.order === nextOrder);
      return interaction.reply({
        embeds: [buildChapterEmbed(book, index)],
        components: [buildNavRow(book, index, interaction.user.id, true)],
        ephemeral: true,
      });
    }

    if (action === 'edit') {
      const index = parseInt(parts[4], 10);
      const chapters = sortedChapters(book);
      const target = chapters[index];
      if (!target) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Ce chapitre n\'existe plus.')], ephemeral: true });

      const chapDoc = book.chapters.id(target._id);
      chapDoc.title = title;
      chapDoc.content = content;
      chapDoc.updatedAt = new Date();
      book.updatedAt = new Date();
      await book.save();

      return interaction.reply({
        embeds: [buildChapterEmbed(book, index)],
        components: [buildNavRow(book, index, interaction.user.id, true)],
        ephemeral: true,
      });
    }
  },
};

// ── Implémentations des sous-commandes simples ────────────────────────────

async function handleCreer(interaction) {
  const titre = interaction.options.getString('titre');
  const description = interaction.options.getString('description');
  const couleurInput = interaction.options.getString('couleur');
  const image = interaction.options.getString('image');

  const existing = await findBookByTitle(interaction.guildId, interaction.user.id, titre);
  if (existing) {
    return interaction.reply({ embeds: [errorEmbed('Titre déjà utilisé', 'Tu as déjà un livre avec ce titre.')], ephemeral: true });
  }

  let coverColor = '#5865F2';
  if (couleurInput) {
    const normalized = normalizeColor(couleurInput);
    if (!normalized) return interaction.reply({ embeds: [errorEmbed('Couleur invalide', 'Utilise un format hexadécimal, ex: `#5865F2`.')], ephemeral: true });
    coverColor = normalized;
  }

  const book = await Book.create({
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    title: titre,
    description: description || null,
    coverColor,
    coverImage: image || null,
  });

  const embed = successEmbed('Livre créé', `📖 **${book.title}** a été créé.\nUtilise \`/livre chapitre ajouter\` pour écrire ton premier chapitre.`);
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleCouverture(interaction) {
  const titre = interaction.options.getString('titre');
  const book = await findBookByTitle(interaction.guildId, interaction.user.id, titre);
  if (!book) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Aucun livre à toi ne porte ce titre.')], ephemeral: true });

  const nouveauTitre = interaction.options.getString('nouveau_titre');
  const description = interaction.options.getString('description');
  const couleurInput = interaction.options.getString('couleur');
  const image = interaction.options.getString('image');

  if (nouveauTitre) book.title = nouveauTitre;
  if (description !== null) book.description = description || null;
  if (couleurInput) {
    const normalized = normalizeColor(couleurInput);
    if (!normalized) return interaction.reply({ embeds: [errorEmbed('Couleur invalide', 'Utilise un format hexadécimal, ex: `#5865F2`.')], ephemeral: true });
    book.coverColor = normalized;
  }
  if (image !== null) book.coverImage = image || null;

  book.updatedAt = new Date();
  await book.save();

  return interaction.reply({ embeds: [successEmbed('Couverture mise à jour', `📖 **${book.title}**`)], ephemeral: true });
}

async function handleListe(interaction) {
  const books = await Book.find({ guildId: interaction.guildId, ownerId: interaction.user.id }).sort({ createdAt: 1 });
  if (!books.length) {
    return interaction.reply({ embeds: [errorEmbed('Aucun livre', 'Utilise `/livre creer` pour commencer ton premier livre.')], ephemeral: true });
  }

  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle('📚 Tes livres');
  embed.setDescription(books.map(b => {
    const shared = b.sharedWith.length ? ` · partagé avec ${b.sharedWith.length}` : '';
    return `**${b.title}** — ${b.chapters.length} chapitre(s)${shared}`;
  }).join('\n'));
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handlePartages(interaction) {
  const books = await Book.find({ guildId: interaction.guildId, sharedWith: interaction.user.id }).sort({ createdAt: 1 });
  if (!books.length) {
    return interaction.reply({ embeds: [errorEmbed('Rien de partagé', 'Personne ne t\'a encore partagé de livre.')], ephemeral: true });
  }
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle('📚 Livres partagés avec toi');
  embed.setDescription(books.map(b => `**${b.title}** — par <@${b.ownerId}> — ${b.chapters.length} chapitre(s)`).join('\n'));
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleOuvrir(interaction) {
  const titre = interaction.options.getString('titre');
  const page = interaction.options.getInteger('page');
  const book = await findAccessibleBook(interaction.guildId, interaction.user.id, titre);
  if (!book) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Ce livre n\'existe pas ou n\'a pas été partagé avec toi.')], ephemeral: true });

  const isOwner = book.ownerId === interaction.user.id;
  const chapters = sortedChapters(book);
  let index = page ? page - 1 : 0;
  index = Math.max(0, Math.min(index, Math.max(chapters.length - 1, 0)));

  return interaction.reply({
    embeds: [buildChapterEmbed(book, index)],
    components: [buildNavRow(book, index, interaction.user.id, isOwner)],
    ephemeral: true,
  });
}

async function handleSommaire(interaction) {
  const titre = interaction.options.getString('titre');
  const book = await findAccessibleBook(interaction.guildId, interaction.user.id, titre);
  if (!book) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Ce livre n\'existe pas ou n\'a pas été partagé avec toi.')], ephemeral: true });

  const isOwner = book.ownerId === interaction.user.id;
  return interaction.reply({ embeds: [buildTocEmbed(book)], components: [buildNavRow(book, 0, interaction.user.id, isOwner)], ephemeral: true });
}

async function handleSupprimer(interaction) {
  const titre = interaction.options.getString('titre');
  const book = await findBookByTitle(interaction.guildId, interaction.user.id, titre);
  if (!book) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Aucun livre à toi ne porte ce titre.')], ephemeral: true });

  await Book.deleteOne({ _id: book._id });
  return interaction.reply({ embeds: [successEmbed('Livre supprimé', `🗑️ **${book.title}** a été supprimé définitivement.`)], ephemeral: true });
}

async function handleRechercher(interaction) {
  const terme = interaction.options.getString('terme').toLowerCase();
  const titreFiltre = interaction.options.getString('titre');

  const query = { guildId: interaction.guildId, $or: [{ ownerId: interaction.user.id }, { sharedWith: interaction.user.id }] };
  let books = await Book.find(query);
  if (titreFiltre) books = books.filter(b => b.title.toLowerCase() === titreFiltre.toLowerCase());

  const results = [];
  for (const book of books) {
    for (const chapter of sortedChapters(book)) {
      const inTitle = chapter.title.toLowerCase().includes(terme);
      const inContent = chapter.content.toLowerCase().includes(terme);
      if (inTitle || inContent) {
        let snippet = chapter.title;
        if (inContent) {
          const idx = chapter.content.toLowerCase().indexOf(terme);
          const start = Math.max(0, idx - 40);
          snippet = `…${chapter.content.slice(start, start + 120).trim()}…`;
        }
        results.push(`**${book.title}** › ${chapter.title}\n${snippet}`);
      }
    }
    if (results.length >= 15) break;
  }

  if (!results.length) {
    return interaction.reply({ embeds: [errorEmbed('Aucun résultat', `Rien trouvé pour « ${terme} ».`)], ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`🔎 Résultats pour « ${terme} »`)
    .setDescription(results.slice(0, 10).join('\n\n').slice(0, 4000));
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleExporter(interaction) {
  const titre = interaction.options.getString('titre');
  const format = interaction.options.getString('format') || 'txt';
  const book = await findAccessibleBook(interaction.guildId, interaction.user.id, titre);
  if (!book) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Ce livre n\'existe pas ou n\'a pas été partagé avec toi.')], ephemeral: true });

  await interaction.deferReply({ ephemeral: true });
  const safeName = book.title.replace(/[^a-z0-9\-_]+/gi, '_').slice(0, 40) || 'livre';

  if (format === 'pdf') {
    const pdfBuffer = await buildPdfBuffer(book).catch(() => null);
    if (pdfBuffer) {
      const file = new AttachmentBuilder(pdfBuffer, { name: `${safeName}.pdf` });
      return interaction.editReply({ content: `📖 Export de **${book.title}** :`, files: [file] });
    }
    // Module pdfkit absent ou erreur → repli automatique sur le texte
    const txt = new AttachmentBuilder(Buffer.from(buildTextContent(book), 'utf-8'), { name: `${safeName}.txt` });
    return interaction.editReply({
      embeds: [infoEmbed('Export PDF indisponible', 'Le module `pdfkit` n\'est pas installé sur ce serveur — export en `.txt` à la place.\n(Ajoute `pdfkit` aux dépendances puis `npm install` pour activer le PDF.)')],
      files: [txt],
    });
  }

  const txt = new AttachmentBuilder(Buffer.from(buildTextContent(book), 'utf-8'), { name: `${safeName}.txt` });
  return interaction.editReply({ content: `📖 Export de **${book.title}** :`, files: [txt] });
}

// ── /livre chapitre … ──────────────────────────────────────────────────

async function handleChapitre(interaction, sub) {
  const titre = interaction.options.getString('titre');
  const book = await findBookByTitle(interaction.guildId, interaction.user.id, titre);
  if (!book) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Aucun livre à toi ne porte ce titre.')], ephemeral: true });

  if (sub === 'ajouter') {
    return interaction.showModal(chapterModal(`livre_modal_add_${book._id}`));
  }

  const numero = interaction.options.getInteger('numero');
  const chapters = sortedChapters(book);
  const index = numero - 1;
  const target = chapters[index];
  if (!target) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Numéro de chapitre invalide.')], ephemeral: true });

  if (sub === 'editer') {
    return interaction.showModal(chapterModal(`livre_modal_edit_${book._id}_${index}`, { title: target.title, content: target.content }));
  }

  if (sub === 'supprimer') {
    book.chapters.pull({ _id: target._id });
    book.updatedAt = new Date();
    await book.save();
    return interaction.reply({ embeds: [successEmbed('Chapitre supprimé', `🗑️ « ${target.title} » a été retiré de **${book.title}**.`)], ephemeral: true });
  }

  if (sub === 'deplacer') {
    const nouvellePosition = interaction.options.getInteger('nouvelle_position');
    const newIndex = Math.max(0, Math.min(nouvellePosition - 1, chapters.length - 1));
    if (newIndex === index) {
      return interaction.reply({ embeds: [infoEmbed('Aucun changement', 'Le chapitre est déjà à cette position.')], ephemeral: true });
    }
    const reordered = chapters.filter((_, i) => i !== index);
    reordered.splice(newIndex, 0, target);
    reordered.forEach((c, i) => { book.chapters.id(c._id).order = i; });
    book.updatedAt = new Date();
    await book.save();
    return interaction.reply({ embeds: [successEmbed('Chapitre déplacé', `📖 « ${target.title} » est maintenant en position **${newIndex + 1}**.`)], ephemeral: true });
  }
}

// ── /livre partage … ───────────────────────────────────────────────────

async function handlePartage(interaction, sub) {
  const titre = interaction.options.getString('titre');
  const utilisateur = interaction.options.getUser('utilisateur');
  const book = await findBookByTitle(interaction.guildId, interaction.user.id, titre);
  if (!book) return interaction.reply({ embeds: [errorEmbed('Introuvable', 'Aucun livre à toi ne porte ce titre.')], ephemeral: true });

  if (utilisateur.id === interaction.user.id) {
    return interaction.reply({ embeds: [errorEmbed('Action impossible', 'Tu es déjà l\'auteur de ce livre.')], ephemeral: true });
  }

  if (sub === 'ajouter') {
    if (book.sharedWith.includes(utilisateur.id)) {
      return interaction.reply({ embeds: [errorEmbed('Déjà partagé', `${utilisateur} a déjà accès à ce livre.`)], ephemeral: true });
    }
    book.sharedWith.push(utilisateur.id);
    await book.save();
    return interaction.reply({ embeds: [successEmbed('Livre partagé', `📖 **${book.title}** est maintenant visible par ${utilisateur}.`)], ephemeral: true });
  }

  if (sub === 'retirer') {
    if (!book.sharedWith.includes(utilisateur.id)) {
      return interaction.reply({ embeds: [errorEmbed('Non partagé', `${utilisateur} n\'a pas accès à ce livre.`)], ephemeral: true });
    }
    book.sharedWith = book.sharedWith.filter(id => id !== utilisateur.id);
    await book.save();
    return interaction.reply({ embeds: [successEmbed('Accès retiré', `🚫 ${utilisateur} n\'a plus accès à **${book.title}**.`)], ephemeral: true });
  }
}
