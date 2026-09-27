'use strict';
// commands/meteo.js — Météo actuelle d'une ville (OpenWeatherMap)
// Utilise WEATHER_KEY déjà présent dans .env.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { parseWeatherResponse } = require('../../utils/weatherEngine');
const { COLORS, errorEmbed } = require('../../utils/embeds');

const API_URL = 'https://api.openweathermap.org/data/2.5/weather';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('meteo')
    .setDescription('🌤️ Voir la météo actuelle d\'une ville')
    .addStringOption(o => o.setName('ville').setDescription('Nom de la ville (ex: Paris, Montréal, Tokyo)').setRequired(true)),

  async execute(interaction) {
    const apiKey = process.env.WEATHER_KEY;
    if (!apiKey) {
      return interaction.reply({
        embeds: [errorEmbed('Météo non configurée', 'La clé `WEATHER_KEY` n\'est pas définie dans le `.env` du bot. Contactez un administrateur.')],
        ephemeral: true,
      });
    }

    const ville = interaction.options.getString('ville');
    await interaction.deferReply();

    let response;
    try {
      response = await axios.get(API_URL, {
        params: { q: ville, appid: apiKey, units: 'metric', lang: 'fr' },
        timeout: 8000,
      });
    } catch (err) {
      if (err.response?.status === 404) {
        return interaction.editReply({ embeds: [errorEmbed('Ville introuvable', `Aucune ville trouvée pour \`${ville}\`. Vérifiez l'orthographe.`)] });
      }
      if (err.response?.status === 401) {
        return interaction.editReply({ embeds: [errorEmbed('Clé API invalide', 'La clé `WEATHER_KEY` semble invalide ou expirée.')] });
      }
      console.error('[meteo] Erreur API:', err.message);
      return interaction.editReply({ embeds: [errorEmbed('Erreur', 'Impossible de récupérer la météo pour le moment. Réessayez plus tard.')] });
    }

    let w;
    try {
      w = parseWeatherResponse(response.data);
    } catch (err) {
      console.error('[meteo] Erreur de parsing:', err.message);
      return interaction.editReply({ embeds: [errorEmbed('Erreur', 'Réponse météo inattendue. Réessayez plus tard.')] });
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle(`${w.emoji} Météo à ${w.cityName}${w.country ? `, ${w.country}` : ''}`)
      .setDescription(`**${w.description}**`)
      .addFields(
        { name: '🌡️ Température', value: `${w.tempC}°C (ressenti ${w.feelsLikeC}°C)`, inline: true },
        { name: '📊 Min / Max', value: `${w.tempMinC}°C / ${w.tempMaxC}°C`, inline: true },
        { name: '💧 Humidité', value: `${w.humidity}%`, inline: true },
        { name: '💨 Vent', value: w.windKph !== null ? `${w.windKph} km/h${w.windDirection ? ` (${w.windDirection})` : ''}` : 'N/A', inline: true },
        { name: '☁️ Nébulosité', value: w.cloudiness !== null ? `${w.cloudiness}%` : 'N/A', inline: true },
        { name: '👁️ Visibilité', value: w.visibilityKm !== null ? `${w.visibilityKm} km` : 'N/A', inline: true },
      )
      .setFooter({ text: 'Données fournies par OpenWeatherMap' })
      .setTimestamp();

    if (w.sunrise && w.sunset) {
      embed.addFields({
        name: '🌅 Lever / 🌇 Coucher du soleil',
        value: `<t:${Math.floor(w.sunrise.getTime() / 1000)}:t> / <t:${Math.floor(w.sunset.getTime() / 1000)}:t>`,
        inline: false,
      });
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
