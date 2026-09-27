// events/interactionCreate.js — Handler central complet
const { EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/embeds');
const blacklist = require('../../utils/blacklist');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {

    // ── Blacklist globale — aucun module du bot ne répond sur ces serveurs ──
    if (interaction.inGuild() && blacklist.isBlacklisted(interaction.guildId)) {
      if (interaction.isRepliable() && !interaction.deferred && !interaction.replied) {
        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(COLORS.error)
            .setTitle('⛔ Serveur blacklisté')
            .setDescription('Ce serveur est blacklisté globalement. Aucune fonctionnalité du bot n\'est disponible ici.')],
          ephemeral: true,
        }).catch(() => {});
      }
      return;
    }

    // ── Slash commands ────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction, client);
      } catch (err) {
        console.error(`❌ /${interaction.commandName}:`, err);
        const errEmbed = new EmbedBuilder()
          .setColor(COLORS.error)
          .setTitle('❌ Une erreur est survenue')
          .setDescription('Veuillez réessayer dans quelques instants.');
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ embeds: [errEmbed] }).catch(() => {});
        } else {
          await interaction.reply({ embeds: [errEmbed], ephemeral: true }).catch(() => {});
        }
      }
      return;
    }

    // ── Modaux ────────────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      const id = interaction.customId;

      if (id.startsWith('authgate_confirm_')) {
        const authGate = require('../../utils/authGate');
        await authGate.handleModal(interaction).catch(console.error);
        return;
      }
      if (id.startsWith('auth_')) {
        const cmd = client.commands.get('auth-profil');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }
      if (id.startsWith('sugpanel_')) {
        const cmd = client.commands.get('suggestion');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }
      if (id.startsWith('avispanel_')) {
        const cmd = client.commands.get('avis-panel');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }
      if (id.startsWith('avis_reply_modal_')) {
        const cmd = client.commands.get('avis');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }
      if (id === 'planet_rename_modal') {
        const cmd = client.commands.get('planet');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }
      if (id.startsWith('bumpnotif_modal_')) {
        const cmd = client.commands.get('bump-notif');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }
      if (id.startsWith('mpreq_modal_')) {
        const cmd = client.commands.get('demande-mp');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }
      if (['modal_description', 'modal_invite', 'modal_tags'].includes(id)) {
        const cmd = client.commands.get('config');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }
      if (id === 'help_search_modal') {
        const cmd = client.commands.get('help');
        if (cmd?.handleSearchModal) await cmd.handleSearchModal(interaction).catch(console.error);
        return;
      }
      if (id === 'modal_welcome_message') {
        const cmd = client.commands.get('welcome-set');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }
      if (id === 'modal_farewell_message') {
        const cmd = client.commands.get('farewell-set');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }
      if (id === 'is_modal_create' || id === 'is_modal_join') {
        const cmd = client.commands.get('interserveur');
        if (cmd?.handleModal) await cmd.handleModal(interaction, client).catch(console.error);
        return;
      }
      if (id === 'confession_submit') {
        const cmd = client.commands.get('confession');
        if (cmd?.handleConfessionModal) await cmd.handleConfessionModal(interaction, client).catch(console.error);
        return;
      }
      if (id === 'conf_cooldown_modal') {
        const cmd = client.commands.get('confession');
        if (cmd?.handleCooldownModal) await cmd.handleCooldownModal(interaction).catch(console.error);
        return;
      }
      if (id.startsWith('emb_modal_')) {
        const cmd = client.commands.get('embed');
        if (cmd?.handleEmbedModal) await cmd.handleEmbedModal(interaction).catch(console.error);
        return;
      }
      if (id.startsWith('mq_')) {
        const cmd = client.commands.get('mathquiz');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }
      if (id.startsWith('captcha_submit_')) {
        const { handleCaptchaSubmit } = require('../../commands/configuration/captcha');
        await handleCaptchaSubmit(interaction).catch(console.error);
        return;
      }
      if (id === 'captcha_advanced_modal') {
        const cmd = client.commands.get('captcha');
        if (cmd?.handleAdvancedModal) await cmd.handleAdvancedModal(interaction).catch(console.error);
        return;
      }
      if (id === 'captcha_antibot_modal') {
        const cmd = client.commands.get('captcha');
        if (cmd?.handleAntiBotModal) await cmd.handleAntiBotModal(interaction).catch(console.error);
        return;
      }
      if (id === 'hp_advanced_modal') {
        const cmd = client.commands.get('honeypot');
        if (cmd?.handleAdvancedModal) await cmd.handleAdvancedModal(interaction).catch(console.error);
        return;
      }
      if (id.startsWith('sb_modal_')) {
        const cmd = client.commands.get('starboard');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }
      if (id.startsWith('rd_modal_')) {
        const cmd = client.commands.get('reddit-annonce');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }
      if (id.startsWith('ob_modal_')) {
        const cmd = client.commands.get('onboarding');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }
      if (id === 'lvl_xp_modal') {
        const cmd = client.commands.get('leveling');
        if (cmd?.handleXpModal) await cmd.handleXpModal(interaction).catch(console.error);
        return;
      }
      if (id === 'lvl_color_modal') {
        const cmd = client.commands.get('leveling');
        if (cmd?.handleColorModal) await cmd.handleColorModal(interaction).catch(console.error);
        return;
      }
      if (id.startsWith('lvl_mult_channel_modal_') || id.startsWith('lvl_mult_role_modal_')) {
        const cmd = client.commands.get('leveling');
        if (cmd?.handleMultiplierModal) await cmd.handleMultiplierModal(interaction, id).catch(console.error);
        return;
      }
      if (id === 'bst_message_modal') {
        const cmd = client.commands.get('boost');
        if (cmd?.handleMessageModal) await cmd.handleMessageModal(interaction).catch(console.error);
        return;
      }
      if (id === 'bst_color_modal_submit') {
        const cmd = client.commands.get('boost');
        if (cmd?.handleColorModal) await cmd.handleColorModal(interaction).catch(console.error);
        return;
      }
      if (id === 'bst_image_modal_submit') {
        const cmd = client.commands.get('boost');
        if (cmd?.handleImageModal) await cmd.handleImageModal(interaction).catch(console.error);
        return;
      }
            // ── Ticket v4 — modaux
      if (id.startsWith('ticket_close_modal_') || id.startsWith('ticket_priority_modal_')) {
        const cmd = client.commands.get('ticket');
        if (id.startsWith('ticket_close_modal_') && cmd?.handleModal) await cmd.handleModal(interaction, client).catch(console.error);
        if (id.startsWith('ticket_priority_modal_')) {
          const ticketId = id.replace('ticket_priority_modal_', '');
          const niveau = interaction.fields.getTextInputValue('niveau').toLowerCase().trim();
          const valid = ['low','normal','high','urgent'];
          if (!valid.includes(niveau)) return interaction.reply({ content: 'Priorité invalide. Utilisez: low, normal, high, urgent', ephemeral: true });
          const { Ticket } = require('../../models/Ticket');
          const ticket = await Ticket.findById(ticketId).catch(() => null);
          if (ticket) { ticket.priority = niveau; await ticket.save(); }
          const pr = { low: { emoji: '🟢', label: 'Basse', color: 0x2ECC71 }, normal: { emoji: '🔵', label: 'Normale', color: 0x3498DB }, high: { emoji: '🟠', label: 'Haute', color: 0xF39C12 }, urgent: { emoji: '🔴', label: 'Urgente', color: 0xE74C3C } }[niveau];
          await interaction.channel?.setTopic(`Ticket #${ticket?.number} — Priorité: ${pr.label}`).catch(()=>{});
          return interaction.reply({ embeds: [new (require('discord.js').EmbedBuilder)().setColor(pr.color).setTitle(`${pr.emoji} Priorité: ${pr.label}`).setTimestamp()] });
        }
        return;
      }

      // ── ModMail — modaux
      if (
        id.startsWith('mm_modal_reply_') ||
        id.startsWith('mm_modal_anon_')  ||
        id.startsWith('mm_close_modal_') ||
        id === 'mm_config_welcome'        ||
        id === 'mm_config_close'
      ) {
        const cmd = client.commands.get('modmail');
        if (cmd?.handleModal) await cmd.handleModal(interaction, client).catch(console.error);
        return;
      }

      // ── Panneau Sécurité — modaux
      if (
        id === 'sec_modal_spam' ||
        id === 'sec_modal_raid' ||
        id === 'sec_modal_caps' ||
        id === 'sec_modal_links_wl' ||
        id === 'sec_modal_cap_config' ||
        id === 'sec_modal_spamadv' ||
        id === 'sec_modal_mention' ||
        id === 'sec_modal_graduated' ||
        id.startsWith('sec_modal_wf_')
      ) {
        const cmd = client.commands.get('securite');
        if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
        return;
      }

      // Réseau inter-serveur — modal ban/signalement
      if (id.startsWith('is_ban_modal_') || id.startsWith('is_report_modal_')) {
        const cmd = client.commands.get('interserveur');
        if (cmd?.handleNetworkModal) await cmd.handleNetworkModal(interaction, client).catch(console.error);
        return;
      }
      return;
    }

    // ── Sélecteurs panneau sécurité (gérés par collecteur interne) ──────────
    if (interaction.isAnySelectMenu()) {
      const secIds = ['sec_logs_channel','sec_exempt_role_select','sec_exempt_chan_select','mm_set_category','mm_set_log','mm_set_role'];
      if (secIds.includes(interaction.customId)) return;
    }

    // ── ChannelSelectMenu inter-serveur ───────────────────────────────────
    if (interaction.isChannelSelectMenu() && (
      interaction.customId.startsWith('is_create_channel_select:') ||
      interaction.customId.startsWith('is_join_channel_select:')
    )) {
      const cmd = client.commands.get('interserveur');
      if (cmd?.handleChannelSelect) await cmd.handleChannelSelect(interaction, client).catch(console.error);
      return;
    }

    // ── Boutons ───────────────────────────────────────────────────────────
    if (interaction.isButton()) {
      const id = interaction.customId;

      // Panneau sécurité — tous les boutons commençant par sec_ sont gérés par le collecteur interne
      if (id.startsWith('sec_')) return;

      // Pagination Twitch — gérée par le collecteur interne de la commande
      if (id.startsWith('twpage_')) return;

      // Panel de suggestions & stats en direct — gérés par les collecteurs internes de suggestion.js
      if (id.startsWith('sugpanel_') || id.startsWith('sugstats_')) return;

      // Panel d'avis, stats en direct, navigation "voir" — gérés par les collecteurs internes de avis.js
      if (id.startsWith('avispanel_') || id.startsWith('avisstats_') || id.startsWith('avis_prev') || id.startsWith('avis_next') || id.startsWith('avis_close') || id.startsWith('avis_helpful_') || id.startsWith('avis_report') || id.startsWith('avis_reply')) return;

      // Panel de notifications de bump — géré par le collecteur interne de bump-notif.js
      if (id.startsWith('bumpnotif_')) return;

      // Jeu /planet — géré par le collecteur interne de planet.js
      if (id.startsWith('planet_')) return;

      // Panel AI Playground — géré par le collecteur interne de ai-playground.js
      if (id.startsWith('aiplay_')) return;

      // Panel Demande de MP — géré par le collecteur interne de demande-mp.js
      if (id.startsWith('mpreq_')) return;

      // Demande de MP — réponse Accepter/Refuser (bouton persistant sur message public)
      if (id.startsWith('mpans_accept_') || id.startsWith('mpans_reject_')) {
        const { handleRequestButton } = require('../../utils/mpRequestHandler');
        await handleRequestButton(interaction).catch(console.error);
        return;
      }

      // Jeu /joke v2 — géré par le collecteur interne de joke.js
      if (id.startsWith('joke_')) return;

      // Pagination de l'historique des bumps — géré par le collecteur interne de bump-historique.js
      if (id.startsWith('bumphist_')) return;

      // File de modération des avis — boutons persistants dans le salon de logs
      if (id.startsWith('avis_approve_') || id.startsWith('avis_reject_')) {
        const cmd = client.commands.get('avis');
        if (cmd?.handleModerationButton) await cmd.handleModerationButton(interaction).catch(console.error);
        return;
      }

      // Bouton piège Honeypot — persistant dans les salons piège (pas le panel)
      if (id === 'hp_trap_click') {
        const cmd = client.commands.get('honeypot');
        if (cmd?.handleButtonTrigger) await cmd.handleButtonTrigger(interaction).catch(console.error);
        return;
      }

      // Onboarding — réponses à choix multiples / bouton "Passer" (salon privé du membre)
      if (id.startsWith('ob_answer:') || id.startsWith('ob_skip:')) {
        try {
          const OnboardingSession = require('../../models/OnboardingSession');
          const OnboardingConfig = require('../../models/OnboardingConfig');
          const session = await OnboardingSession.findOne({ guildId: interaction.guild.id, userId: interaction.user.id, channelId: interaction.channel.id, completed: false });
          if (session) {
            const obCfg = await OnboardingConfig.findOne({ guildId: interaction.guild.id });
            if (obCfg) {
              const { handleChoiceAnswer, handleSkip } = require('../../utils/onboardingManager');
              if (id.startsWith('ob_answer:')) await handleChoiceAnswer(interaction, session, obCfg);
              else await handleSkip(interaction, session, obCfg);
            }
          }
        } catch (err) { console.error('onboarding button:', err.message); }
        return;
      }

      // Profil d'authentification personnel (PIN / 2FA / Passkeys)
      if (id.startsWith('auth_')) {
        const cmd = client.commands.get('auth-profil');
        if (cmd?.handleButton) await cmd.handleButton(interaction).catch(console.error);
        return;
      }

      // Notifications — boutons panel live
      if (id.startsWith('notif_')) {
        const cmd = client.commands.get('notifications');
        if (cmd?.handleButton) await cmd.handleButton(interaction, client).catch(console.error);
        return;
      }

      // News — navigation articles
      if (id === 'news_prev' || id === 'news_next') return; // géré par collecteur interne

      // FreeGames — boutons de navigation (pagination)
      if (id === 'fg_prev' || id === 'fg_next') return; // géré par collecteur interne

      // ModMail — boutons (répondre, fermer, snippet)
      if (id.startsWith('mm_reply_') || id.startsWith('mm_close_') || id.startsWith('mm_snippet_')) {
        const cmd = client.commands.get('modmail');
        if (cmd?.handleButton) await cmd.handleButton(interaction, client).catch(console.error);
        return;
      }

      // Ping bot → ouvrir commande
      if (id.startsWith('ping_open_')) {
        const action  = id.replace('ping_open_', '');
        const cmdName = { config: 'config', interserveur: 'interserveur', help: 'help', panel: 'panel' }[action];
        if (cmdName) {
          const cmd = client.commands.get(cmdName);
          if (cmd) await cmd.execute(interaction, client).catch(console.error);
        }
        return;
      }

      // Duel — accepter / refuser
      if (id.startsWith('duel_accept_')) {
        const parts = id.split('_');
        const p1Id = parts[2], p2Id = parts[3], wagerStr = parts[4];
        const cmd = client.commands.get('duel');
        if (cmd?.handleAccept) await cmd.handleAccept(interaction, p1Id, p2Id, parseInt(wagerStr) || 0).catch(console.error);
        return;
      }
      if (id.startsWith('duel_decline_')) {
        const parts = id.split('_');
        const p1Id = parts[2];
        const cmd = client.commands.get('duel');
        if (cmd?.handleDecline) await cmd.handleDecline(interaction, p1Id).catch(console.error);
        return;
      }

      // Event — participer
      if (id.startsWith('event_join_')) {
        const eventId = id.replace('event_join_', '');
        const cmd = client.commands.get('event');
        if (cmd?.handleJoin) await cmd.handleJoin(interaction, eventId).catch(console.error);
        return;
      }

      // Règlement — accepter
      if (id === 'reglement_accept') {
        const cmd = client.commands.get('reglement');
        if (cmd?.handleAccept) await cmd.handleAccept(interaction).catch(console.error);
        return;
      }

      // Rappel bump → message éphémère
      if (id === 'bump_reminder_click') {
        return interaction.reply({ content: '🚀 Utilisez `/bump` pour bumper votre serveur !', ephemeral: true });
      }

      // Voir stats après bump — version corrigée (reply éphémère séparé)
      if (id === 'bump_view_stats') {
        await interaction.deferReply({ ephemeral: true });
        try {
          const Server = require('../../models/Server');
          const User = require('../../models/User');
          const { BUMP_COOLDOWN_MS } = require('../../utils/bumpNetwork');
          const guild = interaction.guild;
          const server = await Server.findOne({ guildId: guild.id });
          if (!server || server.bumpCount === 0) {
            return interaction.editReply({ content: 'Aucune donnée de bump pour ce serveur.' });
          }
          const userStats = await User.findOne({ userId: interaction.user.id, guildId: guild.id });
          const nextTs = server.lastBump
            ? Math.floor((new Date(server.lastBump).getTime() + BUMP_COOLDOWN_MS) / 1000)
            : null;
          const ready = !server.lastBump || Date.now() - new Date(server.lastBump).getTime() >= BUMP_COOLDOWN_MS;
          const embed = new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle(`📊 Vos stats de bump — ${guild.name}`)
            .addFields(
              { name: '🚀 Vos bumps', value: `**${userStats?.bumps || 0}**`, inline: true },
              { name: '📊 Total serveur', value: `**${server.bumpCount}**`, inline: true },
              { name: '🔥 Streak', value: `**${server.bumpStreak}** jour(s)`, inline: true },
              { name: '💰 Coins gagnés', value: `**${userStats?.coinsEarned || 0}**`, inline: true },
              { name: '⏰ Prochain bump', value: ready ? '✅ Disponible !' : `<t:${nextTs}:R>`, inline: true },
            )
            .setFooter({ text: 'Bumpify • Stats rapides' })
            .setTimestamp();
          return interaction.editReply({ embeds: [embed] });
        } catch (err) {
          return interaction.editReply({ content: 'Utilisez `/stats serveur` pour voir les statistiques.' });
        }
      }

      // Captcha — bouton répondre
      if (id.startsWith('captcha_answer_')) {
        const { verifyCaptcha } = require('../../commands/configuration/captcha');
        await verifyCaptcha(interaction).catch(console.error);
        return;
      }
      // Captcha — bouton régénérer l'image
      if (id.startsWith('captcha_regen_')) {
        const { handleRegenerate } = require('../../commands/configuration/captcha');
        await handleRegenerate(interaction).catch(console.error);
        return;
      }

      // Help — bouton retour accueil
      if (id === 'help_home') {
        const cmd = client.commands.get('help');
        if (cmd?.handleHome) await cmd.handleHome(interaction).catch(console.error);
        return;
      }

      // Help — guide de démarrage pas-à-pas
      if (id === 'help_guide_start') {
        const cmd = client.commands.get('help');
        if (cmd?.handleGuideStart) await cmd.handleGuideStart(interaction).catch(console.error);
        return;
      }
      if (id === 'help_guide_prev') {
        const cmd = client.commands.get('help');
        if (cmd?.handleGuideStep) await cmd.handleGuideStep(interaction, -1).catch(console.error);
        return;
      }
      if (id === 'help_guide_next') {
        const cmd = client.commands.get('help');
        if (cmd?.handleGuideStep) await cmd.handleGuideStep(interaction, 1).catch(console.error);
        return;
      }
      if (id === 'help_guide_exit') {
        const cmd = client.commands.get('help');
        if (cmd?.handleGuideExit) await cmd.handleGuideExit(interaction).catch(console.error);
        return;
      }

      // Help v2 — recherche et découverte aléatoire
      if (id === 'help_search') {
        const cmd = client.commands.get('help');
        if (cmd?.handleSearchButton) await cmd.handleSearchButton(interaction).catch(console.error);
        return;
      }
      if (id === 'help_random') {
        const cmd = client.commands.get('help');
        if (cmd?.handleRandomButton) await cmd.handleRandomButton(interaction).catch(console.error);
        return;
      }

      // Vote serveur
      if (id.startsWith('vote_')) {
        const Vote   = require('../../models/Vote');
        const Server = require('../../models/Server');
        const { successEmbed, errorEmbed } = require('../../utils/embeds');
        const targetGuildId = id.split('_')[1];
        try {
          await Vote.create({ voterId: interaction.user.id, targetId: targetGuildId });
          await Server.findOneAndUpdate({ guildId: targetGuildId }, { $inc: { totalVotes: 1 } });
          return interaction.reply({ embeds: [successEmbed('Vote enregistré !', 'Merci pour votre vote ! 👍')], ephemeral: true });
        } catch (e) {
          if (e.code === 11000) return interaction.reply({ embeds: [require('../../utils/embeds').errorEmbed('Déjà voté', 'Vous avez déjà voté pour ce serveur aujourd\'hui !')], ephemeral: true });
          return interaction.reply({ embeds: [require('../../utils/embeds').errorEmbed('Erreur', 'Une erreur est survenue.')], ephemeral: true });
        }
      }

      // Giveaway
      if (id.startsWith('gw_join_')) {
        const giveawayId = id.replace('gw_join_', '');
        const cmd = client.commands.get('giveaway');
        if (cmd?.handleJoin) await cmd.handleJoin(interaction, giveawayId).catch(console.error);
        return;
      }
      if (id.startsWith('gw_list_')) {
        const giveawayId = id.replace('gw_list_', '');
        const cmd = client.commands.get('giveaway');
        if (cmd?.handleListButton) await cmd.handleListButton(interaction, giveawayId).catch(console.error);
        return;
      }

      // Suggestion votes
      if (id.startsWith('sug_up_') || id.startsWith('sug_down_')) {
        const type = id.startsWith('sug_up_') ? 'up' : 'down';
        const suggestionId = id.replace(`sug_${type}_`, '');
        const cmd = client.commands.get('suggestion');
        if (cmd?.handleVote) await cmd.handleVote(interaction, suggestionId, type).catch(console.error);
        return;
      }

      // Confession modération
      if (id.startsWith('conf_approve_') || id.startsWith('conf_deny_')) {
        const action = id.startsWith('conf_approve_') ? 'approve' : 'deny';
        const confessionId = id.replace(`conf_${action}_`, '');
        const cmd = client.commands.get('confession');
        if (cmd?.handleConfessionMod) await cmd.handleConfessionMod(interaction, client, action, confessionId).catch(console.error);
        return;
      }

      // Ticket — boutons
      if (id === 'ticket_create') {
        const cmd = client.commands.get('ticket');
        if (cmd?.handleCreate) await cmd.handleCreate(interaction, client).catch(console.error);
        return;
      }
      if (id.startsWith('ticket_close_confirm_') || id.startsWith('ticket_close_btn_')) {
        const cmd = client.commands.get('ticket');
        if (cmd?.handleClose) await cmd.handleClose(interaction, client).catch(console.error);
        return;
      }
      if (id === 'ticket_close_cancel') {
        return interaction.update({ components: [] }).catch(() => {});
      }
      // Ticket v4 — claim, priority, add (ouvre modal ou menu)
      if (id.startsWith('ticket_claim_') || id.startsWith('ticket_priority_') || id.startsWith('ticket_add_')) {
        const ticketId = id.split('_').pop();
        if (id.startsWith('ticket_claim_')) {
          const { Ticket } = require('../../models/Ticket');
          const ticket = await Ticket.findById(ticketId).catch(() => null);
          if (!ticket) return interaction.reply({ content: 'Ticket introuvable.', ephemeral: true });
          ticket.claimedBy = interaction.user.id; await ticket.save();
          return interaction.reply({ embeds: [new (require('discord.js').EmbedBuilder)().setColor(0x2ECC71).setTitle('✋ Ticket pris en charge').setDescription(`<@${interaction.user.id}> s'occupe de ce ticket.`).setTimestamp()], ephemeral: false });
        }
        if (id.startsWith('ticket_priority_')) {
          const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder: AR } = require('discord.js');
          const modal = new ModalBuilder().setCustomId(`ticket_priority_modal_${ticketId}`).setTitle('📌 Changer la priorité');
          modal.addComponents(new AR().addComponents(
            new TextInputBuilder().setCustomId('niveau').setLabel('Priorité (low/normal/high/urgent)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('normal')
          ));
          return interaction.showModal(modal);
        }
        if (id.startsWith('ticket_add_')) {
          return interaction.reply({ content: 'Utilisez `/ticket add` pour ajouter un membre.', ephemeral: true });
        }
      }

      // Poll
      if (id.includes('_vote_') || id.includes('_end')) {
        const cmd = client.commands.get('poll');
        if (!cmd?.handlePollInteraction) return;
        const match = id.match(/^(poll_\d+_\d+)_(vote_(\d+)|end)$/);
        if (!match) return;
        const pollId = match[1];
        const type   = match[2].startsWith('vote') ? 'vote' : 'end';
        const choice = type === 'vote' ? parseInt(match[3]) : null;
        await cmd.handlePollInteraction(interaction, pollId, type, choice).catch(console.error);
        return;
      }

      // Inter-serveur — actions réseau (ban, signalement)
      if (id.startsWith('is_net_')) {
        const cmd = client.commands.get('interserveur');
        if (cmd?.handleNetworkButton) await cmd.handleNetworkButton(interaction, client).catch(console.error);
        return;
      }

      // Ouvrir /topserveurs depuis un bouton
      if (id === 'topserv_open') {
        const cmd = client.commands.get('topserveurs');
        if (cmd) await cmd.execute(interaction, client).catch(console.error);
        return;
      }

      // Réseau top serveurs — naviguer
      if (id.startsWith('topserv_')) {
        const cmd = client.commands.get('topserveurs');
        if (cmd?.handleButton) await cmd.handleButton(interaction).catch(console.error);
        return;
      }
    }

    // ── StringSelectMenu ──────────────────────────────────────────────────
    if (interaction.isStringSelectMenu()) {
      const id = interaction.customId;

      if (id.startsWith('auth_')) {
        const cmd = client.commands.get('auth-profil');
        if (cmd?.handleSelectMenu) await cmd.handleSelectMenu(interaction).catch(console.error);
        return;
      }
      if (id === 'help_category') {
        const cmd = client.commands.get('help');
        if (cmd?.handleSelect) await cmd.handleSelect(interaction).catch(console.error);
        return;
      }
      if (id === 'help_docs') {
        const cmd = client.commands.get('help');
        if (cmd?.handleDocsSelect) await cmd.handleDocsSelect(interaction).catch(console.error);
        return;
      }
      if (id === 'help_guide_nav') {
        const cmd = client.commands.get('help');
        if (cmd?.handleGuideNav) await cmd.handleGuideNav(interaction).catch(console.error);
        return;
      }
      if (id === 'faq_select') {
        const cmd = client.commands.get('faq');
        if (cmd?.handleSelect) await cmd.handleSelect(interaction).catch(console.error);
        return;
      }
      if (id.startsWith('sondage_vote_')) {
        const pollId = id.replace('sondage_vote_', '');
        if (pollId === 'temp') return;
        const cmd = client.commands.get('sondage');
        const choiceIdx = parseInt(interaction.values[0]);
        if (cmd?.handleVote) await cmd.handleVote(interaction, pollId, choiceIdx).catch(console.error);
        return;
      }
      if (id === 'lb_switch') return;

      // Ticket v4 — sélection du type
      if (id === 'ticket_type_select') {
        const cmd = client.commands.get('ticket');
        if (cmd?.handleCreate) await cmd.handleCreate(interaction, client).catch(console.error);
        return;
      }

      // Inter-serveur — sélection réseau (réseau publics)
      if (id === 'topserv_filter') {
        // géré par le collecteur interne de topserveurs.js
        return;
      }

            // News — menus config (gérés par collecteur interne)
      if (id === 'news_config_action' || id.startsWith('news_ch_')) return;

      // FreeGames — menus config (gérés par collecteur interne)
      if (id === 'fg_config_action' || id === 'fg_set_channel' || id === 'fg_set_role') return;

      // Notifications — menus config (gérés par collecteur interne)
      if (id === 'notif_config_action' || id === 'notif_set_panel_channel' || id === 'notif_set_log_channel') return;

      // ModMail — select menus (snippets, config)
      if (id.startsWith('mm_snippet_select_') || id === 'mm_config_action') {
        const cmd = client.commands.get('modmail');
        if (cmd?.handleSelect) await cmd.handleSelect(interaction, client).catch(console.error);
        return;
      }

      // Panneau sécurité — menus (gérés par collecteur interne de securite.js)
      if (id === 'sec_menu' || id === 'sec_links_action' || id === 'sec_mention_action' || id === 'sec_wf_level') {
        return; // collecteur interne
      }

      if (id === 'is_action') {
        // géré par le collecteur interne de interserveur.js
        return;
      }
    }

    // ── SelectMenu génériques (gérés par collecteurs internes) ───────────
    if (interaction.isAnySelectMenu()) {
      const id = interaction.customId;
      const internalIds = [
        'sug_set_channel','sug_toggle',
        'ticket_set_category','ticket_set_log','ticket_set_role','ticket_config_action','ticket_back','ticket_noop',
        'config_category','config_language','config_bump_channel','config_feed_channel','config_log_channel','config_bump_role',
        'captcha_channel_select','captcha_role_before_select','captcha_role_after_select','captcha_security_select',
        'captcha_log_channel_select','captcha_bypass_role_select',
        'panel_category','panel_module',
        'lb_switch',
        'autothread_panel_action','autothread_select_include','autothread_select_exclude','autothread_select_role',
        'logsconfig_panel_category','logsconfig_select_channel','xpconfig_panel_action',
        'is_action',
        'fw_select_forum',
        'sb_select_channel','sb_select_ignored_channels','sb_select_ignored_roles',
        'rd_select','rd_select_channel','rd_select_role','rd_select_sort',
        'ob_select_category','ob_select_access_role','ob_select_question',
        'sugpanel_',
        'avispanel_',
        'bumpnotif_',
        'mpreq_',
      ];
      if (internalIds.some(iid => id === iid || id.startsWith(iid))) return;
    }
  },
};
