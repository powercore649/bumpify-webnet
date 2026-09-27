// commands/bump.js — Système de bump complet v2
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const Server  = require('../../models/Server');
const User    = require('../../models/User');
const Balance = require('../../models/Balance');
const BumpReminder = require('../../models/BumpReminder');
const { broadcastBump, updateStreak, computeScore, BUMP_COOLDOWN_MS, BUMP_COINS_REWARD } = require('../../utils/bumpNetwork');
const { checkAndAwardMilestones, rollLootBox } = require('../../utils/bumpFeatures');
const { errorEmbed, COLORS } = require('../../utils/embeds');
const { getAppEmoji } = require('../../utils/emojiSync');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bump')
    .setDescription('Bumpez votre serveur dans le réseau Bumpify !'),

  async execute(interaction, client) {
    await interaction.deferReply();
    const guild = interaction.guild;

    // Emojis custom de l'application — repli sur l'Unicode classique si la
    // synchronisation n'a pas encore eu lieu (ex: tout juste après un déploiement).
    const eRocket = getAppEmoji(client, 'bumpify_rocket') || '<:798008_booster:1525353451943493774>';
    const eStreak = getAppEmoji(client, 'bumpify_streak') || '<:bumpify_streak:1525264254259695766>';
    const eCoin   = getAppEmoji(client, 'bumpify_coin')   || '<:559246_booster:1525353437808689253>';
    const eStar   = getAppEmoji(client, 'bumpify_star')   || '<:860341_contributer:1525353454325727292>';
    const eCross  = getAppEmoji(client, 'bumpify_cross')  || '<a:943832_alertastaff2000:1525351980065751101>';

    // ── Récupérer/créer la config serveur ────────────────────────────────
    let server = await Server.findOneAndUpdate(
      { guildId: guild.id },
      { $setOnInsert: { guildId: guild.id, guildName: guild.name, guildIcon: guild.iconURL({ dynamic: true }), memberCount: guild.memberCount } },
      { upsert: true, new: true }
    );
    server.guildName   = guild.name;
    server.guildIcon   = guild.iconURL({ dynamic: true });
    server.memberCount = guild.memberCount;

    // ── Vérifications ─────────────────────────────────────────────────────
    if (server.blacklisted) {
      return interaction.editReply({ embeds: [errorEmbed('Serveur blacklisté', `Ce serveur est banni du réseau.\nRaison : ${server.blacklistReason || 'Non précisée'}`)] });
    }

    if (server.bumpChannelId && interaction.channelId !== server.bumpChannelId) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(COLORS.error)
          .setTitle(`${eCross} Mauvais salon`)
          .setDescription(`Les bumps ne sont autorisés que dans <#${server.bumpChannelId}>.`)],
      });
    }

    if (!server.description) {
      return interaction.editReply({ embeds: [errorEmbed('Configuration incomplète', 'Ajoutez une description via `/config` avant de bumper.')] });
    }
    if (!server.inviteLink) {
      return interaction.editReply({ embeds: [errorEmbed('Invitation manquante', 'Ajoutez un lien d\'invitation via `/config` avant de bumper.')] });
    }

    // ── Cooldown ──────────────────────────────────────────────────────────
    if (server.lastBump) {
      const elapsed = Date.now() - new Date(server.lastBump).getTime();
      if (elapsed < BUMP_COOLDOWN_MS) {
        const remaining  = BUMP_COOLDOWN_MS - elapsed;
        const nextBumpTs = Math.floor((Date.now() + remaining) / 1000);
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);

        // Barre de progression visuelle du cooldown
        const progress = Math.round((elapsed / BUMP_COOLDOWN_MS) * 20);
        const progressBar = '<:225989_line1:1525353420691734528>'.repeat(progress) + '<:391352_line2:1525353430766457064>'.repeat(20 - progress);
        const embed = new EmbedBuilder()
          .setColor(COLORS.error)
          .setTitle('<:908915_information:1525353455319912510> Cooldown actif')
          .setDescription(`**${progressBar}** ${Math.round(elapsed / BUMP_COOLDOWN_MS * 100)}%\n\nVous pourrez bumper <t:${nextBumpTs}:R>`)
          .addFields(
            { name: '<:4038pogoghostred:1525354958969376858> Prochain bump', value: `<t:${nextBumpTs}:T>`, inline: true },
            { name: '<:8649cooldown:1525354594262061236> Temps restant', value: `${minutes}m ${seconds}s`, inline: true },
            { name: `${eStreak} Streak actuel`, value: `${server.bumpStreak} jour(s)`, inline: true },
          )
          .setFooter({ text: 'Bumpify • Cooldown 2h' });

        const BumpNotifConfig = require('../../models/BumpNotifConfig');
        const notifConfig = await BumpNotifConfig.findOne({ guildId: guild.id });
        const showDmButton = notifConfig?.showDmButton ?? true;

        const components = [];
        if (showDmButton) {
          components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('🔔 Me rappeler en DM').setStyle(ButtonStyle.Secondary).setCustomId('bump_remind_me'),
          ));
        }

        const cooldownReply = await interaction.editReply({ embeds: [embed], components });
        if (!showDmButton) return;

        // Collector local, indépendant de interactionCreate.js — ne gère
        // que le clic sur CE bouton précis, sur CE message précis.
        const remindCollector = cooldownReply.createMessageComponentCollector({
          filter: (i) => i.customId === 'bump_remind_me' && i.user.id === interaction.user.id,
          time: BUMP_COOLDOWN_MS,
          max: 1,
        });

        remindCollector.on('collect', async (i) => {
          await BumpReminder.findOneAndUpdate(
            { userId: i.user.id, guildId: guild.id },
            { dueAt: new Date(Date.now() + remaining) },
            { upsert: true }
          );
          await i.reply({ content: `🔔 C'est noté ! Je t'enverrai un message privé dès que le cooldown de **${guild.name}** sera terminé (<t:${nextBumpTs}:R>).`, ephemeral: true });
          await interaction.editReply({ components: [] }).catch(() => {});
        });

        return;
      }
    }

    // ── Appliquer le bump ─────────────────────────────────────────────────
    updateStreak(server);
    server.bumpCount++;
    server.weeklyBumps++;
    server.monthlyBumps++;
    server.lastBump     = new Date();
    server.lastBumpedBy = interaction.user.id;
    server.reminderSent = false;
    server.totalCoinsEarned = (server.totalCoinsEarned || 0) + BUMP_COINS_REWARD;
    await server.save();

    const BumpHistory = require('../../models/BumpHistory');
    BumpHistory.create({
      guildId: guild.id, userId: interaction.user.id, guildName: guild.name,
      coinsEarned: BUMP_COINS_REWARD, streakAtTime: server.bumpStreak,
    }).catch(err => console.error('❌ BumpHistory:', err.message));

    // ── Stats utilisateur ─────────────────────────────────────────────────
    let userStats = await User.findOneAndUpdate(
      { userId: interaction.user.id, guildId: guild.id },
      { $inc: { bumps: 1, weeklyBumps: 1, monthlyBumps: 1, coinsEarned: BUMP_COINS_REWARD }, $set: { lastBump: new Date() } },
      { upsert: true, new: true }
    );

    // ── Badges de jalon (streak / nombre total de bumps) ───────────────────
    const newBadges = await checkAndAwardMilestones(guild.id, interaction.user.id, {
      bumpStreak: server.bumpStreak,
      totalUserBumps: userStats.bumps,
    }).catch((err) => { console.error('❌ checkAndAwardMilestones:', err.message); return []; });

    // ── Récompense coins ──────────────────────────────────────────────────
    let streakBonus = 0;
    if (server.bumpStreak >= 7)  streakBonus = 25;
    if (server.bumpStreak >= 30) streakBonus = 75;
    const totalReward = BUMP_COINS_REWARD + streakBonus;

    await Balance.findOneAndUpdate(
      { userId: interaction.user.id, guildId: guild.id },
      { $inc: { coins: totalReward } },
      { upsert: true }
    );

    // ── Auto-rôles bump ───────────────────────────────────────────────────
    try {
      const { checkBumpRoles } = require('../configuration/autorole');
      await checkBumpRoles(interaction.member, userStats.bumps);
    } catch (_) {}

    // ── Diffuser dans le réseau ───────────────────────────────────────────
    const sent = await broadcastBump(client, server, interaction.user);

    // ── Attaque de territoire automatique ────────────────────────────────
    let territoryResult = null;
    try {
      const { attemptTerritoryAttack } = require('../../utils/territoryEngine');
      territoryResult = await attemptTerritoryAttack(guild.id, guild.name);
    } catch (err) {
      console.error('territoryAttack:', err.message);
    }

    // ── Log dans le salon logs ────────────────────────────────────────────
    if (server.logChannelId) {
      const logCh = guild.channels.cache.get(server.logChannelId);
      if (logCh?.isTextBased()) {
        logCh.send({
          embeds: [new EmbedBuilder()
            .setColor(COLORS.success)
            .setTitle('<:2902originallyknownas:1525355597795561665> Bump enregistré')
            .addFields(
              { name: '<:623618_bot:1525353443663806496> Par',           value: `${interaction.user.tag}`, inline: true },
              { name: '<:9610pogoosdeveloper:1525354962672943255> Total',         value: `${server.bumpCount}`,     inline: true },
              { name: '<:76642_developer:1525353450098135122> Diffusé vers',  value: `${sent} serveur(s)`,      inline: true },
              { name: ` ${eStreak} Streak`,        value: `${server.bumpStreak} jour(s)`, inline: true },
              { name: '<:559246_booster:1525353437808689253> Score réseau',  value: `${computeScore(server)}`, inline: true },
            )
            .setTimestamp()],
        }).catch(() => {});
      }
    }

    // ── Embed de succès ───────────────────────────────────────────────────
    const nextBumpTs = Math.floor((Date.now() + BUMP_COOLDOWN_MS) / 1000);
    const isFeatured = server.featured && server.featuredUntil && new Date(server.featuredUntil) > new Date();

    const embed = new EmbedBuilder()
      .setColor(isFeatured ? 0xFFD700 : COLORS.success)
      .setTitle(`${isFeatured ? eStar : eRocket} Serveur bumpé avec succès !`)
      .setDescription(server.description)
      .setThumbnail(guild.iconURL({ dynamic: true }))
      .addFields(
        { name: '<:623618_bot:1525353443663806496> Membres',          value: `${guild.memberCount.toLocaleString()}`, inline: true },
        { name: '<:9610pogoosdeveloper:1525354962672943255> Total bumps',       value: `${server.bumpCount}`,                 inline: true },
        { name: '<:76642_developer:1525353450098135122> Serveurs notifiés', value: `${sent}`,                             inline: true },
        { name: `${eStreak} Streak`,           value: `${server.bumpStreak} jour(s)`,        inline: true },
        { name: `${eCoin} Récompense`,       value: `+${totalReward} coins${streakBonus > 0 ? ` *(+${streakBonus} bonus streak)*` : ''}`, inline: true },
        { name: '<:8649cooldown:1525354594262061236> Prochain bump',    value: `<t:${nextBumpTs}:R>`,                 inline: true },
        { name: '<:9610pogoowner:1525354964203999333> Score réseau',     value: `${computeScore(server)} pts`,         inline: true },
      )
      .setFooter({ text: `Bumpé par ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();

    if (server.tags?.length > 0) {
      embed.addFields({ name: '<:8567verifiedred:1525356831013339186> Tags', value: server.tags.map(t => `\`${t}\``).join(' ') });
    }
    if (server.bumpStreak >= 3) {
      embed.addFields({ name: `${eStreak} Streak actif !`, value: `Ce serveur est bumpé depuis **${server.bumpStreak} jours** de suite !` });
    }
    if (isFeatured) {
      embed.addFields({ name: `${eStar} Mis en avant !`, value: `Votre serveur est mis en avant jusqu'au <t:${Math.floor(new Date(server.featuredUntil).getTime() / 1000)}:f>` });
    }
    if (newBadges.length > 0) {
      embed.addFields({
        name: '🏅 Nouveau(x) badge(s) débloqué(s) !',
        value: newBadges.map((b) => `${b.emoji} **${b.name}**`).join('\n') + '\n*Voir `/badge voir` pour ta collection complète.*',
      });
    }

    // ── Affichage du résultat de l'attaque territoire ──────────────────────
    if (territoryResult) {
      const z = territoryResult.zone;
      let territoryText = '';
      if (territoryResult.type === 'capture_free') {
        territoryText = `⚔️ **Zone \`${z.zoneId}\` ${z.name}** conquise (territoire libre) !`;
      } else if (territoryResult.type === 'capture_enemy') {
        territoryText = `🏴 **Zone \`${z.zoneId}\` ${z.name}** arrachée à **${territoryResult.previousName || 'un autre serveur'}** !`;
      } else if (territoryResult.type === 'reinforce') {
        territoryText = `🛡️ Renfort sur **\`${z.zoneId}\` ${z.name}** — Puissance : ${z.power}/500`;
      } else if (territoryResult.type === 'attack_failed') {
        territoryText = `⚠️ Attaque repoussée sur **\`${z.zoneId}\` ${z.name}** (défense : ${territoryResult.remainingPower})`;
      }
      embed.addFields({
        name: '🗺️ Guerre des Territoires',
        value: `${territoryText}\n💰 +${territoryResult.warCoinsEarned} war-coins ・ 👑 Rang : **${territoryResult.newRank}** ・ Voir \`/territoires carte\``,
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('📊 Mes stats').setStyle(ButtonStyle.Secondary).setCustomId('bump_view_stats'),
      new ButtonBuilder().setLabel('🏆 Top serveurs').setStyle(ButtonStyle.Primary).setCustomId('topserv_open'),
    );

    // ── Loot box (20% de chance par bump) ───────────────────────────────────
    const loot = rollLootBox();
    if (loot) {
      row.addComponents(
        new ButtonBuilder().setLabel('🎁 Ouvrir la loot box').setStyle(ButtonStyle.Success).setCustomId('bump_lootbox_open'),
      );
    }

    const sentReply = await interaction.editReply({ embeds: [embed], components: [row] });

    if (loot) {
      // Collector local, indépendant de interactionCreate.js — ne gère que
      // ce bouton précis, sur ce message précis, pendant 2 minutes.
      const lootCollector = sentReply.createMessageComponentCollector({
        filter: (i) => i.customId === 'bump_lootbox_open' && i.user.id === interaction.user.id,
        time: 120000,
        max: 1,
      });

      lootCollector.on('collect', async (i) => {
        await Balance.findOneAndUpdate(
          { userId: i.user.id, guildId: guild.id },
          { $inc: { coins: loot.coins } },
          { upsert: true }
        );
        const lootEmbed = new EmbedBuilder()
          .setColor(loot.coins >= 1000 ? 0xFFD700 : COLORS.success)
          .setTitle('🎁 Loot box ouverte !')
          .setDescription(`${loot.label}\n💰 Tu as gagné **+${loot.coins} coins** !`);
        await i.reply({ embeds: [lootEmbed] });
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('📊 Mes stats').setStyle(ButtonStyle.Secondary).setCustomId('bump_view_stats'),
          new ButtonBuilder().setLabel('🎁 Ouverte').setStyle(ButtonStyle.Success).setCustomId('bump_lootbox_open').setDisabled(true),
        );
        await interaction.editReply({ components: [disabledRow] }).catch(() => {});
      });

      lootCollector.on('end', (collected) => {
        if (collected.size === 0) {
          // Personne n'a cliqué à temps : on désactive juste le bouton,
          // aucune perte pour l'utilisateur (la loot box expire, c'est tout).
          const expiredRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('📊 Mes stats').setStyle(ButtonStyle.Secondary).setCustomId('bump_view_stats'),
            new ButtonBuilder().setLabel('🎁 Expirée').setStyle(ButtonStyle.Secondary).setCustomId('bump_lootbox_open').setDisabled(true),
          );
          interaction.editReply({ components: [expiredRow] }).catch(() => {});
        }
      });
    }

    return sentReply;
  },
};
